package com.yunqiao.life.merchantterminal.printing.lan

import com.yunqiao.life.merchantterminal.model.Ipv4Address
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.PrinterAdapter
import com.yunqiao.life.merchantterminal.printing.PrinterCandidate
import com.yunqiao.life.merchantterminal.printing.PrinterChannel
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.StreamingPrinterAdapter
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.nio.ByteBuffer
import java.nio.channels.SelectionKey
import java.nio.channels.Selector
import java.nio.channels.SocketChannel
import java.io.File
import kotlin.time.Duration.Companion.milliseconds

sealed interface NetworkWriteOutcome {
    data class Complete(val writtenBytes: Int) : NetworkWriteOutcome
    data class Failed(
        val writtenBytes: Int,
        val ioAttempted: Boolean,
        val timedOut: Boolean,
        val detail: String,
    ) : NetworkWriteOutcome
}

interface LanConnection : AutoCloseable {
    fun writeOnce(bytes: ByteArray, timeoutMs: Int): NetworkWriteOutcome
}

fun interface LanConnectionFactory {
    fun connect(config: PrinterConnectionConfig.Lan): LanConnection
}

class SocketChannelLanConnectionFactory : LanConnectionFactory {
    override fun connect(config: PrinterConnectionConfig.Lan): LanConnection {
        val channel = SocketChannel.open()
        try {
            channel.configureBlocking(false)
            val address = InetSocketAddress(config.host, config.port)
            if (!channel.connect(address)) {
                Selector.open().use { selector ->
                    channel.register(selector, SelectionKey.OP_CONNECT)
                    val ready = selector.select(config.connectTimeoutMs.toLong())
                    if (ready <= 0 || !channel.finishConnect()) {
                        throw java.net.SocketTimeoutException("LAN connect timeout")
                    }
                }
            }
            channel.configureBlocking(false)
            channel.socket().tcpNoDelay = true
            channel.socket().keepAlive = false
            return SocketChannelLanConnection(channel)
        } catch (error: Throwable) {
            runCatching { channel.close() }
            throw error
        }
    }
}

private class SocketChannelLanConnection(
    private val channel: SocketChannel,
) : LanConnection {
    override fun writeOnce(bytes: ByteArray, timeoutMs: Int): NetworkWriteOutcome {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000L
        var attempted = false
        var writtenBytes = 0
        return try {
            Selector.open().use { selector ->
                channel.register(selector, SelectionKey.OP_WRITE)
                while (writtenBytes < bytes.size) {
                    val chunkLength = minOf(RAW_WRITE_CHUNK_BYTES, bytes.size - writtenBytes)
                    val buffer = ByteBuffer.wrap(bytes, writtenBytes, chunkLength)
                    while (buffer.hasRemaining()) {
                    val remainingMs = ((deadline - System.nanoTime()) / 1_000_000L)
                    if (remainingMs <= 0) {
                        return NetworkWriteOutcome.Failed(
                            writtenBytes = writtenBytes,
                            ioAttempted = attempted,
                            timedOut = true,
                            detail = "LAN write deadline exceeded.",
                        )
                    }
                    if (selector.select(remainingMs.coerceAtLeast(1)) <= 0) continue
                    attempted = true
                    val count = channel.write(buffer)
                    if (count < 0) {
                        return NetworkWriteOutcome.Failed(
                            writtenBytes = writtenBytes,
                            ioAttempted = true,
                            timedOut = false,
                            detail = "LAN socket closed during write.",
                        )
                    }
                    writtenBytes += count
                    }
                }
            }
            NetworkWriteOutcome.Complete(writtenBytes)
        } catch (error: Throwable) {
            NetworkWriteOutcome.Failed(
                writtenBytes = writtenBytes,
                ioAttempted = attempted,
                timedOut = error is java.net.SocketTimeoutException,
                detail = error.javaClass.simpleName.take(80),
            )
        }
    }

    override fun close() {
        channel.close()
    }

    private companion object {
        const val RAW_WRITE_CHUNK_BYTES = 64 * 1024
    }
}

