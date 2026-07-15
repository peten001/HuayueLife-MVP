package com.yunqiao.life.merchantterminal.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import java.util.UUID

private val Context.connectorSettingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "connector_settings",
)

data class UsbPrinterBinding(
    val printerId: String?,
    val deviceName: String,
    val vendorId: Int,
    val productId: Int,
    val interfaceIndex: Int,
    val interfaceId: Int,
    val alternateSetting: Int,
    val endpointAddress: Int,
    val paperWidth: PaperWidth,
    val customDots: Int?,
    val threshold: Int,
    val cutMode: CutMode,
) {
    init {
        require(deviceName.isNotBlank())
        require(vendorId in 0..0xffff && productId in 0..0xffff)
        require(interfaceIndex >= 0 && interfaceId >= 0 && alternateSetting >= 0)
        require(endpointAddress in 0..0xff)
        require(threshold in 0..255)
        if (paperWidth == PaperWidth.CUSTOM) require(customDots in 200..1_024)
    }
}

data class ConnectorSettingsSnapshot(
    val installId: String,
    val terminalId: String? = null,
    val merchantId: String? = null,
    val terminalName: String? = null,
    val connectorEnabled: Boolean = false,
    val automaticPrintingEnabled: Boolean = false,
    val remoteExecutionEnabled: Boolean = false,
    val remoteTerminalEnabled: Boolean = false,
    val remotePrinterEnabled: Boolean = false,
    val remoteAutomaticPrintingEnabled: Boolean = false,
    val pollIntervalMs: Long = 7_000,
    val heartbeatIntervalMs: Long = 30_000,
    val heartbeatSequence: Long = 0,
    val usbBinding: UsbPrinterBinding? = null,
    /** Server printer association is retained even before the USB descriptor is saved. */
    val boundPrinterId: String? = null,
    val lastErrorCode: String? = null,
    val lastSuccessfulPrintAt: Long? = null,
    val appliedConfigVersion: Long? = null,
) {
    val canExecute: Boolean
        get() = connectorEnabled && remoteExecutionEnabled &&
            remotePrinterEnabled && usbBinding?.printerId != null

    val canClaimAutomatic: Boolean
        get() = canExecute && automaticPrintingEnabled && remoteAutomaticPrintingEnabled
}

class ConnectorSettings(context: Context) {
    private val dataStore = context.applicationContext.connectorSettingsDataStore

    val values: Flow<ConnectorSettingsSnapshot> = dataStore.data
        .catch { throwable ->
            if (throwable is IOException) emit(emptyPreferences()) else throw throwable
        }
        .map(::toSnapshot)

    suspend fun snapshot(): ConnectorSettingsSnapshot = values.first()

    suspend fun ensureInstallId(): String {
        val current = snapshot().installId
        if (current.isNotBlank()) return current
        val generated = UUID.randomUUID().toString()
        dataStore.edit { preferences ->
            if (preferences[Keys.INSTALL_ID].isNullOrBlank()) preferences[Keys.INSTALL_ID] = generated
        }
        return snapshot().installId
    }

    suspend fun savePairing(terminalId: String, merchantId: String, terminalName: String) {
        dataStore.edit { preferences ->
            preferences[Keys.TERMINAL_ID] = terminalId.take(MAX_ID_LENGTH)
            preferences[Keys.MERCHANT_ID] = merchantId.take(MAX_ID_LENGTH)
            preferences[Keys.TERMINAL_NAME] = terminalName.take(MAX_NAME_LENGTH)
            preferences[Keys.CONNECTOR_ENABLED] = false
            preferences[Keys.AUTO_PRINTING_ENABLED] = false
            preferences[Keys.REMOTE_EXECUTION_ENABLED] = false
            preferences[Keys.REMOTE_TERMINAL_ENABLED] = false
            preferences[Keys.REMOTE_PRINTER_ENABLED] = false
            preferences[Keys.REMOTE_AUTO_PRINTING_ENABLED] = false
        }
    }

