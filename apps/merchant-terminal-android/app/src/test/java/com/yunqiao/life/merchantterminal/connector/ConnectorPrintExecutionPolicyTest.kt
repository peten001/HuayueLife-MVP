package com.yunqiao.life.merchantterminal.connector

import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConnectorPrintExecutionPolicyTest {
    @Test
    fun `live connection readiness is separate from platform and printer configuration`() {
        assertNull(ConnectorPrintExecutionPolicy.remoteBlockCode(remote(), "7", "9"))
        listOf("UNKNOWN", "UNVERIFIED", "OFFLINE", "ERROR", "DISABLED", null).forEach { status ->
            val remote = remote(status = status)
            assertNull(ConnectorPrintExecutionPolicy.remoteBlockCode(remote, "7", "9"))
            assertEquals(
                "PRINTER_STATUS_NOT_READY",
                ConnectorPrintExecutionPolicy.connectionBlockCode(remote),
            )
        }
        assertEquals(
            "PRINTER_READINESS_EXPIRED",
            ConnectorPrintExecutionPolicy.connectionBlockCode(
                remote(readinessState = "DEVICE_OFFLINE"),
            ),
        )
    }

    @Test
    fun `platform gate channel config printer and merchant all fail closed`() {
        assertEquals(
            "PRINTING_NOT_ENABLED",
            ConnectorPrintExecutionPolicy.remoteBlockCode(
                remote(merchantPrintingEnabled = false),
                "7",
                "9",
            ),
        )
        assertEquals(
            "PRINT_CHANNEL_NOT_IMPLEMENTED",
            ConnectorPrintExecutionPolicy.remoteBlockCode(
                remote(channelType = "LOCAL_LAN_ESCPOS"),
                "7",
                "9",
            ),
        )
        assertEquals(
            "PRINTER_CONFIG_INVALID",
            ConnectorPrintExecutionPolicy.remoteBlockCode(
                remote(connectionConfigValid = false),
                "7",
                "9",
            ),
        )
        assertEquals(
            "PRINTER_DISABLED",
            ConnectorPrintExecutionPolicy.remoteBlockCode(
                remote(printerEnabled = false),
                "7",
                "9",
            ),
        )
        assertEquals(
            "MERCHANT_SCOPE_MISMATCH",
            ConnectorPrintExecutionPolicy.remoteBlockCode(remote(), "8", "9"),
        )
    }

    @Test
    fun `only current claimed same-merchant same-printer job can execute`() {
        val settings = settings()
        assertNull(
            ConnectorPrintExecutionPolicy.claimedJobBlockCode(
                job(),
                settings,
                nowEpochMs = 1_000,
            ),
        )
        assertEquals(
            "MERCHANT_SCOPE_MISMATCH",
            ConnectorPrintExecutionPolicy.claimedJobBlockCode(
                job().copy(merchantId = "8"),
                settings,
                nowEpochMs = 1_000,
            ),
        )
        assertEquals(
            "PRINTER_BINDING_MISMATCH",
            ConnectorPrintExecutionPolicy.claimedJobBlockCode(
                job().copy(printerId = "10"),
                settings,
                nowEpochMs = 1_000,
            ),
        )
        listOf("SUCCEEDED", "CANCELLED", "FAILED", "PRINTING", "PENDING").forEach { status ->
            assertEquals(
                "PRINT_JOB_NOT_CLAIMED",
                ConnectorPrintExecutionPolicy.claimedJobBlockCode(
                    job().copy(status = status),
                    settings,
                    nowEpochMs = 1_000,
                ),
            )
        }
    }

    private fun remote(
        merchantPrintingEnabled: Boolean = true,
        channelType: String? = "LOCAL_USB_ESCPOS",
        printerEnabled: Boolean = true,
        status: String? = "ONLINE",
        connectionConfigValid: Boolean = true,
        readinessState: String? = "READY",
    ) = ConnectorRemoteConfig(
        merchantId = "7",
        merchantPrintingEnabled = merchantPrintingEnabled,
        executionEnabled = true,
        taskCenterEnabled = true,
        automaticPrintingEnabled = false,
        pollIntervalMs = 5_000,
        configRefreshIntervalMs = 10_000,
        boundPrinterId = "9",
        boundPrinterChannelType = channelType,
        boundPrinterEnabled = printerEnabled,
        boundPrinterStatus = status,
        boundPrinterReadinessState = readinessState,
        boundPrinterConnectionConfigValid = connectionConfigValid,
        configVersion = 1,
        resetUsbConfigVersion = null,
    )

    private fun settings() = ConnectorSettingsSnapshot(
        merchantId = "7",
        remoteConfigKnown = true,
        remoteMerchantPrintingEnabled = true,
        remoteExecutionEnabled = true,
        remotePrinterConfigured = true,
        remotePrinterEnabled = true,
        usbBinding = binding(),
    )

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

    private fun job() = ClaimedPrintJob(
        id = "11",
        merchantId = "7",
        printerId = "9",
        status = "CLAIMED",
        receiptType = "ORDER_CUSTOMER",
        source = "MANUAL",
        leaseVersion = 1,
        leaseExpiresAt = 10_000,
        contentHash = "a".repeat(64),
        snapshotSchemaVersion = 1,
        receiptSnapshotJson = "{}",
    )
}
