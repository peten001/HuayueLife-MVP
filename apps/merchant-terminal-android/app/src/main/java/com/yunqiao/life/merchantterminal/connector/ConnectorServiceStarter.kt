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
        val hasCredential = credentials.hasCredential()
        val cached = settingsStore.snapshot()
        ConnectorStartGate.update(app, cached, hasCredential)
        if (!hasCredential) {
            return ConnectorStartResult.NOT_ELIGIBLE
        }

        val settings = try {
            withContext(Dispatchers.IO) {
                val remote = ConnectorApiClient(credentials::read).config()
                applyConnectorRemoteConfig(app, settingsStore, remote).settings
            }
        } catch (error: ConnectorApiException) {
            settingsStore.recordError(error.errorCode)
            when {
                error.invalidMerchantSession -> {
                    MerchantSessionShutdown.clear(app)
                    return ConnectorStartResult.NOT_ELIGIBLE
                }
                error.printingDisabled -> {
                    settingsStore.applyRemoteConfig(
                        merchantPrintingEnabled = cached.remoteMerchantPrintingEnabled &&
                            error.errorCode !in setOf(
                                "PRINTING_NOT_ENABLED",
                                "MERCHANT_PRINTING_DISABLED",
                            ),
                        executionEnabled = false,
                        printerConfigured = cached.remotePrinterConfigured,
                        printerEnabled = cached.remotePrinterEnabled,
                        automaticPrintingEnabled = cached.remoteAutomaticPrintingEnabled,
                        pollIntervalMs = cached.pollIntervalMs,
                        configRefreshIntervalMs = cached.configRefreshIntervalMs,
                    )
                    val disabled = settingsStore.snapshot()
                    ConnectorStartGate.update(app, disabled, true)
                    return ConnectorStartResult.NOT_ELIGIBLE
                }
                error.errorCode == "NETWORK_IO_ERROR" && cached.cachedRemoteStartEligible -> cached
                else -> {
                    ConnectorStartGate.update(app, cached, false)
                    return ConnectorStartResult.NOT_ELIGIBLE
                }
            }
        }
        ConnectorStartGate.update(app, settings, true)
        if (!settings.remoteExecutionEnabled) return ConnectorStartResult.NOT_ELIGIBLE
        if (!settings.remotePrinterConfigured || !settings.remotePrinterEnabled) {
            return ConnectorStartResult.NOT_CONFIGURED
        }
        val binding = settings.usbBinding ?: return ConnectorStartResult.USB_UNAVAILABLE
        ConnectorRecoveryScheduler.enable(app)
        val resolution = UsbBindingResolver.resolve(binding, UsbDeviceInspector(app).scan())
        if (resolution !is UsbBindingResolution.Ready) {
            settingsStore.recordError((resolution as UsbBindingResolution.Unavailable).errorCode)
            return ConnectorStartResult.USB_UNAVAILABLE
        }
        return runCatching {
            ContextCompat.startForegroundService(
                app,
                Intent(app, PrinterConnectorService::class.java),
            )
            ConnectorStartResult.STARTED
        }.getOrElse { ConnectorStartResult.START_BLOCKED }
    }

    fun stop(context: Context) {
        context.applicationContext.stopService(
            Intent(context.applicationContext, PrinterConnectorService::class.java),
        )
    }
}
