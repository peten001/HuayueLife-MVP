package com.yunqiao.life.merchantterminal.connector

import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode

data class FailureDisposition(val retryable: Boolean, val uncertain: Boolean)

object PrintOutcomePolicy {
    fun classify(
        code: UsbPrintErrorCode,
        bytesWritten: Int,
        ioAttempted: Boolean = false,
    ): FailureDisposition {
        val uncertain = ioAttempted || bytesWritten > 0 || code in setOf(
            UsbPrintErrorCode.USB_PARTIAL_WRITE,
            UsbPrintErrorCode.USB_WRITE_TIMEOUT,
            UsbPrintErrorCode.USB_WRITE_FAILED,
        )
        if (uncertain) return FailureDisposition(retryable = false, uncertain = true)
        val retryable = code in setOf(
            UsbPrintErrorCode.USB_DEVICE_NOT_FOUND,
            UsbPrintErrorCode.USB_DEVICE_DETACHED,
            UsbPrintErrorCode.USB_OPEN_FAILED,
            UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED,
            UsbPrintErrorCode.USB_IO_BUSY,
        )
        return FailureDisposition(retryable = retryable, uncertain = false)
    }
}

/** Server report conflicts are terminal locally and require an operator; never print again. */
object PendingReportPolicy {
    fun requiresOperator(errorCode: String): Boolean = errorCode in setOf(
        "LEASE_EXPIRED",
        "PRINT_JOB_STATE_CONFLICT",
        "PRINT_CONTENT_HASH_MISMATCH",
        "PRINTING_RESOURCE_NOT_FOUND",
        "PERMISSION_DENIED",
    )
}
