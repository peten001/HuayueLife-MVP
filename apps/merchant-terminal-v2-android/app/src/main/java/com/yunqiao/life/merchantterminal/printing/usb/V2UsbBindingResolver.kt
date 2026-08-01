package com.yunqiao.life.merchantterminal.printing.usb

import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig

sealed interface V2UsbBindingResolution {
    data class Ready(
        val device: UsbDeviceDescriptor,
        val option: UsbConnectionOption,
        val connectionConfig: PrinterConnectionConfig.Usb,
    ) : V2UsbBindingResolution

    data class Unavailable(val errorCode: String) : V2UsbBindingResolution
}

object V2UsbBindingResolver {
    fun resolve(
        config: LocalTransportConfig.Usb,
        devices: List<UsbDeviceDescriptor>,
    ): V2UsbBindingResolution {
        val identityMatches = devices.filter {
            it.vendorId == config.vendorId && it.productId == config.productId
        }
        val endpointMatches = identityMatches.filter { device ->
            UsbEndpointSelector.select(
                device = device,
                preferredInterfaceIndex = config.interfaceIndex,
                preferredInterfaceId = config.interfaceId,
                preferredAlternateSetting = config.alternateSetting,
                preferredEndpointAddress = config.endpointAddress,
            ) != null
        }
        val exact = config.deviceName?.let { name ->
            endpointMatches.firstOrNull { it.deviceName == name }
        }
        val device = exact ?: endpointMatches.singleOrNull()
            ?: return V2UsbBindingResolution.Unavailable(
                if (endpointMatches.size > 1) "USB_DEVICE_AMBIGUOUS" else "USB_DEVICE_NOT_FOUND",
            )
        if (!device.hasPermission) {
            return V2UsbBindingResolution.Unavailable("USB_PERMISSION_REQUIRED")
        }
        val option = UsbEndpointSelector.select(
            device = device,
            preferredInterfaceIndex = config.interfaceIndex,
            preferredInterfaceId = config.interfaceId,
            preferredAlternateSetting = config.alternateSetting,
            preferredEndpointAddress = config.endpointAddress,
        ) ?: return V2UsbBindingResolution.Unavailable("USB_SAVED_ENDPOINT_CHANGED")
        return V2UsbBindingResolution.Ready(
            device = device,
            option = option,
            connectionConfig = PrinterConnectionConfig.Usb(
                deviceName = device.deviceName,
                interfaceIndex = option.interfaceIndex,
                interfaceId = option.interfaceId,
                alternateSetting = option.alternateSetting,
                endpointAddress = option.endpointAddress,
            ),
        )
    }
}
