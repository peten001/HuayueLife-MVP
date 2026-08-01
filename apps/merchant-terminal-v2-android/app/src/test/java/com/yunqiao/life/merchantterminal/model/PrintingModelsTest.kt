package com.yunqiao.life.merchantterminal.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintingModelsTest {
    @Test
    fun transportJsonRoundTripsAllSupportedChannels() {
        val values = listOf<LocalTransportConfig>(
            LocalTransportConfig.Usb(1, 2, "/dev/bus/usb/001/002", 0, 1, 0, 7, 2),
            LocalTransportConfig.Lan("192.168.1.42", 9_100),
            LocalTransportConfig.Bluetooth(
                "AA:BB:CC:DD:EE:FF",
                "Kitchen",
                "00001101-0000-1000-8000-00805F9B34FB",
            ),
        )
        values.forEach { value ->
            val transport = when (value) {
                is LocalTransportConfig.Usb -> PrinterTransport.USB
                is LocalTransportConfig.Lan -> PrinterTransport.LAN
                is LocalTransportConfig.Bluetooth -> PrinterTransport.BLUETOOTH
            }
            assertEquals(value, TransportConfigJson.decode(transport, TransportConfigJson.encode(value)))
        }
    }

    @Test
    fun lanRequiresRfc1918Address() {
        assertTrue(Ipv4Address.isPrivate("10.0.2.2"))
        assertTrue(Ipv4Address.isPrivate("172.31.1.8"))
        assertTrue(Ipv4Address.isPrivate("192.168.10.9"))
        assertFalse(Ipv4Address.isPrivate("8.8.8.8"))
        assertFalse(Ipv4Address.isPrivate("192.168.01.9"))
    }
}
