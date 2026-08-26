package com.yunqiao.life.merchantterminal.printing

import java.io.File

/** A single-write transport contract shared by USB, LAN and Classic Bluetooth ESC/POS. */
interface PrinterAdapter {
    suspend fun discover(): List<PrinterCandidate>
    suspend fun connect(config: PrinterConnectionConfig): Result<Unit>
    suspend fun print(document: PrintableDocument): PrintResult
    suspend fun disconnect()
}

interface StreamingPrinterAdapter : PrinterAdapter {
    suspend fun printFile(file: File, expectedLength: Int): PrintResult
}

enum class PrinterChannel {
    LOCAL_USB_ESCPOS,
    LOCAL_LAN_ESCPOS,
    LOCAL_BLUETOOTH_ESCPOS,
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
    /** Explicit Android bond state; do not infer pairing from likelyPrinter. */
    val bonded: Boolean = false,
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

    data class Lan(
        val host: String,
        val port: Int = DEFAULT_LAN_PORT,
        val connectTimeoutMs: Int = DEFAULT_NETWORK_CONNECT_TIMEOUT_MS,
        val writeTimeoutMs: Int = DEFAULT_NETWORK_WRITE_TIMEOUT_MS,
    ) : PrinterConnectionConfig {
        init {
            require(isPrivateIpv4(host)) { "LAN host must be a private IPv4 address." }
            require(port in 1..65535) { "LAN port must be 1..65535." }
            require(connectTimeoutMs in 250..30_000) {
                "LAN connect timeout must be 250..30000 ms."
            }
            require(writeTimeoutMs in 500..30_000) {
                "LAN write timeout must be 500..30000 ms."
            }
        }
    }

    data class Bluetooth(
        val macAddress: String,
        val deviceName: String?,
        val serviceUuid: String = DEFAULT_SPP_UUID,
        val connectTimeoutMs: Int = DEFAULT_BLUETOOTH_CONNECT_TIMEOUT_MS,
    ) : PrinterConnectionConfig {
        init {
            require(MAC_ADDRESS.matches(macAddress.uppercase())) {
                "Bluetooth MAC address is invalid."
            }
            require(runCatching { java.util.UUID.fromString(serviceUuid) }.isSuccess) {
                "Bluetooth service UUID is invalid."
            }
            require(connectTimeoutMs in 1_000..30_000) {
                "Bluetooth connect timeout must be 1000..30000 ms."
            }
        }
    }

    companion object {
        const val DEFAULT_USB_TRANSFER_TIMEOUT_MS = 5_000
        const val DEFAULT_LAN_PORT = 9_100
        const val DEFAULT_NETWORK_CONNECT_TIMEOUT_MS = 2_000
        const val DEFAULT_NETWORK_WRITE_TIMEOUT_MS = 8_000
        const val DEFAULT_BLUETOOTH_CONNECT_TIMEOUT_MS = 12_000
        const val DEFAULT_SPP_UUID = "00001101-0000-1000-8000-00805F9B34FB"
        private val MAC_ADDRESS = Regex("^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")

        private fun isPrivateIpv4(value: String): Boolean {
            val parts = value.split('.')
            if (parts.size != 4 || !parts.all { part ->
                part.isNotEmpty() &&
                    part.length <= 3 &&
                    (part.length == 1 || part.first() != '0') &&
                    part.toIntOrNull()?.let { it in 0..255 } == true
            }) return false
            val numbers = parts.map(String::toInt)
            return numbers[0] == 10 ||
                (numbers[0] == 172 && numbers[1] in 16..31) ||
                (numbers[0] == 192 && numbers[1] == 168)
        }
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
        val technicalDetail: String? = null,
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
    LAN_INVALID_CONFIG,
    LAN_CONNECT_FAILED,
    LAN_WRITE_TIMEOUT,
    LAN_WRITE_FAILED,
    BLUETOOTH_UNAVAILABLE,
    BLUETOOTH_PERMISSION_REQUIRED,
    BLUETOOTH_DEVICE_NOT_FOUND,
    BLUETOOTH_NOT_BONDED,
    BLUETOOTH_CONNECT_FAILED,
    BLUETOOTH_WRITE_FAILED,
    TRANSPORT_CONFIG_MISMATCH,
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
