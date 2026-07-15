package com.yunqiao.life.merchantterminal.connector

import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.security.SecretRedactor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingAndSafetyPolicyTest {
    @Test
    fun `accepts only the versioned one-time pairing payload`() {
        val parsed = PairingPayload.parse(
            "ytpair:v1:123e4567-e89b-42d3-a456-426614174000:12345678",
        )
        assertEquals("123e4567-e89b-42d3-a456-426614174000", parsed?.pairingId)
        assertEquals("12345678", parsed?.code)
        assertNull(PairingPayload.parse("12345678"))
        assertNull(PairingPayload.parse("ytpair:v1:123e4567-e89b-42d3-a456-426614174000:123456"))
        assertNull(PairingPayload.parse("ytpair:v1:not-a-uuid:12345678"))
    }

    @Test
    fun `execution requires exact remote printer association and automatic requires both switches`() {
        val base = ConnectorSettingsSnapshot(
            installId = "install",
            connectorEnabled = true,
            automaticPrintingEnabled = true,
            remoteExecutionEnabled = true,
            remoteTerminalEnabled = true,
            remotePrinterEnabled = true,
            remoteAutomaticPrintingEnabled = false,
            usbBinding = binding(printerId = null),
        )
        assertFalse(base.canExecute)
        assertFalse(base.canClaimAutomatic)

        val associated = base.copy(usbBinding = binding(printerId = "41"))
        assertTrue(associated.canExecute)
        assertFalse(associated.canClaimAutomatic)
        assertTrue(associated.copy(remoteAutomaticPrintingEnabled = true).canClaimAutomatic)
    }

    @Test
    fun `write timeout and partial write are uncertain and never retryable`() {
        listOf(
            UsbPrintErrorCode.USB_WRITE_TIMEOUT,
            UsbPrintErrorCode.USB_PARTIAL_WRITE,
            UsbPrintErrorCode.USB_WRITE_FAILED,
        ).forEach { code ->
            val disposition = PrintOutcomePolicy.classify(code, 0)
            assertTrue(disposition.uncertain)
            assertFalse(disposition.retryable)
        }
    }

    @Test
    fun `pre-write disconnect is retryable but invalid config is not`() {
        assertEquals(
            FailureDisposition(retryable = true, uncertain = false),
            PrintOutcomePolicy.classify(UsbPrintErrorCode.USB_DEVICE_NOT_FOUND, 0),
        )
        assertEquals(
            FailureDisposition(retryable = false, uncertain = false),
            PrintOutcomePolicy.classify(UsbPrintErrorCode.INVALID_PRINT_WIDTH, 0),
        )
    }

    @Test
    fun `device detach after a transfer call is uncertain even when driver reports zero bytes`() {
        assertEquals(
            FailureDisposition(retryable = false, uncertain = true),
            PrintOutcomePolicy.classify(
                UsbPrintErrorCode.USB_DEVICE_DETACHED,
                bytesWritten = 0,
                ioAttempted = true,
            ),
        )
        assertEquals(
            FailureDisposition(retryable = true, uncertain = false),
            PrintOutcomePolicy.classify(
                UsbPrintErrorCode.USB_DEVICE_DETACHED,
                bytesWritten = 0,
                ioAttempted = false,
            ),
        )
    }

    @Test
    fun `terminal authorization is removed from diagnostic errors`() {
        val safe = SecretRedactor.safeError("failed Authorization: Terminal abcdefghijklmnopqrstuvwxyz")
        assertFalse(safe.orEmpty().contains("abcdefghijklmnopqrstuvwxyz"))
        assertTrue(safe.orEmpty().contains("[REDACTED]"))
    }

    @Test
    fun `local USB errors map to the controlled server vocabulary`() {
        assertEquals("USB_INTERFACE_CLAIM_FAILED", ServerPrintErrorMapper.map("USB_BULK_OUT_NOT_FOUND"))
        assertEquals("PRINTER_OFFLINE", ServerPrintErrorMapper.map("USB_OPEN_FAILED"))
        assertEquals("UNKNOWN", ServerPrintErrorMapper.map("UNRECOGNIZED_LOCAL_DETAIL"))
    }

    @Test
    fun `expired or conflicting reports require an operator instead of indefinite retry`() {
        assertTrue(PendingReportPolicy.requiresOperator("LEASE_EXPIRED"))
        assertTrue(PendingReportPolicy.requiresOperator("PRINT_JOB_STATE_CONFLICT"))
        assertTrue(PendingReportPolicy.requiresOperator("PRINT_CONTENT_HASH_MISMATCH"))
        assertFalse(PendingReportPolicy.requiresOperator("NETWORK_IO_ERROR"))
        assertFalse(PendingReportPolicy.requiresOperator("TERMINAL_DISABLED"))
    }

    @Test
    fun `reversible terminal disable never invalidates the local credential`() {
        assertFalse(
            ConnectorApiException(409, "TERMINAL_DISABLED", "disabled")
                .invalidTerminalCredential,
        )
        assertTrue(
            ConnectorApiException(401, "TERMINAL_AUTH_INVALID", "invalid")
                .invalidTerminalCredential,
        )
    }

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
