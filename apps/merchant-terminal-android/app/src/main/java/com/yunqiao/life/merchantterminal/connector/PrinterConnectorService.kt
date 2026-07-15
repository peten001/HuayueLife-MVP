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
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.local.LocalPrintLedger
import com.yunqiao.life.merchantterminal.data.local.LocalPrintingDatabase
import com.yunqiao.life.merchantterminal.data.local.LocalJobStatus
import com.yunqiao.life.merchantterminal.data.local.TerminalStateEntity
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.ProcessUsbIoOwnership
import com.yunqiao.life.merchantterminal.security.TerminalCredentialStore
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
import org.json.JSONObject

class PrinterConnectorService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var settingsStore: ConnectorSettings
    private lateinit var credentialStore: TerminalCredentialStore
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
        credentialStore = TerminalCredentialStore(applicationContext)
        api = ConnectorApiClient(credentialStore::read)
        printingDao = LocalPrintingDatabase.get(applicationContext).printingDao()
        val ledger = LocalPrintLedger(printingDao)
        executor = UsbPrintJobExecutor(applicationContext, api, ledger)
        connectivityManager = getSystemService(ConnectivityManager::class.java)
        ConnectorAttentionNotifier.clear(applicationContext)
        createNotificationChannel()
        startAsForeground("正在检查终端绑定与 USB 配置")
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
        var lastHeartbeatAt = 0L
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
            if (!settings.connectorEnabled || settings.terminalId == null || !credentialStore.hasCredential()) {
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
                if (now - lastConfigAt >= settings.heartbeatIntervalMs) {
                    val remote = withContext(Dispatchers.IO) { api.config() }
                    settingsStore.applyRemoteConfig(
                        executionEnabled = remote.executionEnabled &&
                            remote.taskCenterEnabled && remote.merchantPrintingEnabled,
                        terminalEnabled = remote.terminalEnabled,
                        printerEnabled = remote.boundPrinterEnabled,
                        automaticPrintingEnabled = remote.automaticPrintingEnabled,
                        pollIntervalMs = remote.pollIntervalMs,
                        heartbeatIntervalMs = remote.heartbeatIntervalMs,
                    )
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
                    saveTerminalState(settings.terminalId, configAt = now)
                    lastConfigAt = now
                }
                if (now - lastHeartbeatAt >= settings.heartbeatIntervalMs) {
                    val sequence = settingsStore.nextHeartbeatSequence()
                    withContext(Dispatchers.IO) {
                        val heartbeatSettings = settingsStore.snapshot()
                        api.heartbeat(
                            diagnostics = safeDiagnostics(heartbeatSettings),
                            heartbeatSequence = sequence,
                            activeJobIds = printingDao.activeJobIds(
                                statuses = ACTIVE_JOB_STATUSES,
                                limit = MAX_ACTIVE_JOB_IDS,
                            ),
                            appliedConfigVersion = heartbeatSettings.appliedConfigVersion,
                            lastErrorCode = heartbeatSettings.lastErrorCode,
                        )
                        if (
                            heartbeatSettings.remoteTerminalEnabled &&
                            heartbeatSettings.remoteExecutionEnabled
                        ) {
                            reportUsbConnectionState(heartbeatSettings)
                        }
                    }
                    saveTerminalState(settings.terminalId, heartbeatAt = now)
                    lastHeartbeatAt = now
                }
                val refreshed = settingsStore.snapshot()
                if (!refreshed.canExecute) {
                    updateNotification("终端在线；打印执行开关保持关闭")
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
                    api.claim(allowAutomatic = refreshed.canClaimAutomatic)
                }
                saveTerminalState(settings.terminalId, claimAt = now)
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
                saveTerminalState(settings.terminalId, errorCode = error.errorCode)
                updateNotification("连接器 API 暂不可用：${error.errorCode.take(50)}")
                if (error.invalidTerminalCredential) {
                    TerminalIdentityReset.clear(applicationContext)
                    stopSelf()
                    return
                }
                if (
                    error.errorCode in setOf(
                        "TERMINAL_DISABLED",
                        "PRINTING_TASK_CENTER_DISABLED",
                        "PRINTING_EXECUTION_DISABLED",
                    )
                ) {
                    val disabledTerminal = error.errorCode == "TERMINAL_DISABLED"
                    settingsStore.applyRemoteConfig(
                        executionEnabled = false,
                        terminalEnabled = !disabledTerminal && settings.remoteTerminalEnabled,
                        printerEnabled = settings.remotePrinterEnabled,
                        automaticPrintingEnabled = false,
                        pollIntervalMs = settings.pollIntervalMs,
                        heartbeatIntervalMs = settings.heartbeatIntervalMs,
                    )
                    updateNotification("远程打印已停用；终端保持在线等待重新启用")
                    delay(settings.heartbeatIntervalMs)
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

    private suspend fun safeDiagnostics(
        settings: com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot,
    ): JSONObject {
        val binding = settings.usbBinding
        val usbPermission = binding?.let {
            UsbBindingResolver.resolve(it, UsbDeviceInspector(applicationContext).scan()) is
                UsbBindingResolution.Ready
        } ?: false
        val queueStatuses = listOf(
            LocalJobStatus.CLAIMED,
            LocalJobStatus.PRINTING,
            LocalJobStatus.PRINTED_PENDING_REPORT,
            LocalJobStatus.FAILED_PENDING_REPORT,
            LocalJobStatus.UNCERTAIN_PENDING_REPORT,
        )
        val queueDepth = printingDao.jobsWithStatuses(queueStatuses).size
        val uncertainCount = printingDao.jobsWithStatuses(
            listOf(LocalJobStatus.UNCERTAIN, LocalJobStatus.UNCERTAIN_PENDING_REPORT),
        ).size
        return JSONObject()
            .put("manufacturer", Build.MANUFACTURER.take(80))
            .put("model", Build.MODEL.take(80))
            .put("androidApiLevel", Build.VERSION.SDK_INT)
            .put("buildRevision", BuildConfig.BUILD_REVISION.take(80))
            .put("network", if (isNetworkConnected()) "CONNECTED" else "DISCONNECTED")
            .put("usbConfigured", binding != null)
            .put("usbPermissionGranted", usbPermission)
            .put("usbVendorId", binding?.vendorId ?: JSONObject.NULL)
            .put("usbProductId", binding?.productId ?: JSONObject.NULL)
            .put("usbInterfaceIndex", binding?.interfaceIndex ?: JSONObject.NULL)
            .put("usbEndpointAddress", binding?.endpointAddress ?: JSONObject.NULL)
            .put("paperWidth", binding?.paperWidth?.name ?: JSONObject.NULL)
            .put("lastErrorCode", settings.lastErrorCode ?: JSONObject.NULL)
            .put("queueDepth", queueDepth)
            .put("uncertainJobCount", uncertainCount)
            .put("lastPrintAt", settings.lastSuccessfulPrintAt ?: JSONObject.NULL)
    }

    private suspend fun saveTerminalState(
        terminalId: String,
        heartbeatAt: Long? = null,
        configAt: Long? = null,
        claimAt: Long? = null,
        errorCode: String? = null,
    ) {
        val previous = printingDao.terminalState(terminalId)
        printingDao.saveTerminalState(
            TerminalStateEntity(
                terminalId = terminalId,
                lastHeartbeatAt = heartbeatAt ?: previous?.lastHeartbeatAt,
                lastConfigAt = configAt ?: previous?.lastConfigAt,
                lastClaimAt = claimAt ?: previous?.lastClaimAt,
                lastErrorCode = errorCode ?: previous?.lastErrorCode,
                updatedAt = System.currentTimeMillis(),
            ),
        )
    }

    private fun reportUsbConnectionState(
        settings: com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot,
    ) {
        val binding = settings.usbBinding
        val printerId = binding?.printerId ?: return
        val resolution = UsbBindingResolver.resolve(
            binding,
            UsbDeviceInspector(applicationContext).scan(),
        )
        val status: String
        val errorCode: String?
        if (resolution is UsbBindingResolution.Ready) {
            status = "CONNECTED"
            errorCode = null
        } else {
            errorCode = (resolution as UsbBindingResolution.Unavailable).errorCode
            status = if (errorCode == "USB_DEVICE_NOT_FOUND") "DISCONNECTED" else "ERROR"
        }
        api.reportPrinterStatus(
            printerId = printerId,
            status = status,
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
                Intent(this, ConnectorSetupActivity::class.java),
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
