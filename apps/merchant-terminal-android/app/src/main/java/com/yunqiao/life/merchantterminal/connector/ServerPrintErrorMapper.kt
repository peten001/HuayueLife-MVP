package com.yunqiao.life.merchantterminal.connector

/** Maps local adapter detail to the server's controlled printing error vocabulary. */
object ServerPrintErrorMapper {
    fun map(localCode: String?): String = when (localCode) {
        "USB_PERMISSION_REQUIRED", "USB_PERMISSION_DENIED" -> "USB_PERMISSION_DENIED"
        "USB_DEVICE_NOT_FOUND", "USB_DEVICE_DETACHED" -> "USB_DEVICE_DETACHED"
        "USB_INTERFACE_NOT_FOUND", "USB_BULK_OUT_NOT_FOUND",
        "USB_CLAIM_INTERFACE_FAILED" -> "USB_INTERFACE_CLAIM_FAILED"
        "USB_OPEN_FAILED", "USB_IO_BUSY" -> "PRINTER_OFFLINE"
        "USB_WRITE_TIMEOUT", "USB_PARTIAL_WRITE", "USB_WRITE_FAILED" -> "USB_WRITE_FAILED"
        "BITMAP_RENDER_FAILED" -> "TEMPLATE_INVALID"
        "LEASE_EXTEND_FAILED" -> "NETWORK_TIMEOUT"
        "INVALID_PRINT_WIDTH", "PRINTER_BINDING_MISMATCH", "USB_SAVED_ENDPOINT_CHANGED" ->
            "CONFIG_INVALID"
        "USB_DEVICE_AMBIGUOUS" -> "CONFIG_INVALID"
        else -> "UNKNOWN"
    }
}
