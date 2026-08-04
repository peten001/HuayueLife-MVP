package com.yunqiao.life.merchantterminal.printing.usb

import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import org.json.JSONObject

data class UsbConnectorEvidence(
    val usbDeviceRecognized: Boolean,
    val usbPermissionGranted: Boolean,
    val usbInterfaceValid: Boolean,
    val usbEndpointValid: Boolean,
    val appExecutionReady: Boolean,
) {
    fun withExecutionReady(ready: Boolean) = copy(appExecutionReady = ready)

    fun toJson(): JSONObject = JSONObject()
        .put("usbDeviceRecognized", usbDeviceRecognized)
        .put("usbPermissionGranted", usbPermissionGranted)
        .put("usbInterfaceValid", usbInterfaceValid)
        .put("usbEndpointValid", usbEndpointValid)
        .put("appExecutionReady", appExecutionReady)
}

data class UsbConnectorInspection(
    val status: PhysicalStatus,
    val errorCode: String?,
    val evidence: UsbConnectorEvidence,
) {
    val canProbe: Boolean
        get() = errorCode == null &&
            evidence.usbDeviceRecognized &&
            evidence.usbPermissionGranted &&
            evidence.usbInterfaceValid &&
            evidence.usbEndpointValid
}

object UsbConnectorEvidenceResolver {
    fun inspect(
        config: LocalTransportConfig.Usb,
        devices: List<UsbDeviceDescriptor>,
    ): UsbConnectorInspection {
        val identityMatches = devices.filter {
            it.vendorId == config.vendorId && it.productId == config.productId
        }
        if (identityMatches.isEmpty()) {
            return UsbConnectorInspection(
                status = PhysicalStatus.DISCONNECTED,
                errorCode = "USB_DEVICE_NOT_FOUND",
                evidence = UsbConnectorEvidence(false, false, false, false, false),
            )
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
        val exact = config.deviceName?.let { expected ->
            endpointMatches.firstOrNull { it.deviceName == expected }
        }
        val selected = exact ?: endpointMatches.singleOrNull()
        val recognized = selected ?: config.deviceName?.let { expected ->
            identityMatches.firstOrNull { it.deviceName == expected }
        } ?: identityMatches.singleOrNull()
        if (selected == null && endpointMatches.size > 1) {
            return UsbConnectorInspection(
                status = PhysicalStatus.ERROR,
                errorCode = "USB_DEVICE_AMBIGUOUS",
                evidence = UsbConnectorEvidence(
                    usbDeviceRecognized = true,
                    usbPermissionGranted = endpointMatches.all { it.hasPermission },
                    usbInterfaceValid = true,
                    usbEndpointValid = true,
                    appExecutionReady = false,
                ),
            )
        }
        val usbInterface = recognized?.interfaces
            ?.getOrNull(config.interfaceIndex)
            ?.takeIf {
                it.id == config.interfaceId &&
                    it.alternateSetting == config.alternateSetting &&
                    (config.interfaceClass == null || it.interfaceClass == config.interfaceClass) &&
                    !UsbCandidateClassifier.isKnownUnsafeInterface(it)
            }
        val endpoint = usbInterface?.endpoints?.firstOrNull {
            it.address == config.endpointAddress &&
                it.direction == UsbEndpointDirection.OUT &&
                it.type == UsbEndpointType.BULK
        }
        val evidence = UsbConnectorEvidence(
            usbDeviceRecognized = true,
            usbPermissionGranted = recognized?.hasPermission == true,
            usbInterfaceValid = usbInterface != null,
            usbEndpointValid = endpoint != null,
            appExecutionReady = false,
        )
        val errorCode = when {
            recognized == null -> "USB_SAVED_ENDPOINT_CHANGED"
            !evidence.usbPermissionGranted -> "USB_PERMISSION_REQUIRED"
            !evidence.usbInterfaceValid -> "USB_SAVED_INTERFACE_CHANGED"
            !evidence.usbEndpointValid -> "USB_SAVED_ENDPOINT_CHANGED"
            selected == null -> "USB_SAVED_ENDPOINT_CHANGED"
            else -> null
        }
        return UsbConnectorInspection(
            status = if (errorCode == null) PhysicalStatus.UNKNOWN else PhysicalStatus.ERROR,
            errorCode = errorCode,
            evidence = evidence,
        )
    }
}

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