    suspend fun clearPairing() {
        dataStore.edit { preferences ->
            preferences.remove(Keys.TERMINAL_ID)
            preferences.remove(Keys.MERCHANT_ID)
            preferences.remove(Keys.TERMINAL_NAME)
            preferences[Keys.CONNECTOR_ENABLED] = false
            preferences[Keys.AUTO_PRINTING_ENABLED] = false
            preferences[Keys.REMOTE_EXECUTION_ENABLED] = false
            preferences[Keys.REMOTE_TERMINAL_ENABLED] = false
            preferences[Keys.REMOTE_PRINTER_ENABLED] = false
            preferences[Keys.REMOTE_AUTO_PRINTING_ENABLED] = false
            preferences.remove(Keys.HEARTBEAT_SEQUENCE)
            preferences.remove(Keys.LAST_ERROR_CODE)
            preferences.remove(Keys.LAST_SUCCESSFUL_PRINT_AT)
            preferences.remove(Keys.APPLIED_CONFIG_VERSION)
        }
    }

    suspend fun setConnectorEnabled(enabled: Boolean) {
        dataStore.edit { it[Keys.CONNECTOR_ENABLED] = enabled }
    }

    suspend fun setAutomaticPrintingEnabled(enabled: Boolean) {
        dataStore.edit { it[Keys.AUTO_PRINTING_ENABLED] = enabled }
    }

    suspend fun applyRemoteConfig(
        executionEnabled: Boolean,
        terminalEnabled: Boolean,
        printerEnabled: Boolean,
        automaticPrintingEnabled: Boolean,
        pollIntervalMs: Long,
        heartbeatIntervalMs: Long,
    ) {
        dataStore.edit { preferences ->
            preferences[Keys.REMOTE_EXECUTION_ENABLED] = executionEnabled
            preferences[Keys.REMOTE_TERMINAL_ENABLED] = terminalEnabled
            preferences[Keys.REMOTE_PRINTER_ENABLED] = printerEnabled
            preferences[Keys.REMOTE_AUTO_PRINTING_ENABLED] = automaticPrintingEnabled
            preferences[Keys.AUTO_PRINTING_ENABLED] =
                preferences[Keys.AUTO_PRINTING_ENABLED] == true && automaticPrintingEnabled
            preferences[Keys.POLL_INTERVAL_MS] = pollIntervalMs.coerceIn(5_000, 30_000)
            preferences[Keys.HEARTBEAT_INTERVAL_MS] = heartbeatIntervalMs.coerceIn(10_000, 60_000)
        }
    }

    suspend fun saveUsbBinding(binding: UsbPrinterBinding) {
        dataStore.edit { preferences ->
            binding.printerId?.let { preferences[Keys.PRINTER_ID] = it.take(MAX_ID_LENGTH) }
                ?: preferences.remove(Keys.PRINTER_ID)
            preferences[Keys.USB_DEVICE_NAME] = binding.deviceName.take(MAX_DEVICE_NAME_LENGTH)
            preferences[Keys.USB_VENDOR_ID] = binding.vendorId
            preferences[Keys.USB_PRODUCT_ID] = binding.productId
            preferences[Keys.USB_INTERFACE_INDEX] = binding.interfaceIndex
            preferences[Keys.USB_INTERFACE_ID] = binding.interfaceId
            preferences[Keys.USB_ALTERNATE_SETTING] = binding.alternateSetting
            preferences[Keys.USB_ENDPOINT_ADDRESS] = binding.endpointAddress
            preferences[Keys.PAPER_WIDTH] = binding.paperWidth.name
            binding.customDots?.let { preferences[Keys.CUSTOM_DOTS] = it }
                ?: preferences.remove(Keys.CUSTOM_DOTS)
            preferences[Keys.IMAGE_THRESHOLD] = binding.threshold
            preferences[Keys.CUT_MODE] = binding.cutMode.name
            // Saving a device never enables execution or automatic printing.
        }
    }

    suspend fun associatePrinterId(printerId: String?) {
        dataStore.edit { preferences ->
            printerId?.takeIf(String::isNotBlank)?.let {
                preferences[Keys.PRINTER_ID] = it.take(MAX_ID_LENGTH)
            } ?: preferences.remove(Keys.PRINTER_ID)
        }
    }

