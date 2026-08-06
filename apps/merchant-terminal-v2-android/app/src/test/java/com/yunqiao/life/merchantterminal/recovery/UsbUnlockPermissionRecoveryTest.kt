package com.yunqiao.life.merchantterminal.recovery

import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceDescriptor
import com.yunqiao.life.merchantterminal.printing.usb.UsbEndpointDescriptor
import com.yunqiao.life.merchantterminal.printing.usb.UsbEndpointDirection
import com.yunqiao.life.merchantterminal.printing.usb.UsbEndpointType
import com.yunqiao.life.merchantterminal.printing.usb.UsbInterfaceDescriptor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbUnlockPermissionRecoveryTest {
    @Test
    fun `locked user cannot read credential protected binding`() {
        assertEquals(false, UsbUnlockRecoveryGate.canReadCredentialProtectedData(false))
    }

    @Test
    fun `unlocked user can enter recovery`() {
        assertEquals(true, UsbUnlockRecoveryGate.canReadCredentialProtectedData(true))
    }

    @Test
    fun `no active usb binding stops before scanning or permission request`() {
        assertEquals(false, UsbUnlockRecoveryGate.hasActiveUsbBinding(0))
    }

    @Test
    fun `unique saved binding match without permission requests exact device`() {
        val decision = decide(devices = listOf(printer(hasPermission = false)))

        assertEquals(UsbUnlockRecoveryDecision.RequestPermission(DEVICE), decision)
    }

    @Test
    fun `changed device name falls back to unique identity and safe endpoint`() {
        val changedName = "/dev/bus/usb/004/005"
        val decision = decide(
            config = config(deviceName = DEVICE),
            devices = listOf(printer(deviceName = changedName, hasPermission = false)),
        )

        assertEquals(UsbUnlockRecoveryDecision.RequestPermission(changedName), decision)
    }

    @Test
    fun `no matching device does not request permission`() {
        val decision = decide(
            devices = listOf(printer(vendorId = 1_155, productId = 22_339)),
        )

        assertEquals(UsbUnlockRecoveryDecision.Skip("USB_DEVICE_NOT_FOUND"), decision)
    }

    @Test
    fun `ambiguous matching devices do not request permission`() {
        val decision = decide(
            config = config(deviceName = "/dev/bus/usb/old"),
            devices = listOf(
                printer(deviceName = "/dev/bus/usb/004/002"),
                printer(deviceName = "/dev/bus/usb/004/003"),
            ),
        )

        assertEquals(UsbUnlockRecoveryDecision.Skip("USB_DEVICE_AMBIGUOUS"), decision)
    }

    @Test
    fun `device without safe bulk out does not request permission`() {
        val decision = decide(devices = listOf(printer(hasBulkOut = false)))

        assertTrue(decision is UsbUnlockRecoveryDecision.Skip)
    }

    @Test
    fun `existing permission skips request and schedules recovery path`() {
        val decision = decide(devices = listOf(printer(hasPermission = true)))

        assertEquals(UsbUnlockRecoveryDecision.PermissionAlreadyGranted(DEVICE), decision)
    }

    @Test
    fun `existing pending request prevents a second permission request`() {
        val decision = decide(
            devices = listOf(printer(hasPermission = false)),
            pendingDeviceName = DEVICE,
        )

        assertEquals(UsbUnlockRecoveryDecision.PermissionRequestPending(DEVICE), decision)
    }

    private fun decide(
        config: LocalTransportConfig.Usb = config(),
        devices: List<UsbDeviceDescriptor>,
        pendingDeviceName: String? = null,
    ): UsbUnlockRecoveryDecision = UsbUnlockPermissionRecoveryPlanner.decide(
        config = config,
        devices = devices,
        pendingDeviceName = pendingDeviceName,
    )

    private fun config(deviceName: String? = DEVICE) = LocalTransportConfig.Usb(
        vendorId = 0x0FE6,
        productId = 0x811E,
        deviceName = deviceName,
        interfaceIndex = 0,
        interfaceId = 0,
        alternateSetting = 0,
        interfaceClass = 7,
        endpointAddress = 0x03,
    )

    private fun printer(
        deviceName: String = DEVICE,
        vendorId: Int = 0x0FE6,
        productId: Int = 0x811E,
        hasPermission: Boolean = false,
        hasBulkOut: Boolean = true,
    ) = UsbDeviceDescriptor(
        deviceName = deviceName,
        manufacturerName = null,
        productName = "USB Printer",
        vendorId = vendorId,
        productId = productId,
        deviceClass = 0,
        deviceSubclass = 0,
        deviceProtocol = 0,
        interfaces = listOf(
            UsbInterfaceDescriptor(
                index = 0,
                id = 0,
                alternateSetting = 0,
                interfaceClass = 7,
                interfaceSubclass = 1,
                interfaceProtocol = 2,
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
        const val DEVICE = "/dev/bus/usb/004/002"
    }
}
