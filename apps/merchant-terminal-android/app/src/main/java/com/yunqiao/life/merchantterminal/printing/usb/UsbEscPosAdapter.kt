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
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.math.max

class UsbEscPosAdapter(
    context: Context,
    private val inspector: UsbDeviceInspector = UsbDeviceInspector(context),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val ownershipGate: UsbIoOwnershipGate = ProcessUsbIoOwnership.gate,
) : PrinterAdapter {
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
                )
                is BulkWriteOutcome.Failed -> PrintResult.Failure(
                    code = outcome.code,
                    technicalDetail = outcome.detail,
                    plannedBytes = document.bytes.size,
                    writtenBytes = outcome.writtenBytes,
                    ioAttempted = outcome.ioAttempted,
                )
            }
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

    /** Called by the visible diagnostic Activity when Android reports a detach. */
    fun notifyDeviceDetached(deviceName: String?) {
        if (deviceName == null || connectedConfig?.deviceName != deviceName) return
        detachedDeviceName = deviceName
        // close() is safe to call while bulkTransfer is blocked and helps it return promptly.
        runCatching { connection?.close() }
        connection = null
    }

    /** Stops a foreground-only diagnostic action when its Activity leaves the screen. */
    fun closeConnectionImmediately() {
        runCatching { connection?.close() }
        connection = null
        // Do not release here: a blocked bulkTransfer may not have unwound yet. The owning
        // coroutine must call disconnect() from NonCancellable after the I/O frame exits.
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
    }
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
            val startedAt = nanoTime()
            val transferred = runCatching {
                transport.transfer(data, offset, length, timeoutMs)
            }.getOrElse { throwable ->
                return BulkWriteOutcome.Failed(
                    if (detached()) {
                        UsbPrintErrorCode.USB_DEVICE_DETACHED
                    } else {
                        UsbPrintErrorCode.USB_WRITE_FAILED
                    },
                    offset,
                    throwable::class.java.simpleName.take(80),
                    ioAttempted = true,
                )
            }
            val elapsedMs = (nanoTime() - startedAt).coerceAtLeast(0L) / 1_000_000L
            if (transferred < 0) {
                val code = when {
                    detached() -> UsbPrintErrorCode.USB_DEVICE_DETACHED
                    elapsedMs >= timeoutMs.toLong() -> UsbPrintErrorCode.USB_WRITE_TIMEOUT
                    else -> UsbPrintErrorCode.USB_WRITE_FAILED
                }
                return BulkWriteOutcome.Failed(
                    code = code,
                    writtenBytes = offset,
                    detail = "bulkTransfer returned $transferred after ${elapsedMs}ms.",
                    ioAttempted = true,
                )
            }
            if (transferred != length) {
                return BulkWriteOutcome.Failed(
                    code = UsbPrintErrorCode.USB_PARTIAL_WRITE,
                    writtenBytes = offset + max(0, transferred),
                    detail = "Planned chunk $length bytes, wrote $transferred bytes.",
                    ioAttempted = true,
                )
            }
            offset += transferred
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
