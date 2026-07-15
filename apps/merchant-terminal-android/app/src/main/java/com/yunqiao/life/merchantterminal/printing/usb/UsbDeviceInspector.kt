package com.yunqiao.life.merchantterminal.printing.usb

import android.content.Context
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbManager
import com.yunqiao.life.merchantterminal.printing.PrinterCandidate
import com.yunqiao.life.merchantterminal.printing.PrinterChannel
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionOption

enum class UsbEndpointDirection {
    IN,
    OUT,
}

enum class UsbEndpointType {
    CONTROL,
    ISOCHRONOUS,
    BULK,
    INTERRUPT,
    UNKNOWN,
}

data class UsbEndpointDescriptor(
    val address: Int,
    val endpointNumber: Int,
    val direction: UsbEndpointDirection,
    val type: UsbEndpointType,
    val maxPacketSize: Int,
    val interval: Int,
)

data class UsbInterfaceDescriptor(
    val index: Int,
    val id: Int,
    val alternateSetting: Int,
    val interfaceClass: Int,
    val interfaceSubclass: Int,
    val interfaceProtocol: Int,
    val endpoints: List<UsbEndpointDescriptor>,
)

data class UsbDeviceDescriptor(
    val deviceName: String,
    val manufacturerName: String?,
    val productName: String?,
    val vendorId: Int,
    val productId: Int,
    val deviceClass: Int,
    val deviceSubclass: Int,
    val deviceProtocol: Int,
    val interfaces: List<UsbInterfaceDescriptor>,
    val hasPermission: Boolean,
) {
    val displayName: String
        get() = productName?.takeIf(String::isNotBlank)
            ?: manufacturerName?.takeIf(String::isNotBlank)
            ?: deviceName

    val likelyPrinter: Boolean
        get() = UsbCandidateClassifier.isLikelyPrinter(this)

    val bulkOutOptions: List<UsbConnectionOption>
        get() = UsbEndpointSelector.allBulkOutOptions(this)
}

data class UsbConnectionOption(
    val interfaceIndex: Int,
    val interfaceId: Int,
    val alternateSetting: Int,
    val endpointAddress: Int,
    val endpointNumber: Int,
    val maxPacketSize: Int,
    val printerClassInterface: Boolean,
)

object UsbCandidateClassifier {
    const val USB_PRINTER_CLASS = 7

    fun isLikelyPrinter(device: UsbDeviceDescriptor): Boolean =
        device.interfaces.any { usbInterface ->
            usbInterface.interfaceClass == USB_PRINTER_CLASS ||
                usbInterface.endpoints.any { endpoint ->
                    endpoint.type == UsbEndpointType.BULK &&
                        endpoint.direction == UsbEndpointDirection.OUT
                }
        }
}

object UsbEndpointSelector {
    fun allBulkOutOptions(device: UsbDeviceDescriptor): List<UsbConnectionOption> =
        device.interfaces.flatMap { usbInterface ->
            usbInterface.endpoints
                .filter { endpoint ->
                    endpoint.type == UsbEndpointType.BULK &&
                        endpoint.direction == UsbEndpointDirection.OUT
                }
                .map { endpoint ->
                    UsbConnectionOption(
                        interfaceIndex = usbInterface.index,
                        interfaceId = usbInterface.id,
                        alternateSetting = usbInterface.alternateSetting,
                        endpointAddress = endpoint.address,
                        endpointNumber = endpoint.endpointNumber,
                        maxPacketSize = endpoint.maxPacketSize,
                        printerClassInterface =
                        usbInterface.interfaceClass == UsbCandidateClassifier.USB_PRINTER_CLASS,
                    )
                }
        }.sortedWith(
            compareByDescending<UsbConnectionOption> { it.printerClassInterface }
                .thenByDescending { it.maxPacketSize }
                .thenBy { it.interfaceIndex }
                .thenBy { it.interfaceId }
                .thenBy { it.alternateSetting }
                .thenBy { it.endpointNumber },
        )

