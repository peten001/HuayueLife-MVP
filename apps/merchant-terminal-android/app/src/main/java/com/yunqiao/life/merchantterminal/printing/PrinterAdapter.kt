package com.yunqiao.life.merchantterminal.printing

/** Transport-neutral contract. Only [PrinterChannel.LOCAL_USB_ESCPOS] is implemented in this build. */
interface PrinterAdapter {
    suspend fun discover(): List<PrinterCandidate>
    suspend fun connect(config: PrinterConnectionConfig): Result<Unit>
    suspend fun print(document: PrintableDocument): PrintResult
    suspend fun disconnect()
}

enum class PrinterChannel {
    LOCAL_USB_ESCPOS,
    // Reserved channel identities only; no adapter implementation is shipped in this smoke build.
    LOCAL_LAN_ESCPOS,
    CLOUD,
    BUILTIN_SUNMI,
    BUILTIN_IMIN,
}

data class PrinterCandidate(
    val identifier: String,
    val displayName: String,
    val channel: PrinterChannel,
    val likelyPrinter: Boolean,
    val connectionOptions: List<PrinterConnectionOption>,
)

data class PrinterConnectionOption(
    val interfaceIndex: Int,
    val interfaceId: Int,
    val alternateSetting: Int,
    val endpointAddress: Int,
    val maxPacketSize: Int,
)

sealed interface PrinterConnectionConfig {
    data class Usb(
        val deviceName: String,
        val interfaceIndex: Int,
        val interfaceId: Int,
        val alternateSetting: Int,
        val endpointAddress: Int,
        val transferTimeoutMs: Int = DEFAULT_USB_TRANSFER_TIMEOUT_MS,
    ) : PrinterConnectionConfig {
        init {
            require(deviceName.isNotBlank()) { "USB deviceName must not be blank." }
            require(interfaceIndex >= 0) { "USB interfaceIndex must be non-negative." }
            require(interfaceId >= 0) { "USB interfaceId must be non-negative." }
            require(alternateSetting >= 0) { "USB alternateSetting must be non-negative." }
            require(endpointAddress >= 0) { "USB endpointAddress must be non-negative." }
            require(transferTimeoutMs in 500..30_000) { "USB timeout must be 500..30000 ms." }
        }
    }

    companion object {
        const val DEFAULT_USB_TRANSFER_TIMEOUT_MS = 5_000
    }
}

data class PrintableDocument(
    val bytes: ByteArray,
    val diagnosticLabel: String,
) {
    init {
        require(bytes.isNotEmpty()) { "Printable document must not be empty." }
        require(diagnosticLabel.isNotBlank()) { "Diagnostic label must not be blank." }
    }
}

sealed interface PrintResult {
    data class Success(
        val plannedBytes: Int,
        val writtenBytes: Int,
    ) : PrintResult

    data class Failure(
        val code: UsbPrintErrorCode,
        val technicalDetail: String? = null,
        val plannedBytes: Int = 0,
        val writtenBytes: Int = 0,
        /** True once Android invoked bulkTransfer; a reported zero does not prove zero output. */
        val ioAttempted: Boolean = false,
    ) : PrintResult
}

enum class UsbPrintErrorCode {
    USB_HOST_NOT_SUPPORTED,
    USB_DEVICE_NOT_FOUND,
    USB_PERMISSION_REQUIRED,
    USB_PERMISSION_DENIED,
    USB_INTERFACE_NOT_FOUND,
    USB_BULK_OUT_NOT_FOUND,
    USB_OPEN_FAILED,
    USB_CLAIM_INTERFACE_FAILED,
    USB_IO_BUSY,
    USB_DEVICE_DETACHED,
    USB_WRITE_TIMEOUT,
    USB_PARTIAL_WRITE,
    USB_WRITE_FAILED,
    BITMAP_RENDER_FAILED,
    INVALID_PRINT_WIDTH,
    UNKNOWN_USB_ERROR,
}

class UsbPrinterException(
    val code: UsbPrintErrorCode,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

enum class PaperWidth(val defaultDots: Int) {
    MM_58(defaultDots = 384),
    MM_80(defaultDots = 576),
    CUSTOM(defaultDots = 576),
}

enum class CutMode {
    NONE,
    HALF,
    FULL,
}
