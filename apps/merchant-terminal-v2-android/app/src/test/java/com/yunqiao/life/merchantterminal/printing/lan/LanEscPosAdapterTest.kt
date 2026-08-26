package com.yunqiao.life.merchantterminal.printing.lan

import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.io.path.createTempFile

class LanEscPosAdapterTest {
    @Test
    fun onePrintInvocationPerformsOneTransportWriteChain() = runBlocking {
        var writeCalls = 0
        val factory = LanConnectionFactory {
            object : LanConnection {
                override fun writeOnce(bytes: ByteArray, timeoutMs: Int): NetworkWriteOutcome {
                    writeCalls += 1
                    return NetworkWriteOutcome.Complete(bytes.size)
                }

                override fun close() = Unit
            }
        }
        val adapter = LanEscPosAdapter(connectionFactory = factory)
        assertTrue(adapter.connect(PrinterConnectionConfig.Lan("192.168.1.42")).isSuccess)
        val result = adapter.print(PrintableDocument(byteArrayOf(1, 2, 3), "test"))
        assertTrue(result is PrintResult.Success)
        assertEquals(1, writeCalls)
        adapter.disconnect()
    }

    @Test
    fun binaryArtifactFileUsesBoundedRawLanChunks() = runBlocking {
        val chunkSizes = mutableListOf<Int>()
        val factory = LanConnectionFactory {
            object : LanConnection {
                override fun writeOnce(bytes: ByteArray, timeoutMs: Int): NetworkWriteOutcome {
                    chunkSizes += bytes.size
                    return NetworkWriteOutcome.Complete(bytes.size)
                }

                override fun close() = Unit
            }
        }
        val payload = ByteArray(2 * 1024 * 1024 + 17) { (it % 251).toByte() }
        val file = createTempFile("yq-lan-artifact-", ".escpos").toFile()
        file.writeBytes(payload)
        try {
            val adapter = LanEscPosAdapter(connectionFactory = factory)
            assertTrue(adapter.connect(PrinterConnectionConfig.Lan("192.168.1.42")).isSuccess)
            val result = adapter.printFile(file, payload.size)
            assertTrue(result is PrintResult.Success)
            assertEquals(payload.size, (result as PrintResult.Success).writtenBytes)
            assertTrue(chunkSizes.size > 1)
            assertTrue(chunkSizes.all { it in 1..64 * 1024 })
            assertEquals(payload.size, chunkSizes.sum())
            adapter.disconnect()
        } finally {
            file.delete()
        }
    }
}