    fun select(
        device: UsbDeviceDescriptor,
        preferredInterfaceIndex: Int? = null,
        preferredInterfaceId: Int? = null,
        preferredAlternateSetting: Int? = null,
        preferredEndpointAddress: Int? = null,
    ): UsbConnectionOption? {
        val options = allBulkOutOptions(device)
        if (
            preferredInterfaceIndex == null &&
            preferredInterfaceId == null &&
            preferredAlternateSetting == null &&
            preferredEndpointAddress == null
        ) {
            return options.firstOrNull()
        }
        return options.firstOrNull { option ->
            (preferredInterfaceIndex == null || option.interfaceIndex == preferredInterfaceIndex) &&
                (preferredInterfaceId == null || option.interfaceId == preferredInterfaceId) &&
                (preferredAlternateSetting == null ||
                    option.alternateSetting == preferredAlternateSetting) &&
                (preferredEndpointAddress == null || option.endpointAddress == preferredEndpointAddress)
        }
    }
}

class UsbDeviceInspector(context: Context) {
    private val applicationContext = context.applicationContext
    private val usbManager = applicationContext.getSystemService(UsbManager::class.java)

    val isUsbHostSupported: Boolean
        get() = applicationContext.packageManager.hasSystemFeature(PackageManager.FEATURE_USB_HOST)

    fun scan(): List<UsbDeviceDescriptor> = usbManager
        ?.deviceList
        .orEmpty()
        .values
        .map(::describe)
        .sortedWith(
            compareByDescending<UsbDeviceDescriptor> { it.likelyPrinter }
                .thenBy { it.displayName.lowercase() }
                .thenBy { it.deviceName },
        )

    fun findDevice(deviceName: String): UsbDevice? = usbManager?.deviceList?.get(deviceName)

    fun toPrinterCandidate(device: UsbDeviceDescriptor): PrinterCandidate = PrinterCandidate(
        identifier = device.deviceName,
        displayName = device.displayName,
        channel = PrinterChannel.LOCAL_USB_ESCPOS,
        likelyPrinter = device.likelyPrinter,
        connectionOptions = device.bulkOutOptions.map { option ->
            PrinterConnectionOption(
                interfaceIndex = option.interfaceIndex,
                interfaceId = option.interfaceId,
                alternateSetting = option.alternateSetting,
                endpointAddress = option.endpointAddress,
                maxPacketSize = option.maxPacketSize,
            )
        },
    )

    private fun describe(device: UsbDevice): UsbDeviceDescriptor = UsbDeviceDescriptor(
        deviceName = device.deviceName,
        manufacturerName = safeUsbString { device.manufacturerName },
        productName = safeUsbString { device.productName },
        vendorId = device.vendorId,
        productId = device.productId,
        deviceClass = device.deviceClass,
        deviceSubclass = device.deviceSubclass,
        deviceProtocol = device.deviceProtocol,
        interfaces = (0 until device.interfaceCount).map { interfaceIndex ->
            val usbInterface = device.getInterface(interfaceIndex)
            UsbInterfaceDescriptor(
                index = interfaceIndex,
                id = usbInterface.id,
                alternateSetting = usbInterface.alternateSetting,
                interfaceClass = usbInterface.interfaceClass,
                interfaceSubclass = usbInterface.interfaceSubclass,
                interfaceProtocol = usbInterface.interfaceProtocol,
                endpoints = (0 until usbInterface.endpointCount).map { endpointIndex ->
                    describe(usbInterface.getEndpoint(endpointIndex))
                },
            )
        },
        hasPermission = usbManager?.hasPermission(device) == true,
    )

    private fun describe(endpoint: UsbEndpoint): UsbEndpointDescriptor = UsbEndpointDescriptor(
        address = endpoint.address,
        endpointNumber = endpoint.endpointNumber,
        direction = if (endpoint.direction == UsbConstants.USB_DIR_OUT) {
            UsbEndpointDirection.OUT
        } else {
            UsbEndpointDirection.IN
        },
        type = when (endpoint.type) {
            UsbConstants.USB_ENDPOINT_XFER_CONTROL -> UsbEndpointType.CONTROL
            UsbConstants.USB_ENDPOINT_XFER_ISOC -> UsbEndpointType.ISOCHRONOUS
            UsbConstants.USB_ENDPOINT_XFER_BULK -> UsbEndpointType.BULK
            UsbConstants.USB_ENDPOINT_XFER_INT -> UsbEndpointType.INTERRUPT
            else -> UsbEndpointType.UNKNOWN
        },
        maxPacketSize = endpoint.maxPacketSize,
        interval = endpoint.interval,
    )

    private fun safeUsbString(block: () -> String?): String? = runCatching(block)
        .getOrNull()
        ?.takeIf(String::isNotBlank)
        ?.take(MAX_USB_LABEL_LENGTH)

    private companion object {
        const val MAX_USB_LABEL_LENGTH = 160
    }
}
