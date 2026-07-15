package com.yunqiao.life.merchantterminal.connector

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.local.LocalJobStatus
import com.yunqiao.life.merchantterminal.data.local.LocalPrintingDatabase
import com.yunqiao.life.merchantterminal.databinding.ActivityConnectorSetupBinding
import com.yunqiao.life.merchantterminal.diagnostics.UsbPrinterDiagnosticsActivity
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.security.MerchantSessionTokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ConnectorSetupActivity : AppCompatActivity() {
    private lateinit var binding: ActivityConnectorSetupBinding
    private lateinit var settings: ConnectorSettings
    private lateinit var credentials: MerchantSessionTokenStore
    private var suppressSwitchCallbacks = false

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) enableConnector()
        else {
            binding.pairingResultText.setText(R.string.connector_notification_denied)
            lifecycleScope.launch { refreshStatus(fetchRemote = false) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        binding = ActivityConnectorSetupBinding.inflate(layoutInflater)
        setContentView(binding.root)
        settings = ConnectorSettings(applicationContext)
        credentials = MerchantSessionTokenStore(applicationContext)
        lifecycleScope.launch { settings.ensureInstallId() }
        configureActions()
        lifecycleScope.launch { refreshStatus(fetchRemote = false) }
        enterImmersiveMode()
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch { refreshStatus(fetchRemote = false) }
        enterImmersiveMode()
    }

    override fun onStart() {
        super.onStart()
        lifecycleScope.launch {
            if (ConnectorServiceStarter.startIfEligible(applicationContext) ==
                ConnectorStartResult.START_BLOCKED
            ) {
                binding.pairingResultText.setText(R.string.connector_fgs_start_blocked)
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    private fun configureActions() {
        binding.closeConnectorSetupButton.setOnClickListener { finish() }
        binding.openUsbSetupButton.setOnClickListener {
            startActivity(Intent(this, UsbPrinterDiagnosticsActivity::class.java))
        }
        binding.pairingPayloadInput.visibility = View.GONE
        binding.terminalNameInput.visibility = View.GONE
        binding.pairTerminalButton.visibility = View.GONE
        binding.refreshConnectorStatusButton.setOnClickListener {
            lifecycleScope.launch { refreshStatus(fetchRemote = true) }
        }
        binding.clearLocalPairingButton.setOnClickListener { requestClearLocalPairing() }
        binding.connectorEnabledSwitch.setOnCheckedChangeListener { _, enabled ->
            if (suppressSwitchCallbacks) return@setOnCheckedChangeListener
            if (enabled) requestEnableConnector() else disableConnector()
        }
        binding.automaticPrintingSwitch.setOnCheckedChangeListener { _, enabled ->
            if (suppressSwitchCallbacks) return@setOnCheckedChangeListener
            lifecycleScope.launch {
                settings.setAutomaticPrintingEnabled(enabled)
                refreshStatus(fetchRemote = false)
            }
        }
    }

    private fun requestEnableConnector() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            enableConnector()
        }
    }

    private fun enableConnector() {
        lifecycleScope.launch {
            val snapshot = settings.snapshot()
            val bindingConfig = snapshot.usbBinding
            val usbReady = bindingConfig != null && UsbBindingResolver.resolve(
                bindingConfig,
                UsbDeviceInspector(applicationContext).scan(),
            ) is UsbBindingResolution.Ready
            if (!credentials.hasCredential() || !usbReady ||
                !ConnectorApiConfig.isConfigured
            ) {
                binding.pairingResultText.setText(R.string.connector_enable_blocked)
                refreshStatus(fetchRemote = false)
                return@launch
            }
            settings.setConnectorEnabled(true)
            val updated = settings.snapshot()
            ConnectorStartGate.update(applicationContext, updated, true)
            ConnectorRecoveryScheduler.enable(applicationContext)
            ConnectorServiceStarter.startIfEligible(applicationContext)
            refreshStatus(fetchRemote = true)
        }
    }

    private fun disableConnector() {
        lifecycleScope.launch {
            settings.setConnectorEnabled(false)
            settings.setAutomaticPrintingEnabled(false)
            ConnectorStartGate.update(applicationContext, settings.snapshot(), credentials.hasCredential())
            ConnectorRecoveryScheduler.disable(applicationContext)
            ConnectorServiceStarter.stop(applicationContext)
            refreshStatus(fetchRemote = false)
        }
    }

    private fun requestClearLocalPairing() {
        if (!credentials.hasCredential()) return
        binding.clearLocalPairingButton.isEnabled = false
        lifecycleScope.launch {
            val counts = withContext(Dispatchers.IO) {
                runCatching {
                    val dao = LocalPrintingDatabase.get(applicationContext).printingDao()
                    val pending = dao.jobsWithStatuses(
                        listOf(
                            LocalJobStatus.PRINTED_PENDING_REPORT,
                            LocalJobStatus.FAILED_PENDING_REPORT,
                            LocalJobStatus.UNCERTAIN_PENDING_REPORT,
                        ),
                    ).size
                    val uncertain = dao.jobsWithStatuses(
                        listOf(LocalJobStatus.UNCERTAIN, LocalJobStatus.UNCERTAIN_PENDING_REPORT),
                    ).size
                    pending to uncertain
                }
            }.getOrElse { error ->
                binding.pairingResultText.text =
                    "LOCAL_LEDGER_READ_FAILED: ${error.javaClass.simpleName.take(50)}"
                binding.clearLocalPairingButton.isEnabled = credentials.hasCredential()
                return@launch
            }
            AlertDialog.Builder(this@ConnectorSetupActivity)
                .setTitle(R.string.connector_clear_confirmation_title)
                .setMessage(
                    getString(
                        R.string.connector_clear_confirmation_message,
                        counts.first,
                        counts.second,
                    ),
                )
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.connector_clear_confirmation_action) { _, _ ->
                    clearLocalPairingConfirmed()
                }
                .setOnDismissListener {
                    binding.clearLocalPairingButton.isEnabled = credentials.hasCredential()
                }
                .show()
        }
    }

    private fun clearLocalPairingConfirmed() {
        binding.clearLocalPairingButton.isEnabled = false
        lifecycleScope.launch(Dispatchers.IO) {
            TerminalIdentityReset.clear(applicationContext)
            withContext(Dispatchers.Main) {
                binding.pairingResultText.setText(R.string.connector_local_pairing_cleared)
                refreshStatus(fetchRemote = false)
            }
        }
    }

    private suspend fun refreshStatus(fetchRemote: Boolean) {
        if (fetchRemote && credentials.hasCredential() && ConnectorApiConfig.isConfigured) {
            withContext(Dispatchers.IO) {
                val client = ConnectorApiClient(credentials::read)
                runCatching {
                    val remote = client.config()
                    if (!settings.bindMerchantScopeIfAbsent(remote.merchantId)) {
                        settings.applyRemoteConfig(
                            executionEnabled = false,
                            terminalEnabled = true,
                            printerEnabled = false,
                            automaticPrintingEnabled = false,
                            pollIntervalMs = remote.pollIntervalMs,
                            configRefreshIntervalMs = remote.configRefreshIntervalMs,
                        )
                        settings.recordError("MERCHANT_SCOPE_MISMATCH")
                        return@runCatching
                    }
                    val scoped = settings.snapshot()
                    val remoteBlock = ConnectorPrintExecutionPolicy.remoteBlockCode(
                        remote = remote,
                        expectedMerchantId = scoped.merchantId,
                        expectedPrinterId = scoped.usbBinding?.printerId,
                    )
                    settings.applyRemoteConfig(
                        executionEnabled = remoteBlock == null,
                        terminalEnabled = true,
                        printerEnabled = remoteBlock == null,
                        automaticPrintingEnabled = remote.automaticPrintingEnabled,
                        pollIntervalMs = remote.pollIntervalMs,
                        configRefreshIntervalMs = remote.configRefreshIntervalMs,
                    )
                    settings.recordError(remoteBlock)
                    settings.associatePrinterId(remote.boundPrinterId)
                    val printingDao = LocalPrintingDatabase.get(applicationContext).printingDao()
                    printingDao.printerBinding()?.let { localBinding ->
                        printingDao.savePrinterBinding(
                            localBinding.copy(
                                printerId = remote.boundPrinterId,
                                updatedAt = System.currentTimeMillis(),
                            ),
                        )
                    }
                    remote.resetUsbConfigVersion?.let { resetVersion ->
                        if ((settings.snapshot().appliedConfigVersion ?: -1) < resetVersion) {
                            settings.clearUsbBinding()
                            LocalPrintingDatabase.get(applicationContext)
                                .printingDao().clearPrinterBinding()
                            settings.markConfigApplied(resetVersion)
                        }
                    }
                    Unit
                }.onFailure { error ->
                    if (error is ConnectorApiException && error.invalidMerchantSession) {
                        TerminalIdentityReset.clear(applicationContext)
                    } else {
                        if (error is ConnectorApiException && error.printingDisabled) {
                            settings.applyRemoteConfig(
                                executionEnabled = false,
                                terminalEnabled = true,
                                printerEnabled = false,
                                automaticPrintingEnabled = false,
                                pollIntervalMs = settings.snapshot().pollIntervalMs,
                                configRefreshIntervalMs =
                                    settings.snapshot().configRefreshIntervalMs,
                            )
                        }
                        settings.recordError(
                            (error as? ConnectorApiException)?.errorCode
                                ?: "CONNECTOR_CONFIG_REFRESH_FAILED",
                        )
                    }
                }
            }
        }
        val snapshot = settings.snapshot()
        val dao = LocalPrintingDatabase.get(applicationContext).printingDao()
        val uncertainCount = withContext(Dispatchers.IO) { dao.countByStatus(LocalJobStatus.UNCERTAIN) }
        val pendingReportCount = withContext(Dispatchers.IO) {
            dao.jobsWithStatuses(
                listOf(
                    LocalJobStatus.PRINTED_PENDING_REPORT,
                    LocalJobStatus.FAILED_PENDING_REPORT,
                    LocalJobStatus.UNCERTAIN_PENDING_REPORT,
                ),
            ).size
        }
        val usb = snapshot.usbBinding
        binding.connectorStatusText.text = buildString {
            appendLine("App: ${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_REVISION.take(12)})")
            appendLine("API: ${ConnectorApiConfig.sanitizedForDiagnostics()}")
            appendLine("Merchant session: ${credentials.hasCredential()}")
            appendLine("Local connector: ${snapshot.connectorEnabled}")
            appendLine("Local automatic: ${snapshot.automaticPrintingEnabled}")
            appendLine("Remote execution/printer/automatic: " +
                "${snapshot.remoteExecutionEnabled}/${snapshot.remotePrinterEnabled}/" +
                "${snapshot.remoteAutomaticPrintingEnabled}")
            appendLine("USB: ${usb?.let { "VID ${it.vendorId} PID ${it.productId} IF ${it.interfaceIndex} EP ${it.endpointAddress}" } ?: "NOT_CONFIGURED"}")
            appendLine("Pending reports: $pendingReportCount")
            appendLine("Uncertain jobs: $uncertainCount")
            append("Last error: ${snapshot.lastErrorCode ?: "NONE"}")
        }
        suppressSwitchCallbacks = true
        binding.connectorEnabledSwitch.isChecked = snapshot.connectorEnabled
        binding.automaticPrintingSwitch.isChecked = snapshot.automaticPrintingEnabled
        binding.automaticPrintingSwitch.isEnabled = snapshot.connectorEnabled &&
            snapshot.remoteExecutionEnabled && snapshot.remotePrinterEnabled &&
            snapshot.remoteAutomaticPrintingEnabled
        suppressSwitchCallbacks = false
        binding.clearLocalPairingButton.isEnabled = credentials.hasCredential()
    }

    private fun enterImmersiveMode() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}
