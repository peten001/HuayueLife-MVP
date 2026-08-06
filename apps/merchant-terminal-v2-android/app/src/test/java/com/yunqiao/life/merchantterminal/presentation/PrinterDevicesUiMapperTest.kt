package com.yunqiao.life.merchantterminal.presentation

import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class PrinterDevicesUiMapperTest {
    @Test
    fun `usb core candidate maps to ui and remains visible without permission`() {
        val state = PrinterDevicesCoreState(
            selectedTransport = PrinterTransport.USB,
            candidates = listOf(usbCandidate(hasPermission = false)),
            selectedCandidateId = USB_ID,
            usbPermissionState = UsbPermissionState.REQUIRED,
        )

        val ui = state.toUiState()

        val candidate = ui.usbPrinters.single()
        assertEquals(USB_ID, candidate.identity)
        assertFalse(candidate.hasPermission)
        assertTrue(candidate.selected)
        assertEquals(USB_ID, ui.selectedUsbIdentity)
        assertEquals("VID 4070 / PID 33054", candidate.endpoint)
    }

    @Test
    fun `active usb binding does not become a scan candidate`() {
        val ui = PrinterDevicesCoreState(
            selectedTransport = PrinterTransport.USB,
            bindings = listOf(usbBinding()),
            candidates = emptyList(),
        ).toUiState()

        assertTrue(ui.usbPrinters.isEmpty())
        assertEquals(1, ui.printers.size)
        assertNull(ui.selectedUsbIdentity)
    }

    @Test
    fun `lan and bluetooth candidate mappings remain intact`() {
        val ui = PrinterDevicesCoreState(
            candidates = listOf(
                PrinterCandidateCore(
                    identity = "192.168.1.20:9100",
                    displayName = "LAN",
                    transport = PrinterTransport.LAN,
                    endpoint = "192.168.1.20:9100",
                    config = LocalTransportConfig.Lan("192.168.1.20", 9_100),
                ),
                PrinterCandidateCore(
                    identity = "00:11:22:33:44:55",
                    displayName = "Bluetooth",
                    transport = PrinterTransport.BLUETOOTH,
                    endpoint = "00:11:22:33:44:55",
                    paired = true,
                    config = LocalTransportConfig.Bluetooth(
                        macAddress = "00:11:22:33:44:55",
                        deviceName = "Bluetooth",
                        serviceUuid = PrinterConnectionConfig.DEFAULT_SPP_UUID,
                    ),
                ),
            ),
        ).toUiState()

        assertEquals(1, ui.discoveredLanPrinters.size)
        assertEquals(1, ui.bluetoothPrinters.size)
        assertTrue(ui.bluetoothPrinters.single().paired)
    }

    private fun usbCandidate(hasPermission: Boolean) = PrinterCandidateCore(
        identity = USB_ID,
        displayName = "USB Printer",
        transport = PrinterTransport.USB,
        endpoint = "VID 4070 / PID 33054",
        available = hasPermission,
        config = usbConfig(),
    )

    private fun usbBinding() = LocalPrinterBinding(
        merchantId = "11",
        terminalInstanceId = "terminal-instance",
        localBindingId = UUID.randomUUID().toString(),
        printerId = null,
        bindingVersion = 0,
        transport = PrinterTransport.USB,
        displayName = "Saved USB",
        paperWidth = PaperWidth.MM_80,
        transportConfig = usbConfig(),
        localStatus = PhysicalStatus.UNKNOWN,
        syncStatus = BindingSyncStatus.LOCAL_ONLY,
        deletedPending = false,
        enabled = false,
        lastConnectedAt = null,
        lastTestedAt = null,
        lastStatusReportAt = null,
    )

    private fun usbConfig() = LocalTransportConfig.Usb(
        vendorId = 0x0FE6,
        productId = 0x811E,
        deviceName = USB_ID,
        interfaceIndex = 0,
        interfaceId = 0,
        alternateSetting = 0,
        interfaceClass = 7,
        endpointAddress = 0x03,
    )

    private companion object {
        const val USB_ID = "/dev/bus/usb/001/002"
    }
}
