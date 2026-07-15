package com.yunqiao.life.merchantterminal.printing.usb

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbDeviceInspectorTest {
    @Test
    fun `printer class interface is a candidate without hardcoded vid pid`() {
        val descriptor = device(
            vendorId = 12_345,
            productId = 54_321,
            interfaces = listOf(usbInterface(id = 0, interfaceClass = 7)),
        )

        assertTrue(UsbCandidateClassifier.isLikelyPrinter(descriptor))
    }

    @Test
    fun `vendor specific bulk out remains manually selectable but is not auto classified`() {
        val descriptor = device(
            interfaces = listOf(
                usbInterface(
                    id = 4,
                    interfaceClass = 255,
                    endpoints = listOf(endpoint(direction = UsbEndpointDirection.OUT)),
                ),
            ),
        )

        assertFalse(descriptor.likelyPrinter)
        assertEquals(4, descriptor.bulkOutOptions.single().interfaceId)
    }

    @Test
    fun `mass storage bulk out is never selectable as a printer transport`() {
        val descriptor = device(
            interfaces = listOf(
                usbInterface(
                    id = 8,
                    interfaceClass = 8,
                    endpoints = listOf(endpoint(direction = UsbEndpointDirection.OUT)),
                ),
            ),
        )

        assertFalse(descriptor.likelyPrinter)
        assertTrue(descriptor.bulkOutOptions.isEmpty())
        assertNull(UsbEndpointSelector.select(descriptor))
    }

    @Test
    fun `input only device is not classified as printer and has no writable endpoint`() {
        val descriptor = device(
            interfaces = listOf(
                usbInterface(
                    id = 0,
                    interfaceClass = 3,
                    endpoints = listOf(endpoint(direction = UsbEndpointDirection.IN)),
                ),
            ),
        )

        assertFalse(descriptor.likelyPrinter)
        assertNull(UsbEndpointSelector.select(descriptor))
    }

    @Test
    fun `selector prefers printer class when several bulk out interfaces exist`() {
        val descriptor = device(
            interfaces = listOf(
                usbInterface(
                    id = 1,
                    interfaceClass = 255,
                    endpoints = listOf(endpoint(address = 1, maxPacketSize = 512)),
                ),
                usbInterface(
                    id = 7,
                    interfaceClass = 7,
                    endpoints = listOf(endpoint(address = 2, maxPacketSize = 64)),
                ),
            ),
        )

        assertEquals(7, UsbEndpointSelector.select(descriptor)?.interfaceId)
    }

    @Test
    fun `manual interface and endpoint selection overrides automatic preference`() {
        val descriptor = device(
            interfaces = listOf(
                usbInterface(
                    id = 1,
                    interfaceClass = 255,
                    endpoints = listOf(endpoint(address = 1)),
                ),
                usbInterface(
                    id = 7,
                    interfaceClass = 7,
                    endpoints = listOf(endpoint(address = 2)),
                ),
            ),
        )

        val selected = UsbEndpointSelector.select(
            descriptor,
            preferredInterfaceIndex = 1,
            preferredInterfaceId = 1,
            preferredAlternateSetting = 0,
            preferredEndpointAddress = 1,
        )
        assertEquals(1, selected?.interfaceId)
        assertEquals(1, selected?.endpointAddress)
    }

    @Test
    fun `same interface id alternate settings select exact second interface index`() {
        val descriptor = device(
            interfaces = listOf(
                usbInterface(
                    index = 0,
                    id = 3,
                    alternateSetting = 0,
                    interfaceClass = 7,
                    endpoints = listOf(endpoint(address = 1)),
                ),
                usbInterface(
                    index = 1,
                    id = 3,
                    alternateSetting = 1,
                    interfaceClass = 7,
                    endpoints = listOf(endpoint(address = 2)),
                ),
            ),
        )

        val selected = UsbEndpointSelector.select(
            descriptor,
            preferredInterfaceIndex = 1,
            preferredInterfaceId = 3,
            preferredAlternateSetting = 1,
            preferredEndpointAddress = 2,
        )

        assertEquals(1, selected?.interfaceIndex)
        assertEquals(3, selected?.interfaceId)
        assertEquals(1, selected?.alternateSetting)
        assertEquals(2, selected?.endpointAddress)
    }

    @Test
    fun `attachment state marks selected device detached and recovers after scan`() {
        val selected = UsbAttachmentState(connectedDeviceNames = setOf("usb-a"))
            .onSelected("usb-a")
        val detached = selected.onDetached("usb-a")

        assertTrue(detached.selectedDeviceDetached)
        assertFalse("usb-a" in detached.connectedDeviceNames)
        assertFalse(detached.onScan(setOf("usb-a")).selectedDeviceDetached)
    }

    private fun device(
        vendorId: Int = 1,
        productId: Int = 2,
        interfaces: List<UsbInterfaceDescriptor>,
    ) = UsbDeviceDescriptor(
        deviceName = "/dev/bus/usb/test",
        manufacturerName = null,
        productName = null,
        vendorId = vendorId,
        productId = productId,
        deviceClass = 0,
        deviceSubclass = 0,
        deviceProtocol = 0,
        interfaces = interfaces,
        hasPermission = false,
    )

    private fun usbInterface(
        id: Int,
        index: Int = id,
        alternateSetting: Int = 0,
        interfaceClass: Int,
        endpoints: List<UsbEndpointDescriptor> = emptyList(),
    ) = UsbInterfaceDescriptor(
        index = index,
        id = id,
        alternateSetting = alternateSetting,
        interfaceClass = interfaceClass,
        interfaceSubclass = 0,
        interfaceProtocol = 0,
        endpoints = endpoints,
    )

    private fun endpoint(
        address: Int = 1,
        direction: UsbEndpointDirection = UsbEndpointDirection.OUT,
        maxPacketSize: Int = 64,
    ) = UsbEndpointDescriptor(
        address = address,
        endpointNumber = address and 0x0f,
        direction = direction,
        type = UsbEndpointType.BULK,
        maxPacketSize = maxPacketSize,
        interval = 0,
    )
}