    suspend fun clearUsbBinding() {
        dataStore.edit { preferences ->
            preferences.remove(Keys.PRINTER_ID)
            preferences.remove(Keys.USB_DEVICE_NAME)
            preferences.remove(Keys.USB_VENDOR_ID)
            preferences.remove(Keys.USB_PRODUCT_ID)
            preferences.remove(Keys.USB_INTERFACE_INDEX)
            preferences.remove(Keys.USB_INTERFACE_ID)
            preferences.remove(Keys.USB_ALTERNATE_SETTING)
            preferences.remove(Keys.USB_ENDPOINT_ADDRESS)
            preferences.remove(Keys.PAPER_WIDTH)
            preferences.remove(Keys.CUSTOM_DOTS)
            preferences.remove(Keys.IMAGE_THRESHOLD)
            preferences.remove(Keys.CUT_MODE)
            preferences[Keys.AUTO_PRINTING_ENABLED] = false
        }
    }

    suspend fun markConfigApplied(configVersion: Long) {
        require(configVersion >= 0)
        dataStore.edit { it[Keys.APPLIED_CONFIG_VERSION] = configVersion }
    }

    suspend fun nextHeartbeatSequence(): Long {
        var next = 1L
        dataStore.edit { preferences ->
            next = (preferences[Keys.HEARTBEAT_SEQUENCE] ?: 0L).plus(1).coerceAtLeast(1)
            preferences[Keys.HEARTBEAT_SEQUENCE] = next
        }
        return next
    }

    suspend fun recordError(code: String?) {
        dataStore.edit { preferences ->
            code?.takeIf(String::isNotBlank)?.let {
                preferences[Keys.LAST_ERROR_CODE] = it.take(120)
            } ?: preferences.remove(Keys.LAST_ERROR_CODE)
        }
    }

    suspend fun recordPrintSuccess(timestamp: Long = System.currentTimeMillis()) {
        dataStore.edit { preferences ->
            preferences[Keys.LAST_SUCCESSFUL_PRINT_AT] = timestamp
            preferences.remove(Keys.LAST_ERROR_CODE)
        }
    }

    private fun toSnapshot(preferences: Preferences): ConnectorSettingsSnapshot {
        val deviceName = preferences[Keys.USB_DEVICE_NAME]
        val paperWidth = preferences[Keys.PAPER_WIDTH]
            ?.let { runCatching { PaperWidth.valueOf(it) }.getOrNull() }
        val cutMode = preferences[Keys.CUT_MODE]
            ?.let { runCatching { CutMode.valueOf(it) }.getOrNull() }
            ?: CutMode.NONE
        val binding = if (
            deviceName != null && paperWidth != null &&
            preferences[Keys.USB_VENDOR_ID] != null &&
            preferences[Keys.USB_PRODUCT_ID] != null &&
            preferences[Keys.USB_INTERFACE_INDEX] != null &&
            preferences[Keys.USB_INTERFACE_ID] != null &&
            preferences[Keys.USB_ALTERNATE_SETTING] != null &&
            preferences[Keys.USB_ENDPOINT_ADDRESS] != null
        ) {
            runCatching {
                UsbPrinterBinding(
                    printerId = preferences[Keys.PRINTER_ID],
                    deviceName = deviceName,
                    vendorId = preferences[Keys.USB_VENDOR_ID]!!,
                    productId = preferences[Keys.USB_PRODUCT_ID]!!,
                    interfaceIndex = preferences[Keys.USB_INTERFACE_INDEX]!!,
                    interfaceId = preferences[Keys.USB_INTERFACE_ID]!!,
                    alternateSetting = preferences[Keys.USB_ALTERNATE_SETTING]!!,
                    endpointAddress = preferences[Keys.USB_ENDPOINT_ADDRESS]!!,
                    paperWidth = paperWidth,
                    customDots = preferences[Keys.CUSTOM_DOTS],
                    threshold = preferences[Keys.IMAGE_THRESHOLD] ?: 160,
                    cutMode = cutMode,
                )
            }.getOrNull()
        } else null

        return ConnectorSettingsSnapshot(
            installId = preferences[Keys.INSTALL_ID].orEmpty(),
            terminalId = preferences[Keys.TERMINAL_ID],
            merchantId = preferences[Keys.MERCHANT_ID],
            terminalName = preferences[Keys.TERMINAL_NAME],
            connectorEnabled = preferences[Keys.CONNECTOR_ENABLED] ?: false,
            automaticPrintingEnabled = preferences[Keys.AUTO_PRINTING_ENABLED] ?: false,
            remoteExecutionEnabled = preferences[Keys.REMOTE_EXECUTION_ENABLED] ?: false,
            remoteTerminalEnabled = preferences[Keys.REMOTE_TERMINAL_ENABLED] ?: false,
            remotePrinterEnabled = preferences[Keys.REMOTE_PRINTER_ENABLED] ?: false,
            remoteAutomaticPrintingEnabled =
                preferences[Keys.REMOTE_AUTO_PRINTING_ENABLED] ?: false,
            pollIntervalMs = preferences[Keys.POLL_INTERVAL_MS] ?: 7_000,
            heartbeatIntervalMs = preferences[Keys.HEARTBEAT_INTERVAL_MS] ?: 30_000,
            heartbeatSequence = preferences[Keys.HEARTBEAT_SEQUENCE] ?: 0,
            usbBinding = binding,
            boundPrinterId = preferences[Keys.PRINTER_ID],
            lastErrorCode = preferences[Keys.LAST_ERROR_CODE],
            lastSuccessfulPrintAt = preferences[Keys.LAST_SUCCESSFUL_PRINT_AT],
            appliedConfigVersion = preferences[Keys.APPLIED_CONFIG_VERSION],
        )
    }

