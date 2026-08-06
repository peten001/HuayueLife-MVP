package com.yunqiao.life.merchantterminal.printing.usb

internal sealed interface UsbAttachRecoveryDecision {
    data object Ignore : UsbAttachRecoveryDecision
    data class RecoverGranted(val deviceName: String) : UsbAttachRecoveryDecision
    data class RequestPermission(val deviceName: String) : UsbAttachRecoveryDecision
}

internal object UsbAttachRecoveryDecider {
    const val ACTION_USB_DEVICE_ATTACHED = "android.hardware.usb.action.USB_DEVICE_ATTACHED"

    fun decide(
        action: String?,
        attachedDeviceName: String?,
        scannedDevices: List<UsbDeviceDescriptor>,
        pendingDeviceName: String?,
    ): UsbAttachRecoveryDecision {
        if (action != ACTION_USB_DEVICE_ATTACHED) return UsbAttachRecoveryDecision.Ignore
        val deviceName = attachedDeviceName?.takeIf(String::isNotBlank)
            ?: return UsbAttachRecoveryDecision.Ignore
        val descriptor = scannedDevices.firstOrNull { it.deviceName == deviceName }
            ?: return UsbAttachRecoveryDecision.Ignore
        if (!descriptor.matchesDefaultHandlerFilter()) return UsbAttachRecoveryDecision.Ignore
        if (descriptor.bulkOutOptions.isEmpty()) return UsbAttachRecoveryDecision.Ignore
        if (descriptor.hasPermission) {
            return UsbAttachRecoveryDecision.RecoverGranted(deviceName)
        }
        if (pendingDeviceName != null) return UsbAttachRecoveryDecision.Ignore
        return UsbAttachRecoveryDecision.RequestPermission(deviceName)
    }

    private fun UsbDeviceDescriptor.matchesDefaultHandlerFilter(): Boolean =
        (vendorId == TARGET_VENDOR_ID && productId == TARGET_PRODUCT_ID) ||
            interfaces.any { usbInterface ->
                usbInterface.interfaceClass == UsbCandidateClassifier.USB_PRINTER_CLASS &&
                    usbInterface.interfaceSubclass == USB_PRINTER_SUBCLASS &&
                    usbInterface.interfaceProtocol == USB_PRINTER_PROTOCOL
            }

    private const val TARGET_VENDOR_ID = 4_070
    private const val TARGET_PRODUCT_ID = 33_054
    private const val USB_PRINTER_SUBCLASS = 1
    private const val USB_PRINTER_PROTOCOL = 2
}
