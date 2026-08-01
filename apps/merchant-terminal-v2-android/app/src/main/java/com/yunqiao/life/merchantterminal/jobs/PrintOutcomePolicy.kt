package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode

data class FailureDisposition(
    val retryable: Boolean,
    val uncertain: Boolean,
)

object PrintOutcomePolicy {
    fun classify(
        code: UsbPrintErrorCode,
        bytesWritten: Int,
        ioAttempted: Boolean,
    ): FailureDisposition {
        if (bytesWritten > 0 || ioAttempted) {
            return FailureDisposition(retryable = false, uncertain = true)
        }
        return FailureDisposition(
            retryable = code in RETRYABLE_BEFORE_IO,
            uncertain = false,
        )
    }

    private val RETRYABLE_BEFORE_IO = setOf(
        UsbPrintErrorCode.USB_DEVICE_NOT_FOUND,
        UsbPrintErrorCode.USB_DEVICE_DETACHED,
        UsbPrintErrorCode.USB_OPEN_FAILED,
        UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED,
        UsbPrintErrorCode.USB_IO_BUSY,
        UsbPrintErrorCode.LAN_CONNECT_FAILED,
        UsbPrintErrorCode.BLUETOOTH_CONNECT_FAILED,
        UsbPrintErrorCode.BLUETOOTH_DEVICE_NOT_FOUND,
    )
}

object ServerPrintErrorMapper {
    fun map(code: String): String = when (code) {
        "USB_PERMISSION_REQUIRED",
        "USB_PERMISSION_DENIED",
        -> "USB_PERMISSION_DENIED"
        "USB_DEVICE_DETACHED" -> "USB_DEVICE_DETACHED"
        "USB_CLAIM_INTERFACE_FAILED",
        "USB_INTERFACE_NOT_FOUND",
        "USB_BULK_OUT_NOT_FOUND",
        -> "USB_INTERFACE_CLAIM_FAILED"
        "USB_WRITE_TIMEOUT",
        "USB_PARTIAL_WRITE",
        "USB_WRITE_FAILED",
        -> "USB_WRITE_FAILED"
        "LAN_WRITE_TIMEOUT" -> "NETWORK_TIMEOUT"
        "USB_DEVICE_NOT_FOUND",
        "USB_OPEN_FAILED",
        "LAN_CONNECT_FAILED",
        "BLUETOOTH_CONNECT_FAILED",
        "BLUETOOTH_DEVICE_NOT_FOUND",
        "BLUETOOTH_NOT_BONDED",
        -> "PRINTER_OFFLINE"
        "BLUETOOTH_PERMISSION_REQUIRED" -> "PERMISSION_DENIED"
        "RECEIPT_SCHEMA_UNSUPPORTED",
        "RECEIPT_SCHEMA_INVALID",
        "BITMAP_RENDER_FAILED",
        -> "TEMPLATE_INVALID"
        else -> "CONFIG_INVALID"
    }
}
