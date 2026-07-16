package com.yunqiao.life.merchantterminal.connector

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.local.LocalPrintLedger
import com.yunqiao.life.merchantterminal.data.local.LocalPrintingDatabase
import com.yunqiao.life.merchantterminal.data.local.LocalJobStatus
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.ProcessUsbIoOwnership
import com.yunqiao.life.merchantterminal.security.MerchantSessionTokenStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PrinterConnectorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var settingsStore: ConnectorSettings
    private lateinit var credentialStore: MerchantSessionTokenStore
    private lateinit var api: ConnectorApiClient
    private lateinit var executor: UsbPrintJobExecutor
    private lateinit var printingDao: com.yunqiao.life.merchantterminal.data.local.LocalPrintingDao
    private lateinit var connectivityManager: ConnectivityManager
    private var loopJob: Job? = null
    private var receiverRegistered = false

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == UsbManager.ACTION_USB_DEVICE_DETACHED) {
                executor.onDeviceDetached(intent.usbDeviceName())
                updateNotification("USB 已断开，等待人工检查")
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        ConnectorRuntimeState.serviceStarted()
        settingsStore = ConnectorSettings(applicationContext)
        credentialStore = MerchantSessionTokenStore(applicationContext)
        api = ConnectorApiClient(credentialStore::read)
        printingDao = LocalPrintingDatabase.get(applicationContext).printingDao()
        val ledger = LocalPrintLedger(printingDao)
        executor = UsbPrintJobExecutor(applicationContext, api, ledger)
        connectivityManager = getSystemService(ConnectivityManager::class.java)
        ConnectorAttentionNotifier.clear(applicationContext)
        createNotificationChannel()
        startAsForeground("正在检查商家登录与 USB 配置")
        registerUsbReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (loopJob?.isActive != true) loopJob = scope.launch { connectorLoop() }
        // System-managed sticky restart is the Android 12+ recovery path. onCreate/loop immediately
        // re-check DataStore, Keystore, remote gates and current USB permission before any claim.
        return START_STICKY
    }

    override fun onDestroy() {
        if (receiverRegistered) runCatching { unregisterReceiver(usbReceiver) }
        receiverRegistered = false
        executor.stopActiveIo()
        scope.cancel()
        ConnectorRuntimeState.serviceStopped()
        ConnectorRecoveryScheduler.enqueueNetworkRecovery(applicationContext)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun connectorLoop() {
        var localRecoveryComplete = false
        var lastConfigAt = 0L
        while (scope.isActive) {
            if (!localRecoveryComplete) {
                try {
                    ConnectorExecutionGate.exclusive { executor.recoverLocalInterrupted() }
                    localRecoveryComplete = true
                } catch (error: Throwable) {
                    if (error is CancellationException) throw error
                    settingsStore.recordError("LOCAL_RECOVERY_FAILED")
                    updateNotification("本地恢复暂不可用：${error.javaClass.simpleName.take(50)}")
                    delay(API_ERROR_RETRY_MS)
                    continue
                }
            }
            val settings = settingsStore.snapshot()
            ConnectorStartGate.update(applicationContext, settings, credentialStore.hasCredential())
            if (!settings.connectorEnabled || !credentialStore.hasCredential()) {
                stopSelf()
                return
            }
            if (!isNetworkConnected()) {
                updateNotification("网络不可用，打印任务保持等待")
                delay(NETWORK_RECHECK_MS)
                continue
            }
            val now = System.currentTimeMillis()
            try {
                if (now - lastConfigAt >= settings.configRefreshIntervalMs) {
                    val remote = withContext(Dispatchers.IO) { api.config() }
                    if (!settingsStore.bindMerchantScopeIfAbsent(remote.merchantId)) {
                        settingsStore.recordError("MERCHANT_SCOPE_MISMATCH")
                        updateNotification("商家账号与本地打印配置不匹配，请重置连接器")
                        stopSelf()
                        return
                    }
                    val scopedSettings = settingsStore.snapshot()
                    val remoteBlock = ConnectorPrintExecutionPolicy.remoteBlockCode(
                        remote = remote,
                        expectedMerchantId = scopedSettings.merchantId,
                        expectedPrinterId = scopedSettings.usbBinding?.printerId,
                    )
                    settingsStore.applyRemoteConfig(
                        executionEnabled = remoteBlock == null,
                        printerEnabled = remoteBlock == null,
                        automaticPrintingEnabled = remote.automaticPrintingEnabled,
                        pollIntervalMs = remote.pollIntervalMs,
                        configRefreshIntervalMs = remote.configRefreshIntervalMs,
                    )
                    settingsStore.recordError(remoteBlock)
                    settingsStore.associatePrinterId(remote.boundPrinterId)
                    printingDao.printerBinding()?.let { localBinding ->
                        printingDao.savePrinterBinding(
                            localBinding.copy(
                                printerId = remote.boundPrinterId,
                                updatedAt = System.currentTimeMillis(),
                            ),
                        )
                    }
                    remote.resetUsbConfigVersion?.let { resetVersion ->
                        if ((settingsStore.snapshot().appliedConfigVersion ?: -1) < resetVersion) {
                            settingsStore.clearUsbBinding()
                            printingDao.clearPrinterBinding()
                            settingsStore.markConfigApplied(resetVersion)
                        }
                    }
                    reportUsbConnectionState(settingsStore.snapshot(), remote)
                    lastConfigAt = now
                }
                val refreshed = settingsStore.snapshot()
                if (!refreshed.canExecute) {
                    updateNotification(
                        when (refreshed.lastErrorCode) {
                            "PRINTING_NOT_ENABLED", "MERCHANT_PRINTING_DISABLED" ->
                                "打印功能未开通"
                            else -> "打印连接器待启用；执行开关或 USB 配置尚未就绪"
                        },
                    )
                    delay(refreshed.pollIntervalMs)
                    continue
                }
                ConnectorExecutionGate.exclusive { executor.recoverPendingReports() }
                val usbAvailability = UsbBindingResolver.resolve(
                    requireNotNull(refreshed.usbBinding),
                    UsbDeviceInspector(applicationContext).scan(),
                )
                if (usbAvailability !is UsbBindingResolution.Ready) {
                    val errorCode = (usbAvailability as UsbBindingResolution.Unavailable).errorCode
                    settingsStore.recordError(errorCode)
                    updateNotification(
                        if (errorCode == "USB_PERMISSION_REQUIRED") {
                            "USB 权限已失效，请打开终端设置重新授权"
                        } else {
                            "USB 打印机不可用：${errorCode.take(50)}"
                        },
                    )
                    // Do not consume attempts while the locally bound printer is unavailable.
                    delay(refreshed.pollIntervalMs)
                    continue
                }
                if (ProcessUsbIoOwnership.gate.isBusy()) {
                    updateNotification("USB 诊断操作尚未结束，暂不领取打印任务")
                    delay(refreshed.pollIntervalMs)
                    continue
                }
                val job = withContext(Dispatchers.IO) {
                    api.claim(
                        allowAutomatic = refreshed.canClaimAutomatic,
                        printerId = refreshed.usbBinding?.printerId,
                    )
                }
                if (job == null) {
                    updateNotification("云桥打印服务正在运行")
                } else {
                    updateNotification("正在处理一项打印任务")
                    val result = ConnectorExecutionGate.exclusive {
                        executor.execute(job, refreshed)
                    }
                    settingsStore.recordError(result.takeUnless { it == "SUCCEEDED" })
                    if (result == "SUCCEEDED") settingsStore.recordPrintSuccess()
                    updateNotification(
                        when (result) {
                            "SUCCEEDED" -> "任务已发送，等待下一项任务"
                            "UNCERTAIN", "UNCERTAIN_REQUIRES_OPERATOR" -> "打印结果不确定，必须人工处理"
                            else -> "打印任务暂停：${result.take(60)}"
                        },
                    )
                }
                delay(refreshed.pollIntervalMs)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: ConnectorApiException) {
                settingsStore.recordError(error.errorCode)
                updateNotification("连接器 API 暂不可用：${error.errorCode.take(50)}")
                if (error.invalidMerchantSession) {
                    MerchantSessionShutdown.clear(applicationContext)
                    stopSelf()
                    return
                }
                if (
                    error.printingDisabled
                ) {
                    settingsStore.applyRemoteConfig(
                        executionEnabled = false,
                        printerEnabled = settings.remotePrinterEnabled,
                        automaticPrintingEnabled = false,
                        pollIntervalMs = settings.pollIntervalMs,
                        configRefreshIntervalMs = settings.configRefreshIntervalMs,
                    )
                    updateNotification(
                        if (error.errorCode in setOf(
                                "PRINTING_NOT_ENABLED",
                                "MERCHANT_PRINTING_DISABLED",
                            )
                        ) {
                            "打印功能未开通"
                        } else {
                            "远程打印已停用；等待重新启用"
                        },
                    )
                    delay(settings.configRefreshIntervalMs)
                    continue
                }
                delay(API_ERROR_RETRY_MS)
            } catch (error: Throwable) {
                settingsStore.recordError("CONNECTOR_LOOP_ERROR")
                updateNotification("连接器等待恢复：${error.javaClass.simpleName.take(50)}")
                delay(API_ERROR_RETRY_MS)
            }
        }
    }

    private fun reportUsbConnectionState(
        settings: com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot,
        remote: ConnectorRemoteConfig,
    ) {
        val binding = settings.usbBinding
        val printerId = binding?.printerId ?: return
        val resolution = UsbBindingResolver.resolve(
            binding,
            UsbDeviceInspector(applicationContext).scan(),
        )
        val status: String
        val errorCode: String?
        val localUsbReady = resolution is UsbBindingResolution.Ready
        if (resolution is UsbBindingResolution.Ready) {
            status = "CONNECTED"
            errorCode = null
        } else {
            errorCode = (resolution as UsbBindingResolution.Unavailable).errorCode
            status = if (errorCode == "USB_DEVICE_NOT_FOUND") "DISCONNECTED" else "ERROR"
        }
        val remoteAllowsExecutionExceptStatus = remote.merchantPrintingEnabled &&
            remote.taskCenterEnabled && remote.executionEnabled &&
            remote.boundPrinterId == printerId && remote.boundPrinterEnabled &&
            remote.boundPrinterChannelType == "LOCAL_USB_ESCPOS" &&
            remote.boundPrinterConnectionConfigValid &&
            remote.merchantId == settings.merchantId
        val evidence = when {
            localUsbReady -> UsbReadinessEvidence(
                usbDeviceRecognized = true,
                usbPermissionGranted = true,
                usbInterfaceValid = true,
                usbEndpointValid = true,
                appExecutionReady = settings.connectorEnabled &&
                    credentialStore.hasCredential() && remoteAllowsExecutionExceptStatus,
            )
            errorCode == "USB_PERMISSION_REQUIRED" -> UsbReadinessEvidence(
                usbDeviceRecognized = true,
                usbPermissionGranted = false,
                usbInterfaceValid = false,
                usbEndpointValid = false,
                appExecutionReady = false,
            )
            else -> UsbReadinessEvidence(
                usbDeviceRecognized = false,
                usbPermissionGranted = false,
                usbInterfaceValid = false,
                usbEndpointValid = false,
                appExecutionReady = false,
            )
        }
        api.reportPrinterStatus(
            printerId = printerId,
            status = status,
            evidence = evidence,
            lastErrorCode = errorCode,
            lastErrorMessage = errorCode,
        )
    }

    private fun isNetworkConnected(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun startAsForeground(status: String) {
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(status),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            } else 0,
        )
    }

    private fun updateNotification(status: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(status))
    }

    private fun buildNotification(status: String) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_launcher_foreground)
        .setContentTitle(getString(R.string.connector_notification_title))
        .setContentText(status)
        .setStyle(NotificationCompat.BigTextStyle().bigText(status))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, ConnectorControlActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )
        .build()

    private fun createNotificationChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.connector_notification_channel),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    private fun registerUsbReceiver() {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(
            this,
            usbReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED,
        )
        receiverRegistered = true
    }

    @Suppress("DEPRECATION")
    private fun Intent.usbDeviceName(): String? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)?.deviceName
    } else {
        getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)?.deviceName
    }

    private companion object {
        const val CHANNEL_ID = "merchant_usb_print_connector"
        const val NOTIFICATION_ID = 8_301
        const val NETWORK_RECHECK_MS = 10_000L
        const val API_ERROR_RETRY_MS = 10_000L
        const val MAX_ACTIVE_JOB_IDS = 20
        val ACTIVE_JOB_STATUSES = listOf(
            LocalJobStatus.CLAIMED,
            LocalJobStatus.PRINTING,
            LocalJobStatus.PRINTED_PENDING_REPORT,
            LocalJobStatus.FAILED_PENDING_REPORT,
            LocalJobStatus.UNCERTAIN_PENDING_REPORT,
        )
    }
}
