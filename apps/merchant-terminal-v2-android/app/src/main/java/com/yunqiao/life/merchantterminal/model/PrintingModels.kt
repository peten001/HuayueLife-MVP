package com.yunqiao.life.merchantterminal.model

import com.yunqiao.life.merchantterminal.printing.PaperWidth
import org.json.JSONObject
import java.util.UUID

enum class PrinterTransport {
    USB,
    LAN,
    BLUETOOTH,
}

enum class PhysicalStatus {
    UNKNOWN,
    CONNECTED,
    DISCONNECTED,
    ERROR,
}

enum class StatusSource {
    PROBE,
    LOCAL_TEST,
    PRINT_RESULT,
}

enum class BindingSyncStatus {
    LOCAL_ONLY,
    PENDING_SYNC,
    SYNCED,
    CONFLICT,
    PENDING_ARCHIVE,
    ERROR,
}

enum class PendingBindingOperationType {
    SYNC,
    ARCHIVE,
}

enum class PrintExecutionState {
    CLAIMED,
    PRINTING,
    SUCCEEDED,
    FAILED,
    UNCERTAIN,
}

sealed interface LocalTransportConfig {
    fun endpointIdentity(): String

    data class Usb(
        val vendorId: Int,
        val productId: Int,
        val deviceName: String?,
        val interfaceIndex: Int,
        val interfaceId: Int,
        val alternateSetting: Int,
        val interfaceClass: Int?,
        val endpointAddress: Int,
    ) : LocalTransportConfig {
        init {
            require(vendorId in 0..65_535)
            require(productId in 0..65_535)
            require(interfaceIndex >= 0)
            require(interfaceId >= 0)
            require(alternateSetting >= 0)
            require(interfaceClass == null || interfaceClass in 0..255)
            require(endpointAddress in 0..255)
        }

        override fun endpointIdentity(): String =
            "usb:$vendorId:$productId:$interfaceId:$alternateSetting:$endpointAddress"
    }

    data class Lan(
        val host: String,
        val port: Int = 9_100,
    ) : LocalTransportConfig {
        init {
            require(Ipv4Address.isPrivate(host))
            require(port in 1..65_535)
        }

        override fun endpointIdentity(): String = "lan:$host:$port"
    }

    data class Bluetooth(
        val macAddress: String,
        val deviceName: String?,
        val serviceUuid: String,
    ) : LocalTransportConfig {
        init {
            require(BLUETOOTH_MAC.matches(macAddress.uppercase()))
            require(runCatching { UUID.fromString(serviceUuid) }.isSuccess)
        }

        override fun endpointIdentity(): String =
            "bluetooth:${macAddress.uppercase()}:${serviceUuid.lowercase()}"
    }

    private companion object {
        val BLUETOOTH_MAC = Regex("^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")
    }
}

data class LocalPrinterBinding(
    val merchantId: String,
    val terminalInstanceId: String,
    val localBindingId: String,
    val printerId: String?,
    val bindingVersion: Long,
    val transport: PrinterTransport,
    val displayName: String,
    val paperWidth: PaperWidth,
    val transportConfig: LocalTransportConfig,
    val localStatus: PhysicalStatus,
    val syncStatus: BindingSyncStatus,
    val deletedPending: Boolean,
    val enabled: Boolean,
    val lastConnectedAt: Long?,
    val lastTestedAt: Long?,
    val lastStatusReportAt: Long?,
) {
    init {
        require(NUMERIC_ID.matches(merchantId))
        require(terminalInstanceId.length in 16..128)
        require(runCatching { UUID.fromString(localBindingId) }.isSuccess)
        require(printerId == null || NUMERIC_ID.matches(printerId))
        require(bindingVersion >= 0)
        require(displayName.isNotBlank() && displayName.length <= 160)
        require(
            (transport == PrinterTransport.USB && transportConfig is LocalTransportConfig.Usb) ||
                (transport == PrinterTransport.LAN && transportConfig is LocalTransportConfig.Lan) ||
                (
                    transport == PrinterTransport.BLUETOOTH &&
                        transportConfig is LocalTransportConfig.Bluetooth
                    ),
        )
    }

    companion object {
        private val NUMERIC_ID = Regex("^[1-9][0-9]{0,18}$")
    }
}

