package com.yunqiao.life.merchantterminal.presentation

import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.ui.BluetoothPrinterUi
import com.yunqiao.life.merchantterminal.ui.DiscoveredLanPrinterUi
import com.yunqiao.life.merchantterminal.ui.PrinterDevicesRoute
import com.yunqiao.life.merchantterminal.ui.PrinterDevicesUiState
import com.yunqiao.life.merchantterminal.ui.PrinterOperationUi
import com.yunqiao.life.merchantterminal.ui.PrinterPhysicalStateUi
import com.yunqiao.life.merchantterminal.ui.PrinterSummaryUi
import com.yunqiao.life.merchantterminal.ui.PrinterTransportUi
import com.yunqiao.life.merchantterminal.printing.bluetooth.BluetoothDiscoveryState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

fun PrinterDevicesCoreState.toUiState(): PrinterDevicesUiState {
    val printers = bindings.map(LocalPrinterBinding::toUiSummary)
    val selectedPrinter = selectedBindingId?.let { id -> printers.firstOrNull { it.id == id } }
    return PrinterDevicesUiState(
        route = route.toUiRoute(),
        printers = printers,
        selectedPrinter = selectedPrinter,
        selectedTransport = selectedTransport.toUiTransport(),
        discoveredLanPrinters = candidates
            .filter { it.transport == PrinterTransport.LAN }
            .map {
                DiscoveredLanPrinterUi(
                    identity = it.identity,
                    name = it.displayName,
                    endpoint = it.endpoint,
                    available = it.available,
                )
            },
        selectedLanIdentity = selectedCandidateId.takeIf {
            selectedTransport == PrinterTransport.LAN
        },
        manualLanEntryVisible = manualLanEntryVisible,
        manualLanHost = manualLanHost,
        manualLanPort = manualLanPort,
        bluetoothPrinters = candidates
            .filter { it.transport == PrinterTransport.BLUETOOTH }
            .map {
                BluetoothPrinterUi(
                    address = it.identity,
                    name = it.displayName,
                    paired = it.paired,
                )
            },
        selectedBluetoothAddress = selectedCandidateId.takeIf {
            selectedTransport == PrinterTransport.BLUETOOTH
        },
        serviceRunning = serviceRunning,
        terminalAuthenticated = terminalAuthenticated,
        bluetoothSupported = bluetoothDiscoveryState != BluetoothDiscoveryState.UNAVAILABLE,
        lastStatusUpdatedAt = bindings.mapNotNull(LocalPrinterBinding::lastStatusReportAt)
            .maxOrNull()
            ?.displayTime(),
        operation = operation.toUiOperation(),
        printerNameDraft = printerNameDraft,
        paperWidthMm = if (paperWidth == PaperWidth.MM_58) 58 else 80,
        archiveConfirmationVisible = archiveConfirmationVisible,
        nameEditVisible = nameEditVisible,
        userMessage = userMessage,
    )
}

private fun LocalPrinterBinding.toUiSummary(): PrinterSummaryUi = PrinterSummaryUi(
    id = localBindingId,
    name = displayName,
    transport = transport.toUiTransport(),
    endpoint = when (val config = transportConfig) {
        is LocalTransportConfig.Usb -> "VID %04X / PID %04X".format(
            Locale.ROOT,
            config.vendorId,
            config.productId,
        )
        is LocalTransportConfig.Lan -> "${config.host}:${config.port}"
        is LocalTransportConfig.Bluetooth -> config.deviceName?.takeIf(String::isNotBlank)
            ?.let { "$it · ${config.macAddress}" }
            ?: config.macAddress
    },
    paperWidthMm = if (paperWidth == PaperWidth.MM_58) 58 else 80,
    physicalState = when (localStatus) {
        PhysicalStatus.CONNECTED -> PrinterPhysicalStateUi.CONNECTED
        PhysicalStatus.DISCONNECTED -> PrinterPhysicalStateUi.OFFLINE
        PhysicalStatus.ERROR -> PrinterPhysicalStateUi.ERROR
        PhysicalStatus.UNKNOWN -> if (syncStatus == BindingSyncStatus.SYNCED) {
            PrinterPhysicalStateUi.CONFIGURED
        } else {
            PrinterPhysicalStateUi.UNKNOWN
        }
    },
    lastConnectedAt = lastConnectedAt?.displayTime(),
    lastTestedAt = lastTestedAt?.displayTime(),
    businessEnabled = enabled,
    platformSynced = syncStatus == BindingSyncStatus.SYNCED,
)

private fun PrinterDevicesCoreRoute.toUiRoute(): PrinterDevicesRoute =
    PrinterDevicesRoute.valueOf(name)

private fun PrinterTransport.toUiTransport(): PrinterTransportUi =
    PrinterTransportUi.valueOf(name)

private fun PrinterOperation.toUiOperation(): PrinterOperationUi =
    PrinterOperationUi.valueOf(name)

private fun Long.displayTime(): String = DISPLAY_TIME_FORMATTER.format(Instant.ofEpochMilli(this))

private val DISPLAY_TIME_FORMATTER: DateTimeFormatter = DateTimeFormatter
    .ofPattern("yyyy-MM-dd HH:mm", Locale.getDefault())
    .withZone(ZoneId.systemDefault())
