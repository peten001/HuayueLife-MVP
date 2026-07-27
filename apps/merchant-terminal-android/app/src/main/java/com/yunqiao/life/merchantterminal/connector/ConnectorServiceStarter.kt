package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.security.MerchantSessionTokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

enum class ConnectorStartResult {
    STARTED,
    NOT_CONFIGURED,
    NOT_ELIGIBLE,
    USB_UNAVAILABLE,
    START_BLOCKED,
}

object ConnectorServiceStarter {
    suspend fun startIfEligible(context: Context): ConnectorStartResult {
        val app = context.applicationContext
        if (!ConnectorApiConfig.isConfigured) return ConnectorStartResult.NOT_CONFIGURED
        val credentials = MerchantSessionTokenStore(app)
        val settingsStore = ConnectorSettings(app)
        val settings = settingsStore.snapshot()
        ConnectorStartGate.update(app, settings, credentials.hasCredential())
        if (!settings.remoteStartAllowed || !credentials.hasCredential()) {
            return ConnectorStartResult.NOT_ELIGIBLE
        }
        val binding = settings.usbBinding ?: return ConnectorStartResult.USB_UNAVAILABLE
        val resolution = UsbBindingResolver.resolve(binding, UsbDeviceInspector(app).scan())
        if (resolution !is UsbBindingResolution.Ready) return ConnectorStartResult.USB_UNAVAILABLE
        settingsStore.updateRuntimeUsbDeviceName(binding, resolution.device.deviceName)
        return runCatching {
            ContextCompat.startForegroundService(
                app,
                Intent(app, PrinterConnectorService::class.java),
            )
            ConnectorStartResult.STARTED
        }.getOrElse { ConnectorStartResult.START_BLOCKED }
    }

    /** Fetches the server capability gate before attempting a foreground-service start. */
    suspend fun refreshRemoteConfigAndStart(context: Context): ConnectorStartResult =
        withContext(Dispatchers.IO) {
            val app = context.applicationContext
            if (!ConnectorApiConfig.isConfigured) return@withContext ConnectorStartResult.NOT_CONFIGURED
            val credentials = MerchantSessionTokenStore(app)
            if (!credentials.hasCredential()) return@withContext ConnectorStartResult.NOT_ELIGIBLE
            val settings = ConnectorSettings(app)
            try {
                val remote = ConnectorApiClient(credentials::read).config()
                if (!settings.bindMerchantScopeIfAbsent(remote.merchantId)) {
                    settings.recordError("MERCHANT_SCOPE_MISMATCH")
                    return@withContext ConnectorStartResult.NOT_ELIGIBLE
                }
                val before = settings.snapshot()
                val startBlock = ConnectorPrintExecutionPolicy.remoteStartBlockCode(
                    remote = remote,
                    expectedMerchantId = before.merchantId,
                    expectedPrinterId = before.usbBinding?.printerId,
                )
                settings.applyRemoteConfig(
                    executionEnabled = startBlock == null,
                    printerEnabled = remote.boundPrinterEnabled,
                    startAllowed = startBlock == null,
                    automaticPrintingEnabled = remote.automaticPrintingEnabled,
                    pollIntervalMs = remote.pollIntervalMs,
                    configRefreshIntervalMs = remote.configRefreshIntervalMs,
                )
                settings.associatePrinterId(remote.boundPrinterId)
                settings.recordError(startBlock)
                startIfEligible(app)
            } catch (error: ConnectorApiException) {
                settings.recordError(error.errorCode)
                if (error.invalidMerchantSession) MerchantSessionShutdown.clear(app)
                ConnectorStartResult.NOT_ELIGIBLE
            }
        }

    fun stop(context: Context) {
        context.applicationContext.stopService(
            Intent(context.applicationContext, PrinterConnectorService::class.java),
        )
    }
}
