package com.yunqiao.life.merchantterminal.connector

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.databinding.ActivityConnectorControlBinding
import com.yunqiao.life.merchantterminal.diagnostics.UsbPrinterDiagnosticsActivity
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.security.MerchantSessionTokenStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Read-only local USB status backed by platform and merchant-admin configuration. */
class ConnectorControlActivity : AppCompatActivity() {
    private lateinit var binding: ActivityConnectorControlBinding
    private lateinit var settings: ConnectorSettings
    private lateinit var merchantSession: MerchantSessionTokenStore
    private var connectorStartPending = false
    private var connectorUiErrorCode: String? = null

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) reconnectConnector()
        else {
            connectorStartPending = false
            connectorUiErrorCode = "POST_NOTIFICATIONS_DENIED"
            lifecycleScope.launch { refreshStatus(fetchRemote = false) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        binding = ActivityConnectorControlBinding.inflate(layoutInflater)
        setContentView(binding.root)
        applySafeInsets()
        settings = ConnectorSettings(applicationContext)
        merchantSession = MerchantSessionTokenStore(applicationContext)
        configureActions()
        lifecycleScope.launch { refreshStatus(fetchRemote = false) }
        enterImmersiveMode()
    }

    override fun onStart() {
        super.onStart()
        lifecycleScope.launch { refreshStatus(fetchRemote = true) }
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch { refreshStatus(fetchRemote = false) }
        enterImmersiveMode()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    private fun configureActions() {
        binding.closeConnectorControlButton.setOnClickListener { finish() }
        binding.openUsbDiagnosticsButton.setOnClickListener {
            startActivity(Intent(this, UsbPrinterDiagnosticsActivity::class.java))
        }
        binding.refreshConnectorStatusButton.setOnClickListener {
            lifecycleScope.launch { refreshStatus(fetchRemote = true) }
        }
        binding.reconnectConnectorButton.setOnClickListener(::requestReconnect)
    }

    private fun requestReconnect(@Suppress("UNUSED_PARAMETER") view: android.view.View) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            reconnectConnector()
        }
    }

    private fun reconnectConnector() {
        connectorStartPending = true
        connectorUiErrorCode = null
        lifecycleScope.launch { refreshStatus(fetchRemote = true) }
    }

    private suspend fun refreshStatus(fetchRemote: Boolean) {
        if (fetchRemote && merchantSession.hasCredential() && ConnectorApiConfig.isConfigured) {
            connectorStartPending = true
            connectorUiErrorCode = when (ConnectorServiceStarter.startIfEligible(applicationContext)) {
                ConnectorStartResult.START_BLOCKED -> "FGS_START_BLOCKED"
                else -> null
            }
            connectorStartPending = false
        }

        val snapshot = settings.snapshot()
        val usbResolutionCode = withContext(Dispatchers.IO) {
            snapshot.usbBinding?.let { binding ->
                when (val resolution = UsbBindingResolver.resolve(
                    binding,
                    UsbDeviceInspector(applicationContext).scan(),
                )) {
                    is UsbBindingResolution.Ready -> USB_READY
                    is UsbBindingResolution.Unavailable -> resolution.errorCode
                }
            }
        }
        renderConnectorControls(
            connectorControlUi(
                snapshot = snapshot,
                serviceActive = ConnectorRuntimeState.serviceActive,
                startPending = connectorStartPending,
                usbResolutionCode = usbResolutionCode,
                transientErrorCode = connectorUiErrorCode,
            ),
        )
    }

    internal fun renderConnectorControls(connectorUi: ConnectorControlUi) {
        binding.platformCapabilityValue.setText(
            when (connectorUi.capability) {
                ConnectorCapabilityState.ENABLED -> R.string.connector_capability_enabled
                ConnectorCapabilityState.DISABLED -> R.string.connector_capability_disabled
                ConnectorCapabilityState.UNKNOWN -> R.string.connector_state_unknown
            },
        )
        binding.merchantConfigurationValue.setText(
            when (connectorUi.configuration) {
                ConnectorConfigurationState.CONFIGURED -> R.string.connector_configuration_configured
                ConnectorConfigurationState.NOT_CONFIGURED ->
                    R.string.connector_configuration_not_configured
                ConnectorConfigurationState.DISABLED -> R.string.connector_configuration_disabled
                ConnectorConfigurationState.UNKNOWN -> R.string.connector_state_unknown
            },
        )
        binding.usbConnectionValue.setText(
            when (connectorUi.connection) {
                ConnectorConnectionState.CONNECTED -> R.string.connector_connection_connected
                ConnectorConnectionState.OFFLINE -> R.string.connector_connection_offline
                ConnectorConnectionState.RECONNECTING -> R.string.connector_connection_reconnecting
                ConnectorConnectionState.WAITING_PERMISSION ->
                    R.string.connector_connection_waiting_permission
                ConnectorConnectionState.NOT_DETECTED ->
                    R.string.connector_connection_not_detected
                ConnectorConnectionState.UNKNOWN -> R.string.connector_state_unknown
            },
        )
        binding.automaticPrintingValue.setText(
            when (connectorUi.automaticPrinting) {
                ConnectorAutomaticState.ENABLED -> R.string.connector_automatic_enabled
                ConnectorAutomaticState.DISABLED -> R.string.connector_automatic_disabled
                ConnectorAutomaticState.UNKNOWN -> R.string.connector_state_unknown
            },
        )
        binding.lastConnectionValue.text = connectorUi.lastSuccessfulConnectionAt
            ?.let(::formatTimestamp)
            ?: getString(R.string.connector_never_connected)
        binding.lastErrorValue.text = connectorUi.lastErrorCode
            ?: getString(R.string.connector_no_recorded_error)
        binding.connectorMessageText.setText(
            when {
                !merchantSession.hasCredential() -> R.string.connector_session_required
                connectorUi.capability == ConnectorCapabilityState.DISABLED ->
                    R.string.connector_platform_disabled_message
                connectorUi.configuration == ConnectorConfigurationState.NOT_CONFIGURED ->
                    R.string.connector_not_configured_message
                connectorUi.configuration == ConnectorConfigurationState.DISABLED ->
                    R.string.connector_printer_disabled_message
                connectorUi.connection == ConnectorConnectionState.WAITING_PERMISSION ->
                    R.string.connector_permission_required_message
                connectorUi.connection == ConnectorConnectionState.NOT_DETECTED ->
                    R.string.connector_device_not_detected_message
                else -> R.string.connector_read_only_note
            },
        )
    }

    private fun formatTimestamp(value: Long): String = SimpleDateFormat(
        "yyyy-MM-dd HH:mm:ss",
        Locale.getDefault(),
    ).format(Date(value))

    private fun applySafeInsets() {
        val basePadding = (16 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(binding.connectorControlRoot) { view, insets ->
            val safe = insets.getInsetsIgnoringVisibility(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            view.setPadding(
                basePadding + safe.left,
                basePadding + safe.top,
                basePadding + safe.right,
                basePadding + safe.bottom,
            )
            insets
        }
        ViewCompat.requestApplyInsets(binding.connectorControlRoot)
    }

    private fun enterImmersiveMode() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private companion object { const val USB_READY = "USB_READY" }
}

internal enum class ConnectorCapabilityState { ENABLED, DISABLED, UNKNOWN }
internal enum class ConnectorConfigurationState { CONFIGURED, NOT_CONFIGURED, DISABLED, UNKNOWN }
internal enum class ConnectorConnectionState {
    CONNECTED,
    OFFLINE,
    RECONNECTING,
    WAITING_PERMISSION,
    NOT_DETECTED,
    UNKNOWN,
}
internal enum class ConnectorAutomaticState { ENABLED, DISABLED, UNKNOWN }

internal data class ConnectorControlUi(
    val capability: ConnectorCapabilityState,
    val configuration: ConnectorConfigurationState,
    val connection: ConnectorConnectionState,
    val automaticPrinting: ConnectorAutomaticState,
    val lastSuccessfulConnectionAt: Long?,
    val lastErrorCode: String?,
)

internal fun connectorControlUi(
    snapshot: ConnectorSettingsSnapshot,
    serviceActive: Boolean,
    startPending: Boolean = false,
    usbResolutionCode: String? = null,
    transientErrorCode: String? = null,
): ConnectorControlUi {
    val capability = when {
        !snapshot.remoteConfigKnown -> ConnectorCapabilityState.UNKNOWN
        snapshot.remoteMerchantPrintingEnabled -> ConnectorCapabilityState.ENABLED
        else -> ConnectorCapabilityState.DISABLED
    }
    val configuration = when {
        !snapshot.remoteConfigKnown -> ConnectorConfigurationState.UNKNOWN
        !snapshot.remotePrinterConfigured -> ConnectorConfigurationState.NOT_CONFIGURED
        !snapshot.remotePrinterEnabled -> ConnectorConfigurationState.DISABLED
        else -> ConnectorConfigurationState.CONFIGURED
    }
    val connection = when {
        startPending -> ConnectorConnectionState.RECONNECTING
        // USB I/O is opened per print job. Resolver Ready proves the saved device identity,
        // Android permission and bulk-out endpoint are all currently usable.
        usbResolutionCode == "USB_READY" -> ConnectorConnectionState.CONNECTED
        usbResolutionCode == "USB_PERMISSION_REQUIRED" -> ConnectorConnectionState.WAITING_PERMISSION
        usbResolutionCode == "USB_DEVICE_NOT_FOUND" -> if (serviceActive) {
            ConnectorConnectionState.RECONNECTING
        } else {
            ConnectorConnectionState.NOT_DETECTED
        }
        usbResolutionCode != null -> ConnectorConnectionState.OFFLINE
        snapshot.usbBinding == null -> ConnectorConnectionState.UNKNOWN
        else -> ConnectorConnectionState.OFFLINE
    }
    val automatic = when {
        !snapshot.remoteConfigKnown -> ConnectorAutomaticState.UNKNOWN
        snapshot.remoteAutomaticPrintingEnabled -> ConnectorAutomaticState.ENABLED
        else -> ConnectorAutomaticState.DISABLED
    }
    return ConnectorControlUi(
        capability = capability,
        configuration = configuration,
        connection = connection,
        automaticPrinting = automatic,
        lastSuccessfulConnectionAt = snapshot.lastSuccessfulConnectionAt,
        lastErrorCode = transientErrorCode ?: snapshot.lastErrorCode,
    )
}
