package com.yunqiao.life.merchantterminal.printing.usb

import org.junit.Assert.assertEquals
import org.junit.Test

class UsbAttachRecoveryDeciderTest {
    @Test
    fun `non attach action is ignored`() {
        assertIgnored(action = "android.intent.action.MAIN", attachedDeviceName = TARGET_NAME)
    }

    @Test
    fun `attach without device is ignored`() {
        assertIgnored(attachedDeviceName = null)
    }

    @Test
    fun `device absent from fresh scan is ignored`() {
        assertIgnored(attachedDeviceName = "/dev/bus/usb/009/009")
    }

    @Test
    fun `safe target printer with permission recovers existing binding`() {
        val decision = decide(devices = listOf(printer(hasPermission = true)))

        assertEquals(
            UsbAttachRecoveryDecision.RecoverGranted(TARGET_NAME),
            decision,
        )
    }

    @Test
    fun `safe target printer without permission requests permission`() {
        val decision = decide(devices = listOf(printer(hasPermission = false)))

        assertEquals(
            UsbAttachRecoveryDecision.RequestPermission(TARGET_NAME),
            decision,
        )
    }

    @Test
    fun `repeated attach while request is pending does not request again`() {
        val decision = decide(
            devices = listOf(printer(hasPermission = false)),
            pendingDeviceName = TARGET_NAME,
        )

        assertEquals(UsbAttachRecoveryDecision.Ignore, decision)
    }

    @Test
    fun `standard printer class with different identity is accepted`() {
        val name = "/dev/bus/usb/002/004"
        val device = printer(
            deviceName = name,
            vendorId = 1_155,
            productId = 22_339,
            hasPermission = false,
        )

        val decision = decide(attachedDeviceName = name, devices = listOf(device))

        assertEquals(UsbAttachRecoveryDecision.RequestPermission(name), decision)
    }

    @Test
    fun `non matching vendor bulk device is ignored`() {
        assertIgnored(
            devices = listOf(
                printer(
                    vendorId = 9_999,
                    productId = 8_888,
                    interfaceClass = 255,
                    interfaceSubclass = 0,
                    interfaceProtocol = 0,
                    hasPermission = false,
                ),
            ),
        )
    }

    @Test
    fun `HID device is ignored even when it exposes bulk out`() {
        assertIgnored(devices = listOf(printer(deviceClass = 3, hasPermission = false)))
    }

    @Test
    fun `mass storage interface is ignored even when it exposes bulk out`() {
        assertIgnored(
            devices = listOf(
                printer(interfaceClass = 8, interfaceSubclass = 6, interfaceProtocol = 80),
            ),
        )
    }

    @Test
    fun `device without bulk out is ignored`() {
        assertIgnored(devices = listOf(printer(hasBulkOut = false)))
    }

    private fun assertIgnored(
        action: String? = UsbAttachRecoveryDecider.ACTION_USB_DEVICE_ATTACHED,
        attachedDeviceName: String? = TARGET_NAME,
        devices: List<UsbDeviceDescriptor> = listOf(printer()),
    ) {
        assertEquals(
            UsbAttachRecoveryDecision.Ignore,
            decide(action, attachedDeviceName, devices),
        )
    }

    private fun decide(
        action: String? = UsbAttachRecoveryDecider.ACTION_USB_DEVICE_ATTACHED,
        attachedDeviceName: String? = TARGET_NAME,
        devices: List<UsbDeviceDescriptor>,
        pendingDeviceName: String? = null,
    ): UsbAttachRecoveryDecision = UsbAttachRecoveryDecider.decide(
        action = action,
        attachedDeviceName = attachedDeviceName,
        scannedDevices = devices,
        pendingDeviceName = pendingDeviceName,
    )

    private fun printer(
        deviceName: String = TARGET_NAME,
        vendorId: Int = 0x0FE6,
        productId: Int = 0x811E,
        deviceClass: Int = 0,
        interfaceClass: Int = 7,
        interfaceSubclass: Int = 1,
        interfaceProtocol: Int = 2,
        hasBulkOut: Boolean = true,
        hasPermission: Boolean = true,
    ): UsbDeviceDescriptor = UsbDeviceDescriptor(
        deviceName = deviceName,
        manufacturerName = null,
        productName = "USB Printer",
        vendorId = vendorId,
        productId = productId,
        deviceClass = deviceClass,
        deviceSubclass = 0,
        deviceProtocol = 0,
        interfaces = listOf(
            UsbInterfaceDescriptor(
                index = 0,
                id = 0,
                alternateSetting = 0,
                interfaceClass = interfaceClass,
                interfaceSubclass = interfaceSubclass,
                interfaceProtocol = interfaceProtocol,
                endpoints = if (hasBulkOut) {
                    listOf(
                        UsbEndpointDescriptor(
                            address = 0x03,
                            endpointNumber = 3,
                            direction = UsbEndpointDirection.OUT,
                            type = UsbEndpointType.BULK,
                            maxPacketSize = 64,
                            interval = 0,
                        ),
                    )
                } else {
                    emptyList()
                },
            ),
        ),
        hasPermission = hasPermission,
    )

    private companion object {
        const val TARGET_NAME = "/dev/bus/usb/004/002"
    }
}
