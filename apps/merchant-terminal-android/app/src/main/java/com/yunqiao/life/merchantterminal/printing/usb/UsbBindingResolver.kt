package com.yunqiao.life.merchantterminal.printing.usb

import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig

sealed interface UsbBindingResolution {
    data class Ready(
        val device: UsbDeviceDescriptor,
        val option: UsbConnectionOption,
        val config: PrinterConnectionConfig.Usb,
    ) : UsbBindingResolution

    data class Unavailable(val errorCode: String) : UsbBindingResolution
}

object UsbBindingResolver {
    fun resolve(
        binding: UsbPrinterBinding,
        devices: List<UsbDeviceDescriptor>,
    ): UsbBindingResolution {
        val exact = devices.firstOrNull {
            it.deviceName == binding.deviceName &&
                it.vendorId == binding.vendorId && it.productId == binding.productId
        }
        val identityMatches = devices.filter {
            it.vendorId == binding.vendorId && it.productId == binding.productId
        }
        val device = exact ?: identityMatches.singleOrNull()
            ?: return UsbBindingResolution.Unavailable(
                if (identityMatches.size > 1) "USB_DEVICE_AMBIGUOUS" else "USB_DEVICE_NOT_FOUND",
            )
        if (!device.hasPermission) return UsbBindingResolution.Unavailable("USB_PERMISSION_REQUIRED")
        val option = UsbEndpointSelector.select(
            device = device,
            preferredInterfaceIndex = binding.interfaceIndex,
            preferredInterfaceId = binding.interfaceId,
            preferredAlternateSetting = binding.alternateSetting,
            preferredEndpointAddress = binding.endpointAddress,
        ) ?: return UsbBindingResolution.Unavailable("USB_SAVED_ENDPOINT_CHANGED")
        return UsbBindingResolution.Ready(
            device = device,
            option = option,
            config = PrinterConnectionConfig.Usb(
                deviceName = device.deviceName,
                interfaceIndex = option.interfaceIndex,
                interfaceId = option.interfaceId,
                alternateSetting = option.alternateSetting,
                endpointAddress = option.endpointAddress,
            ),
        )
    }
}
