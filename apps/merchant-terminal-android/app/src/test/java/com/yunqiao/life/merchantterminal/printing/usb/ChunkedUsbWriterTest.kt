package com.yunqiao.life.merchantterminal.printing.usb

import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChunkedUsbWriterTest {
    @Test
    fun `writes document in deterministic chunks`() {
        val calls = mutableListOf<Pair<Int, Int>>()
        val result = ChunkedUsbWriter.write(
            data = ByteArray(9_000),
            maxPacketSize = 64,
            timeoutMs = 5_000,
            transport = BulkTransferTransport { _, offset, length, _ ->
                calls += offset to length
                length
            },
        )

        assertEquals(BulkWriteOutcome.Complete(9_000), result)
        assertEquals(listOf(0 to 4_096, 4_096 to 4_096, 8_192 to 808), calls)
    }

    @Test
    fun `partial write stops without retrying remaining or entire document`() {
        var callCount = 0
        val result = ChunkedUsbWriter.write(
            data = ByteArray(5_000),
            maxPacketSize = 64,
            timeoutMs = 5_000,
            transport = BulkTransferTransport { _, _, length, _ ->
                callCount++
                length - 5
            },
        ) as BulkWriteOutcome.Failed

        assertEquals(1, callCount)
        assertEquals(UsbPrintErrorCode.USB_PARTIAL_WRITE, result.code)
        assertEquals(4_091, result.writtenBytes)
    }

    @Test
    fun `negative result at timeout maps to timeout`() {
        var clockCalls = 0
        val result = ChunkedUsbWriter.write(
            data = ByteArray(64),
            maxPacketSize = 64,
            timeoutMs = 5_000,
            transport = BulkTransferTransport { _, _, _, _ -> -1 },
            nanoTime = { if (clockCalls++ == 0) 0 else 5_000_000_000L },
        ) as BulkWriteOutcome.Failed

        assertEquals(UsbPrintErrorCode.USB_WRITE_TIMEOUT, result.code)
        assertEquals(0, result.writtenBytes)
    }

    @Test
    fun `detached state stops before writing`() {
        var called = false
        val result = ChunkedUsbWriter.write(
            data = ByteArray(64),
            maxPacketSize = 64,
            timeoutMs = 5_000,
            transport = BulkTransferTransport { _, _, length, _ ->
                called = true
                length
            },
            detached = { true },
        ) as BulkWriteOutcome.Failed

        assertEquals(UsbPrintErrorCode.USB_DEVICE_DETACHED, result.code)
        assertTrue(!called)
    }

    @Test
    fun `transport exception maps to write failed`() {
        val result = ChunkedUsbWriter.write(
            data = ByteArray(64),
            maxPacketSize = 64,
            timeoutMs = 5_000,
            transport = BulkTransferTransport { _, _, _, _ -> error("socket should not exist") },
        ) as BulkWriteOutcome.Failed

        assertEquals(UsbPrintErrorCode.USB_WRITE_FAILED, result.code)
    }
}
