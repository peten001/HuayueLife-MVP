package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ConnectorRemoteConfigSyncTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `offline remote status does not turn off capability configuration or automatic rule`() =
        runBlocking {
            val settings = ConnectorSettings(context)
            settings.saveUsbBinding(binding(printerId = null))
            settings.recordError("USB_DEVICE_NOT_FOUND")

            val applied = applyConnectorRemoteConfig(
                context,
                settings,
                remote(status = "OFFLINE", readiness = "DEVICE_OFFLINE"),
            )

            assertTrue(applied.settings.remoteMerchantPrintingEnabled)
            assertTrue(applied.settings.cachedRemoteStartEligible)
            assertTrue(applied.settings.canExecute)
            assertTrue(applied.settings.canClaimAutomatic)
            assertEquals("PRINTER_STATUS_NOT_READY", applied.connectionBlockCode)
            assertEquals("USB_DEVICE_NOT_FOUND", applied.settings.lastErrorCode)
        }

    @Test
    fun `platform ability and printer configuration are independent states`() = runBlocking {
        val settings = ConnectorSettings(context)
        settings.saveUsbBinding(binding(printerId = "9"))

        val applied = applyConnectorRemoteConfig(
            context,
            settings,
            remote(merchantPrintingEnabled = false),
        )

        assertFalse(applied.settings.remoteMerchantPrintingEnabled)
        assertFalse(applied.settings.remoteExecutionEnabled)
        assertTrue(applied.settings.remotePrinterConfigured)
        assertTrue(applied.settings.remotePrinterEnabled)
        assertFalse(applied.settings.canExecute)
        assertEquals("PRINTING_NOT_ENABLED", applied.capabilityBlockCode)
    }

    private fun remote(
        merchantPrintingEnabled: Boolean = true,
        status: String? = "ONLINE",
        readiness: String? = "READY",
    ) = ConnectorRemoteConfig(
        merchantId = "7",
        merchantPrintingEnabled = merchantPrintingEnabled,
        executionEnabled = true,
        taskCenterEnabled = true,
        automaticPrintingEnabled = true,
        pollIntervalMs = 7_000,
        configRefreshIntervalMs = 30_000,
        boundPrinterId = "9",
        boundPrinterChannelType = "LOCAL_USB_ESCPOS",
        boundPrinterEnabled = true,
        boundPrinterStatus = status,
        boundPrinterReadinessState = readiness,
        boundPrinterConnectionConfigValid = true,
        configVersion = 1,
        resetUsbConfigVersion = null,
    )

    private fun binding(printerId: String?) = UsbPrinterBinding(
        printerId = printerId,
        deviceName = "/dev/bus/usb/001/002",
        vendorId = 1,
        productId = 2,
        interfaceIndex = 0,
        interfaceId = 0,
        alternateSetting = 0,
        endpointAddress = 1,
        paperWidth = PaperWidth.MM_80,
        customDots = null,
        threshold = 160,
        cutMode = CutMode.NONE,
    )
}
