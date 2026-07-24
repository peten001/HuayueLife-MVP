package com.yunqiao.life.merchantterminal.connector

import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ConnectorStartGateTest {
    @Test
    fun `cached platform configuration credential and local binding control restart eligibility`() {
        val eligible = ConnectorSettingsSnapshot(
            connectorEnabled = false,
            remoteConfigKnown = true,
            remoteMerchantPrintingEnabled = true,
            remoteExecutionEnabled = true,
            remotePrinterConfigured = true,
            remotePrinterEnabled = true,
            usbBinding = binding(),
        )

        assertTrue(connectorMayStart(eligible, hasCredential = true, apiConfigured = true))

        assertFalse(
            connectorMayStart(
                eligible.copy(usbBinding = null),
                hasCredential = true,
                apiConfigured = true,
            ),
        )

        assertFalse(
            connectorMayStart(
                eligible.copy(remoteExecutionEnabled = false),
                hasCredential = true,
                apiConfigured = true,
            ),
        )
        assertFalse(
            connectorMayStart(
                eligible.copy(remoteMerchantPrintingEnabled = false),
                hasCredential = true,
                apiConfigured = true,
            ),
        )

        assertFalse(connectorMayStart(eligible, hasCredential = false, apiConfigured = true))
        assertFalse(connectorMayStart(eligible, hasCredential = true, apiConfigured = false))
    }

    private fun binding() = UsbPrinterBinding(
        printerId = "9",
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
