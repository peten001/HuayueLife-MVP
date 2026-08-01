package com.yunqiao.life.merchantterminal.printing

import android.content.Context
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.bluetooth.BluetoothClassicEscPosAdapter
import com.yunqiao.life.merchantterminal.printing.lan.LanEscPosAdapter
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.UsbEscPosAdapter
import com.yunqiao.life.merchantterminal.printing.usb.V2UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.V2UsbBindingResolver
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap

fun interface TransportAdapterFactory {
    fun create(transport: PrinterTransport): PrinterAdapter
}

class AndroidTransportAdapterFactory(context: Context) : TransportAdapterFactory {
    private val applicationContext = context.applicationContext

    override fun create(transport: PrinterTransport): PrinterAdapter = when (transport) {
        PrinterTransport.USB -> UsbEscPosAdapter(applicationContext)
        PrinterTransport.LAN -> LanEscPosAdapter()
        PrinterTransport.BLUETOOTH -> BluetoothClassicEscPosAdapter(applicationContext)
    }
}

class LocalTransportExecutor(
    context: Context,
    private val adapterFactory: TransportAdapterFactory =
        AndroidTransportAdapterFactory(context),
    private val usbInspector: UsbDeviceInspector = UsbDeviceInspector(context),
) {
    suspend fun probe(binding: LocalPrinterBinding): Result<Unit> {
        if (binding.deletedPending) return Result.failure(
            IllegalStateException("Archived binding cannot be probed."),
        )
        return ProcessPrintIoGate.withEndpoint(binding.transportConfig.endpointIdentity()) {
            val adapter = adapterFactory.create(binding.transport)
            try {
                val config = resolveConfig(binding).getOrElse { return@withEndpoint Result.failure(it) }
                adapter.connect(config)
            } finally {
                adapter.disconnect()
            }
        }
    }

    suspend fun printOnce(
        binding: LocalPrinterBinding,
        document: PrintableDocument,
    ): PrintResult {
        if (binding.deletedPending) {
            return PrintResult.Failure(
                code = UsbPrintErrorCode.TRANSPORT_CONFIG_MISMATCH,
                technicalDetail = "Archived binding cannot print.",
                plannedBytes = document.bytes.size,
            )
        }
        return ProcessPrintIoGate.withEndpoint(binding.transportConfig.endpointIdentity()) {
            val adapter = adapterFactory.create(binding.transport)
            try {
                val config = resolveConfig(binding).getOrElse { error ->
                    return@withEndpoint PrintResult.Failure(
                        code = error.asPrintErrorCode(binding.transport),
                        technicalDetail = error.message?.take(160),
                        plannedBytes = document.bytes.size,
                    )
                }
                val connected = adapter.connect(config)
                if (connected.isFailure) {
                    val error = connected.exceptionOrNull()
                    return@withEndpoint PrintResult.Failure(
                        code = error.asPrintErrorCode(binding.transport),
                        technicalDetail = error?.javaClass?.simpleName,
                        plannedBytes = document.bytes.size,
                    )
                }
                adapter.print(document)
            } finally {
                adapter.disconnect()
            }
        }
    }

    private fun resolveConfig(binding: LocalPrinterBinding): Result<PrinterConnectionConfig> =
        runCatching {
            when (val config = binding.transportConfig) {
                is LocalTransportConfig.Usb -> when (
                    val resolution = V2UsbBindingResolver.resolve(config, usbInspector.scan())
                ) {
                    is V2UsbBindingResolution.Ready -> resolution.connectionConfig
                    is V2UsbBindingResolution.Unavailable ->
                        throw LocalTransportException(resolution.errorCode)
                }
                is LocalTransportConfig.Lan -> PrinterConnectionConfig.Lan(
                    host = config.host,
                    port = config.port,
                )
                is LocalTransportConfig.Bluetooth -> PrinterConnectionConfig.Bluetooth(
                    macAddress = config.macAddress,
                    deviceName = config.deviceName,
                    serviceUuid = config.serviceUuid,
                )
            }
        }

    private fun Throwable?.asPrintErrorCode(transport: PrinterTransport): UsbPrintErrorCode =
        (this as? UsbPrinterException)?.code ?: when {
            this is SecurityException && transport == PrinterTransport.BLUETOOTH ->
                UsbPrintErrorCode.BLUETOOTH_PERMISSION_REQUIRED
            this is LocalTransportException && message == "USB_PERMISSION_REQUIRED" ->
                UsbPrintErrorCode.USB_PERMISSION_REQUIRED
            this is LocalTransportException && message == "USB_DEVICE_NOT_FOUND" ->
                UsbPrintErrorCode.USB_DEVICE_NOT_FOUND
            transport == PrinterTransport.USB -> UsbPrintErrorCode.UNKNOWN_USB_ERROR
            transport == PrinterTransport.LAN -> UsbPrintErrorCode.LAN_CONNECT_FAILED
            else -> UsbPrintErrorCode.BLUETOOTH_CONNECT_FAILED
        }
}

private class LocalTransportException(code: String) : Exception(code)

object ProcessPrintIoGate {
    private val endpointLocks = ConcurrentHashMap<String, Mutex>()

    suspend fun <T> withEndpoint(endpointIdentity: String, block: suspend () -> T): T =
        endpointLocks.getOrPut(endpointIdentity) { Mutex() }.withLock { block() }
}
