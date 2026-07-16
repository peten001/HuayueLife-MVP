package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.security.SecretRedactor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlinx.coroutines.runBlocking

@RunWith(RobolectricTestRunner::class)
class ConnectorSafetyPolicyTest {
    @Test
    fun `execution requires merchant session printer association and automatic requires both switches`() {
        val base = ConnectorSettingsSnapshot(
            connectorEnabled = true,
            automaticPrintingEnabled = true,
            remoteExecutionEnabled = true,
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
    fun `merchant bearer authorization is removed from diagnostic errors`() {
        val safe = SecretRedactor.safeError("failed Authorization: Bearer abcdefghijklmnopqrstuvwxyz")
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
        assertFalse(PendingReportPolicy.requiresOperator("MERCHANT_PRINTING_DISABLED"))
    }

    @Test
    fun `expired merchant session invalidates local API credential use`() {
        assertFalse(
            ConnectorApiException(409, "MERCHANT_PRINTING_DISABLED", "disabled")
                .invalidMerchantSession,
        )
        assertTrue(
            ConnectorApiException(401, "MERCHANT_AUTH_INVALID", "invalid")
                .invalidMerchantSession,
        )
        assertTrue(
            ConnectorApiException(403, "HTTP_403", "staff disabled")
                .invalidMerchantSession,
        )
    }

    @Test
    fun `Web sign out closes all execution gates but preserves USB evidence`() = runBlocking {
        val context: Context = ApplicationProvider.getApplicationContext()
        val settings = ConnectorSettings(context)
        val usbBinding = binding(printerId = "41")
        settings.bindMerchantScopeIfAbsent("7")
        settings.saveUsbBinding(usbBinding)
        settings.setConnectorEnabled(true)
        settings.setAutomaticPrintingEnabled(true)
        settings.applyRemoteConfig(
            executionEnabled = true,
            printerEnabled = true,
            automaticPrintingEnabled = true,
            pollIntervalMs = 7_000,
            configRefreshIntervalMs = 30_000,
        )

        settings.disableForSignedOutSession()
        val stopped = settings.snapshot()

        assertFalse(stopped.connectorEnabled)
        assertFalse(stopped.automaticPrintingEnabled)
        assertFalse(stopped.remoteExecutionEnabled)
        assertFalse(stopped.remotePrinterEnabled)
        assertFalse(stopped.remoteAutomaticPrintingEnabled)
        assertEquals("7", stopped.merchantId)
        assertEquals(usbBinding, stopped.usbBinding)
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
