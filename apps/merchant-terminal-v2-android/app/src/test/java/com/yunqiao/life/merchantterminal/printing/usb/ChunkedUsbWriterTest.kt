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
    fun `partial write continues with the remaining bytes`() {
        val calls = mutableListOf<Pair<Int, Int>>()
        val result = ChunkedUsbWriter.write(
            data = ByteArray(5_000),
            maxPacketSize = 64,
            timeoutMs = 5_000,
            transport = BulkTransferTransport { _, offset, length, _ ->
                calls += offset to length
                if (calls.size == 1) length - 5 else length
            },
        )

        assertEquals(BulkWriteOutcome.Complete(5_000), result)
        assertEquals(
            listOf(0 to 4_096, 4_091 to 5, 4_096 to 904),
            calls,
        )
    }

    @Test
    fun `zero write retries until the bounded timeout`() {
        var now = 0L
        val result = ChunkedUsbWriter.write(
            data = ByteArray(64),
            maxPacketSize = 64,
            timeoutMs = 500,
            transport = BulkTransferTransport { _, _, _, _ -> 0 },
            nanoTime = { now.also { now += 500_000_000L } },
        ) as BulkWriteOutcome.Failed

        assertEquals(UsbPrintErrorCode.USB_WRITE_TIMEOUT, result.code)
        assertEquals(0, result.writtenBytes)
        assertTrue(result.ioAttempted)
    }

    @Test
    fun `partial progress followed by negative result is recorded as partial write`() {
        val calls = mutableListOf<Pair<Int, Int>>()
        val result = ChunkedUsbWriter.write(
            data = ByteArray(64),
            maxPacketSize = 64,
            timeoutMs = 5_000,
            transport = BulkTransferTransport { _, offset, length, _ ->
                calls += offset to length
                if (calls.size == 1) length - 1 else -1
            },
        ) as BulkWriteOutcome.Failed

        assertEquals(UsbPrintErrorCode.USB_PARTIAL_WRITE, result.code)
        assertEquals(63, result.writtenBytes)
        assertTrue(result.ioAttempted)
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
        assertTrue(result.ioAttempted)
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
        assertTrue(!result.ioAttempted)
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
        assertTrue(result.ioAttempted)
    }
}
