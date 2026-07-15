package com.yunqiao.life.merchantterminal.connector

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
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
import com.yunqiao.life.merchantterminal.security.SecretRedactor
import com.yunqiao.life.merchantterminal.security.TerminalCredentialStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ConnectorSetupActivity : AppCompatActivity() {
    private lateinit var binding: ActivityConnectorSetupBinding
    private lateinit var settings: ConnectorSettings
    private lateinit var credentials: TerminalCredentialStore
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
        credentials = TerminalCredentialStore(applicationContext)
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
        binding.pairTerminalButton.setOnClickListener { pairTerminal() }
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

    private fun pairTerminal() {
        val parsed = PairingPayload.parse(binding.pairingPayloadInput.text?.toString().orEmpty())
        val name = binding.terminalNameInput.text?.toString()?.trim().orEmpty()
            .ifBlank { "Android Terminal" }
        if (parsed == null) {
            binding.pairingPayloadInput.text?.clear()
            binding.pairingResultText.setText(R.string.connector_pair_invalid)
            return
        }
        binding.pairingPayloadInput.text?.clear()
        binding.pairTerminalButton.isEnabled = false
        lifecycleScope.launch {
            val outcome = withContext(Dispatchers.IO) {
                runCatching {
                    val installId = settings.ensureInstallId()
                    ConnectorApiClient(credentialProvider = { null }).pair(
                        PairingRequest(
                            pairingId = parsed.pairingId,
                            pairingCode = parsed.code,
                            deviceIdentifier = installId,
                            name = name,
                        ),
                    )
                }
            }
            outcome.onSuccess { result ->
                withContext(Dispatchers.IO) {
                    // A consumed pairing code creates a new terminal identity. Remove any stale
                    // merchant-scoped ledger, receipt key and USB binding before saving it.
                    TerminalIdentityReset.clear(applicationContext)
                    credentials.save(result.token)
                    settings.savePairing(result.terminalId, result.merchantId, result.terminalName)
                    ConnectorStartGate.update(applicationContext, settings.snapshot(), true)
                }
                binding.pairingResultText.setText(R.string.connector_pair_success)
            }.onFailure { error ->
                binding.pairingResultText.text = when (error) {
                    is ConnectorApiException -> "${error.errorCode}: ${SecretRedactor.safeError(error.message)}"
                    else -> error.javaClass.simpleName
                }
            }
            binding.pairTerminalButton.isEnabled = true
            refreshStatus(fetchRemote = outcome.isSuccess)
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
            if (!credentials.hasCredential() || snapshot.terminalId == null || !usbReady ||
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
                    settings.applyRemoteConfig(
                        executionEnabled = remote.executionEnabled && remote.taskCenterEnabled &&
                            remote.merchantPrintingEnabled,
                        terminalEnabled = remote.terminalEnabled,
                        printerEnabled = remote.boundPrinterEnabled,
                        automaticPrintingEnabled = remote.automaticPrintingEnabled,
                        pollIntervalMs = remote.pollIntervalMs,
                        heartbeatIntervalMs = remote.heartbeatIntervalMs,
                    )
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
                    client.heartbeat(
                        diagnostics = JSONObject()
                            .put("source", "CONNECTOR_SETUP")
                            .put("usbConfigured", settings.snapshot().usbBinding != null),
                        heartbeatSequence = settings.nextHeartbeatSequence(),
                        activeJobIds = printingDao.activeJobIds(
                            statuses = listOf(
                                LocalJobStatus.CLAIMED,
                                LocalJobStatus.PRINTING,
                                LocalJobStatus.PRINTED_PENDING_REPORT,
                                LocalJobStatus.FAILED_PENDING_REPORT,
                                LocalJobStatus.UNCERTAIN_PENDING_REPORT,
                            ),
                            limit = 20,
                        ),
                        appliedConfigVersion = settings.snapshot().appliedConfigVersion,
                    )
                    Unit
                }.onFailure { error ->
                    if (error is ConnectorApiException && error.invalidTerminalCredential) {
                        TerminalIdentityReset.clear(applicationContext)
                    } else {
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
            appendLine("Paired: ${credentials.hasCredential() && snapshot.terminalId != null}")
            appendLine("Terminal: ${snapshot.terminalId ?: "NONE"}")
            appendLine("Merchant: ${snapshot.merchantId ?: "NONE"}")
            appendLine("Local connector: ${snapshot.connectorEnabled}")
            appendLine("Local automatic: ${snapshot.automaticPrintingEnabled}")
            appendLine("Remote terminal/execution/printer/automatic: ${snapshot.remoteTerminalEnabled}/" +
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
        binding.pairTerminalButton.isEnabled = !credentials.hasCredential() && ConnectorApiConfig.isConfigured
        binding.clearLocalPairingButton.isEnabled = credentials.hasCredential()
    }

    private fun enterImmersiveMode() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}

data class PairingPayload(val pairingId: String, val code: String) {
    companion object {
        private val PATTERN = Regex(
            "^ytpair:v1:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}):([0-9]{8})$",
        )

        fun parse(value: String): PairingPayload? {
            val match = PATTERN.matchEntire(value.trim()) ?: return null
            return PairingPayload(match.groupValues[1], match.groupValues[2])
        }
    }
}
