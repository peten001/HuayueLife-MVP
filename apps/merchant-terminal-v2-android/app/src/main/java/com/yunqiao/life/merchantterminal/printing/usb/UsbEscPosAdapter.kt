package com.yunqiao.life.merchantterminal.printing.usb

import android.content.Context
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.PrinterAdapter
import com.yunqiao.life.merchantterminal.printing.PrinterCandidate
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import com.yunqiao.life.merchantterminal.printing.StreamingPrinterAdapter
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.math.max
import java.io.File

class UsbEscPosAdapter(
    context: Context,
    private val inspector: UsbDeviceInspector = UsbDeviceInspector(context),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val ownershipGate: UsbIoOwnershipGate = ProcessUsbIoOwnership.gate,
) : StreamingPrinterAdapter {
    private val usbManager = context.applicationContext.getSystemService(UsbManager::class.java)
    private val mutex = Mutex()
    private val ownershipToken = Any()

    @Volatile
    private var connection: UsbDeviceConnection? = null
    private var claimedInterface: UsbInterface? = null
    private var bulkOutEndpoint: UsbEndpoint? = null
    @Volatile
    private var connectedConfig: PrinterConnectionConfig.Usb? = null

    @Volatile
    private var ioDiagnostics: UsbIoDiagnostics? = null

    @Volatile
    private var detachedDeviceName: String? = null

    override suspend fun discover(): List<PrinterCandidate> = withContext(ioDispatcher) {
        inspector.scan().map(inspector::toPrinterCandidate)
    }

    override suspend fun connect(config: PrinterConnectionConfig): Result<Unit> =
        withContext(ioDispatcher) {
            runCatching {
                val usbConfig = config as? PrinterConnectionConfig.Usb
                    ?: throw UsbPrinterException(
                        UsbPrintErrorCode.UNKNOWN_USB_ERROR,
                        "UsbEscPosAdapter requires USB connection config.",
                    )
                if (!ownershipGate.tryAcquire(ownershipToken)) {
                    throw UsbPrinterException(
                        UsbPrintErrorCode.USB_IO_BUSY,
                        "Another in-process component owns the USB print channel.",
                    )
                }
                try {
                    mutex.withLock { connectLocked(usbConfig) }
                } catch (error: Throwable) {
                    ownershipGate.release(ownershipToken)
                    throw error
                }
            }
        }

    override suspend fun print(document: PrintableDocument): PrintResult = withContext(ioDispatcher) {
        mutex.withLock {
            val activeConnection = connection
                ?: return@withLock PrintResult.Failure(
                    code = UsbPrintErrorCode.USB_OPEN_FAILED,
                    technicalDetail = "USB connection is not open.",
                    plannedBytes = document.bytes.size,
                )
            val endpoint = bulkOutEndpoint
                ?: return@withLock PrintResult.Failure(
                    code = UsbPrintErrorCode.USB_BULK_OUT_NOT_FOUND,
                    technicalDetail = "No selected BULK OUT endpoint.",
                    plannedBytes = document.bytes.size,
                )
            val config = connectedConfig
                ?: return@withLock PrintResult.Failure(
                    code = UsbPrintErrorCode.USB_OPEN_FAILED,
                    technicalDetail = "USB connection config is unavailable.",
                    plannedBytes = document.bytes.size,
                )

            val outcome = ChunkedUsbWriter.write(
                data = document.bytes,
                maxPacketSize = endpoint.maxPacketSize,
                timeoutMs = config.transferTimeoutMs,
                transport = BulkTransferTransport { bytes, offset, length, timeoutMs ->
                    activeConnection.bulkTransfer(endpoint, bytes, offset, length, timeoutMs)
                },
                detached = { detachedDeviceName == config.deviceName },
            )
            when (outcome) {
                is BulkWriteOutcome.Complete -> PrintResult.Success(
                    plannedBytes = document.bytes.size,
                    writtenBytes = outcome.writtenBytes,
                    technicalDetail = ioDiagnostics?.summary(
                        requestedBytes = document.bytes.size,
                        writtenBytes = outcome.writtenBytes,
                    ),
                )
                is BulkWriteOutcome.Failed -> PrintResult.Failure(
                    code = outcome.code,
                    technicalDetail = buildString {
                        append(outcome.detail)
                        ioDiagnostics?.summary(
                            requestedBytes = document.bytes.size,
                            writtenBytes = outcome.writtenBytes,
                        )?.let { append(" | ").append(it) }
                    },
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
                code = UsbPrintErrorCode.USB_PARTIAL_WRITE,
                technicalDetail = "Artifact file changed during USB write.",
                plannedBytes = expectedLength,
                writtenBytes = written,
                ioAttempted = written > 0,
            )
        }
    }

    override suspend fun disconnect() {
        withContext(ioDispatcher) {
            try {
                mutex.withLock { disconnectLocked() }
            } finally {
                ownershipGate.release(ownershipToken)
            }
        }
    }

    private companion object {
        const val RAW_FILE_CHUNK_BYTES = 64 * 1024
    }

    /** Called by the service/runtime owner when Android reports a USB detach. */
    fun notifyDeviceDetached(deviceName: String?) {
        if (deviceName == null || connectedConfig?.deviceName != deviceName) return
        detachedDeviceName = deviceName
        // close() is safe to call while bulkTransfer is blocked and helps it return promptly.
        runCatching { connection?.close() }
    }

    /** Stops the active foreground print action when its owning lifecycle ends. */
    fun closeConnectionImmediately() {
        runCatching { connection?.close() }
        // Keep the closed handle and claimed interface until disconnect() runs. This lets the
        // owning coroutine release the interface and the process-wide ownership token after a
        // blocked bulkTransfer unwinds.
    }

    private fun connectLocked(config: PrinterConnectionConfig.Usb) {
        disconnectLocked()
        detachedDeviceName = null

        val manager = usbManager
            ?: throw UsbPrinterException(
                UsbPrintErrorCode.USB_HOST_NOT_SUPPORTED,
                "UsbManager is unavailable.",
            )
        if (!inspector.isUsbHostSupported) {
            throw UsbPrinterException(
                UsbPrintErrorCode.USB_HOST_NOT_SUPPORTED,
                "Android device does not advertise USB host support.",
            )
        }
        val device = try {
            inspector.findDevice(config.deviceName)
        } catch (security: SecurityException) {
            throw UsbPrinterException(
                UsbPrintErrorCode.USB_PERMISSION_REQUIRED,
                "Android denied access while resolving the USB device.",
                security,
            )
        }
            ?: throw UsbPrinterException(
                UsbPrintErrorCode.USB_DEVICE_DETACHED,
                "Selected USB device is no longer attached.",
            )
        val stillAttached = try {
            isDeviceStillAttached(config.deviceName)
        } catch (security: SecurityException) {
            throw UsbPrinterException(
                UsbPrintErrorCode.USB_PERMISSION_REQUIRED,
                "Android denied access while confirming the USB device attachment.",
                security,
            )
        }
        if (!stillAttached) {
            throw UsbPrinterException(
                UsbPrintErrorCode.USB_DEVICE_DETACHED,
                "Selected USB device detached before connection.",
            )
        }
        val hasPermission = try {
            manager.hasPermission(device)
        } catch (_: SecurityException) {
            false
        }
        if (!hasPermission) {
            throw UsbPrinterException(
                UsbPrintErrorCode.USB_PERMISSION_REQUIRED,
                "USB permission is required.",
            )
        }

        val interfaceCount = runConnectionStage(
            config = config,
            fallbackCode = UsbPrintErrorCode.USB_INTERFACE_NOT_FOUND,
            message = "Android could not inspect the selected USB interfaces.",
        ) { device.interfaceCount }
        if (config.interfaceIndex !in 0 until interfaceCount) {
            throw UsbPrinterException(
                UsbPrintErrorCode.USB_INTERFACE_NOT_FOUND,
                "Selected USB interface index is unavailable.",
            )
        }
        val usbInterface = runConnectionStage(
            config = config,
            fallbackCode = UsbPrintErrorCode.USB_INTERFACE_NOT_FOUND,
            message = "Android could not read the selected USB interface.",
        ) { device.getInterface(config.interfaceIndex) }
        if (
            usbInterface.id != config.interfaceId ||
            usbInterface.alternateSetting != config.alternateSetting
        ) {
            throw UsbPrinterException(
                UsbPrintErrorCode.USB_INTERFACE_NOT_FOUND,
                "Selected USB interface identity or alternate setting changed.",
            )
        }
        val endpoints = runConnectionStage(
            config = config,
            fallbackCode = UsbPrintErrorCode.USB_BULK_OUT_NOT_FOUND,
            message = "Android could not inspect the selected USB endpoints.",
        ) {
            (0 until usbInterface.endpointCount).map(usbInterface::getEndpoint)
        }
        val endpoint = endpoints
            .firstOrNull { candidate ->
                candidate.address == config.endpointAddress &&
                    candidate.direction == UsbConstants.USB_DIR_OUT &&
                    candidate.type == UsbConstants.USB_ENDPOINT_XFER_BULK
            }
            ?: throw UsbPrinterException(
                UsbPrintErrorCode.USB_BULK_OUT_NOT_FOUND,
                "Selected BULK OUT endpoint is unavailable.",
            )
        val openedConnection = runConnectionStage(
            config = config,
            fallbackCode = UsbPrintErrorCode.USB_OPEN_FAILED,
            message = "Android threw while opening the selected USB device.",
        ) { manager.openDevice(device) }
            ?: throw UsbPrinterException(
                connectionFailureCode(config, UsbPrintErrorCode.USB_OPEN_FAILED),
                "Android could not open the selected USB device.",
            )
        val claimed = try {
            openedConnection.claimInterface(usbInterface, true)
        } catch (throwable: Throwable) {
            openedConnection.close()
            throw connectionStageException(
                config = config,
                fallbackCode = UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED,
                message = "Android threw while claiming the selected USB interface.",
                cause = throwable,
            )
        }
        if (!claimed) {
            openedConnection.close()
            throw UsbPrinterException(
                connectionFailureCode(config, UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED),
                "Android could not claim the selected USB interface.",
            )
        }
        if (config.alternateSetting != 0) {
            val alternateSelected = try {
                openedConnection.setInterface(usbInterface)
            } catch (throwable: Throwable) {
                runCatching { openedConnection.releaseInterface(usbInterface) }
                openedConnection.close()
                throw connectionStageException(
                    config = config,
                    fallbackCode = UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED,
                    message = "Android threw while activating the USB alternate setting.",
                    cause = throwable,
                )
            }
            if (!alternateSelected) {
                runCatching { openedConnection.releaseInterface(usbInterface) }
                openedConnection.close()
                throw UsbPrinterException(
                    connectionFailureCode(config, UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED),
                    "Android could not activate the selected USB alternate setting.",
                )
            }
        }

        connection = openedConnection
        claimedInterface = usbInterface
        bulkOutEndpoint = endpoint
        connectedConfig = config
        ioDiagnostics = UsbIoDiagnostics(
            vendorId = device.vendorId,
            productId = device.productId,
            interfaceIndex = config.interfaceIndex,
            interfaceId = config.interfaceId,
            alternateSetting = config.alternateSetting,
            endpointAddress = endpoint.address,
            maxPacketSize = endpoint.maxPacketSize,
            timeoutMs = config.transferTimeoutMs,
        )
    }

    private inline fun <T> runConnectionStage(
        config: PrinterConnectionConfig.Usb,
        fallbackCode: UsbPrintErrorCode,
        message: String,
        block: () -> T,
    ): T = try {
        block()
    } catch (throwable: Throwable) {
        throw connectionStageException(config, fallbackCode, message, throwable)
    }

    private fun connectionStageException(
        config: PrinterConnectionConfig.Usb,
        fallbackCode: UsbPrintErrorCode,
        message: String,
        cause: Throwable,
    ): UsbPrinterException = UsbPrinterException(
        code = if (cause is SecurityException) {
            UsbPrintErrorCode.USB_PERMISSION_REQUIRED
        } else {
            connectionFailureCode(config, fallbackCode)
        },
        message = message,
        cause = cause,
    )

    private fun connectionFailureCode(
        config: PrinterConnectionConfig.Usb,
        fallbackCode: UsbPrintErrorCode,
    ): UsbPrintErrorCode {
        val device = try {
            inspector.findDevice(config.deviceName)
        } catch (_: SecurityException) {
            return UsbPrintErrorCode.USB_PERMISSION_REQUIRED
        } ?: return UsbPrintErrorCode.USB_DEVICE_DETACHED

        val manager = usbManager ?: return UsbPrintErrorCode.USB_HOST_NOT_SUPPORTED
        val hasPermission = try {
            manager.hasPermission(device)
        } catch (_: SecurityException) {
            false
        }
        return if (hasPermission) fallbackCode else UsbPrintErrorCode.USB_PERMISSION_REQUIRED
    }

    private fun isDeviceStillAttached(deviceName: String): Boolean =
        inspector.findDevice(deviceName) != null

    private fun disconnectLocked() {
        val activeConnection = connection
        val activeInterface = claimedInterface
        if (activeConnection != null && activeInterface != null) {
            runCatching { activeConnection.releaseInterface(activeInterface) }
        }
        runCatching { activeConnection?.close() }
        connection = null
        claimedInterface = null
        bulkOutEndpoint = null
        connectedConfig = null
        ioDiagnostics = null
    }
}

private data class UsbIoDiagnostics(
    val vendorId: Int,
    val productId: Int,
    val interfaceIndex: Int,
    val interfaceId: Int,
    val alternateSetting: Int,
    val endpointAddress: Int,
    val maxPacketSize: Int,
    val timeoutMs: Int,
) {
    fun summary(requestedBytes: Int, writtenBytes: Int): String =
        "VID=$vendorId PID=$productId interfaceIndex=$interfaceIndex " +
            "interfaceId=$interfaceId alternateSetting=$alternateSetting " +
            "endpoint=0x${endpointAddress.toString(16).uppercase().padStart(2, '0')} " +
            "maxPacketSize=$maxPacketSize timeoutMs=$timeoutMs " +
            "requestedBytes=$requestedBytes writtenBytes=$writtenBytes"
}

fun interface BulkTransferTransport {
    fun transfer(data: ByteArray, offset: Int, length: Int, timeoutMs: Int): Int
}

sealed interface BulkWriteOutcome {
    data class Complete(val writtenBytes: Int) : BulkWriteOutcome

    data class Failed(
        val code: UsbPrintErrorCode,
        val writtenBytes: Int,
        val detail: String,
        val ioAttempted: Boolean,
    ) : BulkWriteOutcome
}

object ChunkedUsbWriter {
    fun write(
        data: ByteArray,
        maxPacketSize: Int,
        timeoutMs: Int,
        transport: BulkTransferTransport,
        detached: () -> Boolean = { false },
        nanoTime: () -> Long = System::nanoTime,
    ): BulkWriteOutcome {
        if (data.isEmpty()) return BulkWriteOutcome.Complete(0)
        val chunkSize = calculateChunkSize(maxPacketSize)
        var offset = 0
        while (offset < data.size) {
            if (detached()) {
                return BulkWriteOutcome.Failed(
                    UsbPrintErrorCode.USB_DEVICE_DETACHED,
                    offset,
                    "USB device detached during write.",
                    ioAttempted = false,
                )
            }
            val length = minOf(chunkSize, data.size - offset)
            val chunkStartedAt = nanoTime()
            var chunkWritten = 0
            var ioAttempted = false
            while (chunkWritten < length) {
                if (detached()) {
                    return BulkWriteOutcome.Failed(
                        UsbPrintErrorCode.USB_DEVICE_DETACHED,
                        offset + chunkWritten,
                        "USB device detached during write.",
                        ioAttempted,
                    )
                }
                val callStartedAt = nanoTime()
                val transferred = runCatching {
                    ioAttempted = true
                    transport.transfer(
                        data,
                        offset + chunkWritten,
                        length - chunkWritten,
                        timeoutMs.coerceAtLeast(1),
                    )
                }.getOrElse { throwable ->
                    return BulkWriteOutcome.Failed(
                        if (detached()) {
                            UsbPrintErrorCode.USB_DEVICE_DETACHED
                        } else {
                            UsbPrintErrorCode.USB_WRITE_FAILED
                        },
                        offset + chunkWritten,
                        throwable::class.java.simpleName.take(80),
                        ioAttempted = true,
                    )
                }
                val elapsedMs = (nanoTime() - callStartedAt).coerceAtLeast(0L) / 1_000_000L
                val totalElapsedMs = (nanoTime() - chunkStartedAt).coerceAtLeast(0L) / 1_000_000L
                if (transferred < 0) {
                    val code = when {
                        detached() -> UsbPrintErrorCode.USB_DEVICE_DETACHED
                        chunkWritten > 0 -> UsbPrintErrorCode.USB_PARTIAL_WRITE
                        totalElapsedMs >= timeoutMs.toLong() || elapsedMs >= timeoutMs.toLong() ->
                            UsbPrintErrorCode.USB_WRITE_TIMEOUT
                        else -> UsbPrintErrorCode.USB_WRITE_FAILED
                    }
                    return BulkWriteOutcome.Failed(
                        code = code,
                        writtenBytes = offset + chunkWritten,
                        detail = "bulkTransfer returned $transferred after ${totalElapsedMs}ms.",
                        ioAttempted = true,
                    )
                }
                if (transferred > length - chunkWritten) {
                    return BulkWriteOutcome.Failed(
                        code = UsbPrintErrorCode.USB_WRITE_FAILED,
                        writtenBytes = offset + chunkWritten,
                        detail = "bulkTransfer returned $transferred beyond requested bytes.",
                        ioAttempted = true,
                    )
                }
                if (transferred == 0) {
                    if (totalElapsedMs >= timeoutMs.toLong()) {
                        return BulkWriteOutcome.Failed(
                            code = if (chunkWritten > 0) {
                                UsbPrintErrorCode.USB_PARTIAL_WRITE
                            } else {
                                UsbPrintErrorCode.USB_WRITE_TIMEOUT
                            },
                            writtenBytes = offset + chunkWritten,
                            detail = if (chunkWritten > 0) {
                                "bulkTransfer made partial progress then returned 0 until the " +
                                    "${timeoutMs}ms deadline."
                            } else {
                                "bulkTransfer returned 0 until the ${timeoutMs}ms deadline."
                            },
                            ioAttempted = true,
                        )
                    }
                    continue
                }
                chunkWritten += transferred
                if (totalElapsedMs >= timeoutMs.toLong() && chunkWritten < length) {
                    return BulkWriteOutcome.Failed(
                        code = UsbPrintErrorCode.USB_WRITE_TIMEOUT,
                        writtenBytes = offset + chunkWritten,
                        detail = "Partial bulkTransfer progress reached the ${timeoutMs}ms deadline.",
                        ioAttempted = true,
                    )
            }
            }
            offset += length
        }
        return BulkWriteOutcome.Complete(offset)
    }

    internal fun calculateChunkSize(maxPacketSize: Int): Int {
        val packetSize = maxPacketSize.takeIf { it in 1..MAX_CHUNK_SIZE } ?: FALLBACK_PACKET_SIZE
        val packetCount = max(1, TARGET_CHUNK_SIZE / packetSize)
        return (packetCount * packetSize).coerceAtMost(MAX_CHUNK_SIZE)
    }

    private const val FALLBACK_PACKET_SIZE = 64
    private const val TARGET_CHUNK_SIZE = 4_096
    private const val MAX_CHUNK_SIZE = 16_384
}