class LanEscPosAdapter(
    private val discovery: LanPrinterDiscovery = LanPrinterDiscovery(),
    private val connectionFactory: LanConnectionFactory = SocketChannelLanConnectionFactory(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : StreamingPrinterAdapter {
    private val mutex = Mutex()
    private var connection: LanConnection? = null

    override suspend fun discover(): List<PrinterCandidate> = discovery.discover()

    override suspend fun connect(config: PrinterConnectionConfig): Result<Unit> =
        withContext(ioDispatcher) {
            runCatching {
                val lan = config as? PrinterConnectionConfig.Lan
                    ?: error("LAN adapter received a non-LAN config.")
                mutex.withLock {
                    connection?.close()
                    connection = connectionFactory.connect(lan)
                }
            }
        }

    override suspend fun print(document: PrintableDocument): PrintResult =
        withContext(ioDispatcher) {
            mutex.withLock {
                val active = connection ?: return@withLock PrintResult.Failure(
                    code = UsbPrintErrorCode.LAN_CONNECT_FAILED,
                    technicalDetail = "LAN connection is not open.",
                    plannedBytes = document.bytes.size,
                )
                when (
                    val outcome = active.writeOnce(
                        document.bytes,
                        PrinterConnectionConfig.DEFAULT_NETWORK_WRITE_TIMEOUT_MS,
                    )
                ) {
                    is NetworkWriteOutcome.Complete -> PrintResult.Success(
                        plannedBytes = document.bytes.size,
                        writtenBytes = outcome.writtenBytes,
                    )
                    is NetworkWriteOutcome.Failed -> PrintResult.Failure(
                        code = if (outcome.timedOut) {
                            UsbPrintErrorCode.LAN_WRITE_TIMEOUT
                        } else {
                            UsbPrintErrorCode.LAN_WRITE_FAILED
                        },
                        technicalDetail = outcome.detail,
                        plannedBytes = document.bytes.size,
                        writtenBytes = outcome.writtenBytes,
                        ioAttempted = outcome.ioAttempted,
                    )
                }
            }
        }

    override suspend fun printFile(file: File, expectedLength: Int): PrintResult {
        if (expectedLength <= 0 || file.length() != expectedLength.toLong()) {
            return PrintResult.Failure(
                code = UsbPrintErrorCode.TRANSPORT_CONFIG_MISMATCH,
                technicalDetail = "Verified artifact file length changed.",
                plannedBytes = expectedLength.coerceAtLeast(0),
            )
        }
        var written = 0
        file.inputStream().buffered(RAW_FILE_CHUNK_BYTES).use { input ->
            val buffer = ByteArray(RAW_FILE_CHUNK_BYTES)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                when (val result = print(
                    PrintableDocument(buffer.copyOf(count), "binary-artifact-chunk"),
                )) {
                    is PrintResult.Success -> written += result.writtenBytes
                    is PrintResult.Failure -> return result.copy(
                        plannedBytes = expectedLength,
                        writtenBytes = written + result.writtenBytes,
                    )
                }
            }
        }
        return if (written == expectedLength) {
            PrintResult.Success(expectedLength, written)
        } else {
            PrintResult.Failure(
                code = UsbPrintErrorCode.LAN_WRITE_FAILED,
                technicalDetail = "Artifact file changed during LAN write.",
                plannedBytes = expectedLength,
                writtenBytes = written,
                ioAttempted = written > 0,
            )
        }
    }

    override suspend fun disconnect() {
        withContext(ioDispatcher) {
            mutex.withLock {
                runCatching { connection?.close() }
                connection = null
            }
        }
    }

    private companion object {
        const val RAW_FILE_CHUNK_BYTES = 64 * 1024
    }
}

class LanPrinterDiscovery(
    private val connectionFactory: LanConnectionFactory = SocketChannelLanConnectionFactory(),
    private val subnetProvider: () -> List<String> = ::localPrivateIpv4,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) {
    suspend fun discover(
        port: Int = PrinterConnectionConfig.DEFAULT_LAN_PORT,
        timeoutMs: Int = 350,
    ): List<PrinterCandidate> = withContext(ioDispatcher) {
        val localAddresses = subnetProvider().filter(Ipv4Address::isValid).distinct()
        val candidates = localAddresses
            .flatMap(::classCSubnet)
            .filterNot { it in localAddresses }
            .distinct()
            .take(MAX_SCAN_ADDRESSES)
        val semaphore = Semaphore(MAX_PARALLEL_PROBES)
        coroutineScope {
            candidates.map { host ->
                async {
                    semaphore.withPermit {
                        val config = PrinterConnectionConfig.Lan(
                            host = host,
                            port = port,
                            connectTimeoutMs = timeoutMs,
                        )
                        val reachable = runCatching {
                            connectionFactory.connect(config).use { }
                        }.isSuccess
                        if (!reachable) null else PrinterCandidate(
                            identifier = "$host:$port",
                            displayName = host,
                            channel = PrinterChannel.LOCAL_LAN_ESCPOS,
                            likelyPrinter = true,
                            connectionOptions = emptyList(),
                        )
                    }
                }
            }.awaitAll().filterNotNull().sortedBy(PrinterCandidate::identifier)
        }
    }

    private fun classCSubnet(address: String): List<String> {
        val prefix = address.substringBeforeLast('.')
        return (1..254).map { "$prefix.$it" }
    }

    private companion object {
        const val MAX_PARALLEL_PROBES = 32
        const val MAX_SCAN_ADDRESSES = 508
    }
}

private fun localPrivateIpv4(): List<String> =
    NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .mapNotNull { it.hostAddress }
        .filter(::isPrivateIpv4)

private fun isPrivateIpv4(value: String): Boolean {
    val parts = value.split('.').mapNotNull(String::toIntOrNull)
    if (parts.size != 4) return false
    return parts[0] == 10 ||
        (parts[0] == 172 && parts[1] in 16..31) ||
        (parts[0] == 192 && parts[1] == 168)
}
