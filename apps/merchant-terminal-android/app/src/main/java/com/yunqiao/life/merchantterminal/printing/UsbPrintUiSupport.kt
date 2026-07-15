package com.yunqiao.life.merchantterminal.printing

import androidx.annotation.StringRes
import com.yunqiao.life.merchantterminal.R
import java.util.concurrent.atomic.AtomicBoolean

@StringRes
fun UsbPrintErrorCode.userMessageResource(): Int = when (this) {
    UsbPrintErrorCode.USB_HOST_NOT_SUPPORTED -> R.string.usb_error_host_not_supported
    UsbPrintErrorCode.USB_DEVICE_NOT_FOUND -> R.string.usb_error_device_not_found
    UsbPrintErrorCode.USB_PERMISSION_REQUIRED -> R.string.usb_error_permission_required
    UsbPrintErrorCode.USB_PERMISSION_DENIED -> R.string.usb_error_permission_denied
    UsbPrintErrorCode.USB_INTERFACE_NOT_FOUND -> R.string.usb_error_interface_not_found
    UsbPrintErrorCode.USB_BULK_OUT_NOT_FOUND -> R.string.usb_error_bulk_out_not_found
    UsbPrintErrorCode.USB_OPEN_FAILED -> R.string.usb_error_open_failed
    UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED -> R.string.usb_error_claim_failed
    UsbPrintErrorCode.USB_DEVICE_DETACHED -> R.string.usb_error_device_detached
    UsbPrintErrorCode.USB_WRITE_TIMEOUT -> R.string.usb_error_write_timeout
    UsbPrintErrorCode.USB_PARTIAL_WRITE -> R.string.usb_error_partial_write
    UsbPrintErrorCode.USB_WRITE_FAILED -> R.string.usb_error_write_failed
    UsbPrintErrorCode.BITMAP_RENDER_FAILED -> R.string.usb_error_bitmap_render
    UsbPrintErrorCode.INVALID_PRINT_WIDTH -> R.string.usb_error_invalid_width
    UsbPrintErrorCode.UNKNOWN_USB_ERROR -> R.string.usb_error_unknown
}

/** Prevents concurrent and rapid repeated print actions without scheduling any automatic retry. */
class PrintActionGate(
    private val debounceMs: Long = 750L,
) {
    private val inFlight = AtomicBoolean(false)
    private var lastAcquiredAt: Long? = null

    @Synchronized
    fun tryAcquire(nowElapsedMs: Long): Boolean {
        if (inFlight.get()) return false
        val previous = lastAcquiredAt
        if (previous != null && nowElapsedMs - previous < debounceMs) return false
        lastAcquiredAt = nowElapsedMs
        inFlight.set(true)
        return true
    }

    fun release() {
        inFlight.set(false)
    }

    fun isInFlight(): Boolean = inFlight.get()
}