object Ipv4Address {
    fun isValid(value: String): Boolean {
        val parts = value.split('.')
        return parts.size == 4 && parts.all { part ->
            part.isNotEmpty() &&
                part.length <= 3 &&
                (part.length == 1 || part.first() != '0') &&
                part.toIntOrNull()?.let { it in 0..255 } == true
        }
    }

    fun isPrivate(value: String): Boolean {
        if (!isValid(value)) return false
        val parts = value.split('.').map(String::toInt)
        return parts[0] == 10 ||
            (parts[0] == 172 && parts[1] in 16..31) ||
            (parts[0] == 192 && parts[1] == 168)
    }
}

object TransportConfigJson {
    fun encode(config: LocalTransportConfig): String = when (config) {
        is LocalTransportConfig.Usb -> JSONObject()
            .put("vendorId", config.vendorId)
            .put("productId", config.productId)
            .put("deviceName", config.deviceName ?: JSONObject.NULL)
            .put("interfaceIndex", config.interfaceIndex)
            .put("interfaceId", config.interfaceId)
            .put("alternateSetting", config.alternateSetting)
            .put("interfaceClass", config.interfaceClass ?: JSONObject.NULL)
            .put("endpointAddress", config.endpointAddress)
            .toString()
        is LocalTransportConfig.Lan -> JSONObject()
            .put("host", config.host)
            .put("port", config.port)
            .toString()
        is LocalTransportConfig.Bluetooth -> JSONObject()
            .put("macAddress", config.macAddress.uppercase())
            .put("deviceName", config.deviceName ?: JSONObject.NULL)
            .put("serviceUuid", config.serviceUuid)
            .toString()
    }

    fun decode(transport: PrinterTransport, json: String): LocalTransportConfig {
        require(json.length in 2..4_096)
        val value = JSONObject(json)
        return when (transport) {
            PrinterTransport.USB -> LocalTransportConfig.Usb(
                vendorId = value.requiredInt("vendorId", 0..65_535),
                productId = value.requiredInt("productId", 0..65_535),
                deviceName = value.optionalString("deviceName", 512),
                interfaceIndex = value.requiredInt("interfaceIndex", 0..255),
                interfaceId = value.requiredInt("interfaceId", 0..255),
                alternateSetting = value.requiredInt("alternateSetting", 0..255),
                interfaceClass = value.optionalInt("interfaceClass", 0..255),
                endpointAddress = value.requiredInt("endpointAddress", 0..255),
            )
            PrinterTransport.LAN -> LocalTransportConfig.Lan(
                host = value.requiredString("host", 64),
                port = value.requiredInt("port", 1..65_535),
            )
            PrinterTransport.BLUETOOTH -> LocalTransportConfig.Bluetooth(
                macAddress = value.requiredString("macAddress", 17),
                deviceName = value.optionalString("deviceName", 160),
                serviceUuid = value.requiredString("serviceUuid", 64),
            )
        }
    }

    private fun JSONObject.requiredString(key: String, maxLength: Int): String =
        optString(key).takeIf { it.isNotBlank() && it.length <= maxLength }
            ?: throw IllegalArgumentException("Missing or invalid $key")

    private fun JSONObject.optionalString(key: String, maxLength: Int): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it.length <= maxLength }

    private fun JSONObject.requiredInt(key: String, range: IntRange): Int =
        if (has(key) && !isNull(key)) getInt(key).takeIf { it in range }
            ?: throw IllegalArgumentException("Invalid $key")
        else throw IllegalArgumentException("Missing $key")

    private fun JSONObject.optionalInt(key: String, range: IntRange): Int? =
        if (isNull(key)) null else getInt(key).takeIf { it in range }
            ?: throw IllegalArgumentException("Invalid $key")
}
