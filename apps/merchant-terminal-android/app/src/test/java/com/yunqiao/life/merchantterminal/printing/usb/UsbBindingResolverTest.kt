package com.yunqiao.life.merchantterminal.printing.usb

import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbBindingResolverTest {
    @Test
    fun `restores one matching generic device without hardcoded ids`() {
        val resolution = UsbBindingResolver.resolve(binding(), listOf(device("new-path", true)))
        assertTrue(resolution is UsbBindingResolution.Ready)
        assertEquals("new-path", (resolution as UsbBindingResolution.Ready).config.deviceName)
    }

    @Test
    fun `does not guess when identical devices are ambiguous`() {
        val resolution = UsbBindingResolver.resolve(
            binding().copy(deviceName = "missing"),
            listOf(device("path-1", true), device("path-2", true)),
        )
        assertEquals(
            "USB_DEVICE_AMBIGUOUS",
            (resolution as UsbBindingResolution.Unavailable).errorCode,
        )
    }

    @Test
    fun `requires current Android USB permission`() {
        val resolution = UsbBindingResolver.resolve(binding(), listOf(device("saved-path", false)))
        assertEquals(
            "USB_PERMISSION_REQUIRED",
            (resolution as UsbBindingResolution.Unavailable).errorCode,
        )
    }

    @Test
    fun `never substitutes an unrelated attached USB device`() {
        val unrelated = device("other-path", true).copy(vendorId = 4321, productId = 8765)

        val resolution = UsbBindingResolver.resolve(binding(), listOf(unrelated))

        assertEquals(
            "USB_DEVICE_NOT_FOUND",
            (resolution as UsbBindingResolution.Unavailable).errorCode,
        )
    }

    private fun binding() = UsbPrinterBinding(
        printerId = "9",
        deviceName = "saved-path",
        vendorId = 1234,
        productId = 5678,
        interfaceIndex = 2,
        interfaceId = 7,
        alternateSetting = 0,
        endpointAddress = 1,
        paperWidth = PaperWidth.MM_80,
        customDots = null,
        threshold = 160,
        cutMode = CutMode.NONE,
    )

    private fun device(name: String, permission: Boolean) = UsbDeviceDescriptor(
        deviceName = name,
        manufacturerName = null,
        productName = null,
        vendorId = 1234,
        productId = 5678,
        deviceClass = 0,
        deviceSubclass = 0,
        deviceProtocol = 0,
        interfaces = listOf(
            UsbInterfaceDescriptor(
                index = 2,
                id = 7,
                alternateSetting = 0,
                interfaceClass = 7,
                interfaceSubclass = 1,
                interfaceProtocol = 2,
                endpoints = listOf(
                    UsbEndpointDescriptor(
                        address = 1,
                        endpointNumber = 1,
                        direction = UsbEndpointDirection.OUT,
                        type = UsbEndpointType.BULK,
                        maxPacketSize = 64,
                        interval = 0,
                    ),
                ),
            ),
        ),
        hasPermission = permission,
    )
}
