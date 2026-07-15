package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.security.MerchantSessionTokenStore

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
        if (!settings.connectorEnabled || !credentials.hasCredential()) {
            return ConnectorStartResult.NOT_ELIGIBLE
        }
        val binding = settings.usbBinding ?: return ConnectorStartResult.USB_UNAVAILABLE
        val resolution = UsbBindingResolver.resolve(binding, UsbDeviceInspector(app).scan())
        if (resolution !is UsbBindingResolution.Ready) return ConnectorStartResult.USB_UNAVAILABLE
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