    private object Keys {
        val INSTALL_ID = stringPreferencesKey("install_id")
        val TERMINAL_ID = stringPreferencesKey("terminal_id")
        val MERCHANT_ID = stringPreferencesKey("merchant_id")
        val TERMINAL_NAME = stringPreferencesKey("terminal_name")
        val CONNECTOR_ENABLED = booleanPreferencesKey("connector_enabled")
        val AUTO_PRINTING_ENABLED = booleanPreferencesKey("automatic_printing_enabled")
        val REMOTE_EXECUTION_ENABLED = booleanPreferencesKey("remote_execution_enabled")
        val REMOTE_TERMINAL_ENABLED = booleanPreferencesKey("remote_terminal_enabled")
        val REMOTE_PRINTER_ENABLED = booleanPreferencesKey("remote_printer_enabled")
        val REMOTE_AUTO_PRINTING_ENABLED = booleanPreferencesKey("remote_automatic_printing_enabled")
        val POLL_INTERVAL_MS = longPreferencesKey("poll_interval_ms")
        val HEARTBEAT_INTERVAL_MS = longPreferencesKey("heartbeat_interval_ms")
        val HEARTBEAT_SEQUENCE = longPreferencesKey("heartbeat_sequence")
        val PRINTER_ID = stringPreferencesKey("printer_id")
        val USB_DEVICE_NAME = stringPreferencesKey("usb_device_name")
        val USB_VENDOR_ID = intPreferencesKey("usb_vendor_id")
        val USB_PRODUCT_ID = intPreferencesKey("usb_product_id")
        val USB_INTERFACE_INDEX = intPreferencesKey("usb_interface_index")
        val USB_INTERFACE_ID = intPreferencesKey("usb_interface_id")
        val USB_ALTERNATE_SETTING = intPreferencesKey("usb_alternate_setting")
        val USB_ENDPOINT_ADDRESS = intPreferencesKey("usb_endpoint_address")
        val PAPER_WIDTH = stringPreferencesKey("paper_width")
        val CUSTOM_DOTS = intPreferencesKey("custom_dots")
        val IMAGE_THRESHOLD = intPreferencesKey("image_threshold")
        val CUT_MODE = stringPreferencesKey("cut_mode")
        val LAST_ERROR_CODE = stringPreferencesKey("last_error_code")
        val LAST_SUCCESSFUL_PRINT_AT = longPreferencesKey("last_successful_print_at")
        val APPLIED_CONFIG_VERSION = longPreferencesKey("applied_config_version")
    }

    private companion object {
        const val MAX_ID_LENGTH = 128
        const val MAX_NAME_LENGTH = 100
        const val MAX_DEVICE_NAME_LENGTH = 512
    }
}
