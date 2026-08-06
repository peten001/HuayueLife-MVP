package com.yunqiao.life.merchantterminal.ui

import androidx.compose.runtime.Immutable

enum class PrinterDevicesRoute {
    OVERVIEW,
    CONNECTION_TYPE,
    LAN_DISCOVERY,
    LAN_SUCCESS,
    USB_SETUP,
    BLUETOOTH_SETUP,
    PRINTER_DETAIL,
}

enum class PrinterTransportUi {
    USB,
    LAN,
    BLUETOOTH,
}

enum class PrinterPhysicalStateUi {
    CONNECTED,
    PAIRED,
    CONFIGURED,
    OFFLINE,
    ERROR,
    UNKNOWN,
}

enum class PrinterOperationUi {
    IDLE,
    DISCOVERING,
    CONNECTING,
    SYNCING,
    TESTING,
    SUCCESS,
    FAILURE,
    UNCERTAIN,
    RECOVERING,
    ARCHIVED,
}

enum class UsbPermissionStateUi {
    IDLE,
    REQUIRED,
    REQUESTING,
    GRANTED,
    DENIED,
    FAILED,
    TIMED_OUT,
}

@Immutable
data class PrinterSummaryUi(
    val id: String,
    val name: String,
    val transport: PrinterTransportUi,
    val endpoint: String? = null,
    val paperWidthMm: Int = 80,
    val physicalState: PrinterPhysicalStateUi = PrinterPhysicalStateUi.UNKNOWN,
    val lastConnectedAt: String? = null,
    val lastTestedAt: String? = null,
    val businessEnabled: Boolean = true,
    val platformSynced: Boolean = false,
)

@Immutable
data class DiscoveredLanPrinterUi(
    val identity: String,
    val name: String,
    val endpoint: String,
    val available: Boolean = true,
)

@Immutable
data class UsbPrinterCandidateUi(
    val identity: String,
    val name: String,
    val endpoint: String,
    val hasPermission: Boolean,
    val selected: Boolean,
)

@Immutable
data class BluetoothPrinterUi(
    val address: String,
    val name: String,
    val signalLevel: Int = 3,
    val paired: Boolean = false,
)

@Immutable
data class PrinterDevicesUiState(
    val route: PrinterDevicesRoute = PrinterDevicesRoute.OVERVIEW,
    val printers: List<PrinterSummaryUi> = emptyList(),
    val selectedPrinter: PrinterSummaryUi? = null,
    val selectedTransport: PrinterTransportUi = PrinterTransportUi.LAN,
    val usbPrinters: List<UsbPrinterCandidateUi> = emptyList(),
    val selectedUsbIdentity: String? = null,
    val usbPermissionState: UsbPermissionStateUi = UsbPermissionStateUi.IDLE,
    val discoveredLanPrinters: List<DiscoveredLanPrinterUi> = emptyList(),
    val selectedLanIdentity: String? = null,
    val manualLanEntryVisible: Boolean = false,
    val manualLanHost: String = "",
    val manualLanPort: Int = 9100,
    val bluetoothPrinters: List<BluetoothPrinterUi> = emptyList(),
    val selectedBluetoothAddress: String? = null,
    val serviceRunning: Boolean = true,
    val terminalAuthenticated: Boolean = true,
    val usbSupported: Boolean = true,
    val lanSupported: Boolean = true,
    val bluetoothSupported: Boolean = true,
    val lastStatusUpdatedAt: String? = null,
    val operation: PrinterOperationUi = PrinterOperationUi.IDLE,
    val printerNameDraft: String = "",
    val paperWidthMm: Int = 80,
    val archiveConfirmationVisible: Boolean = false,
    val nameEditVisible: Boolean = false,
    val userMessage: String? = null,
)

@Immutable
data class PrinterDevicesActions(
    val onBack: () -> Unit = {},
    val onClose: () -> Unit = {},
    val onOpenService: () -> Unit = {},
    val onAddPrinter: () -> Unit = {},
    val onManagePrinter: (String) -> Unit = {},
    val onSelectTransport: (PrinterTransportUi) -> Unit = {},
    val onContinueAdd: () -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onSelectUsb: (String) -> Unit = {},
    val onSelectLanPrinter: (String) -> Unit = {},
    val onManualLanAddress: () -> Unit = {},
    val onManualLanAddressChanged: (String, Int) -> Unit = { _, _ -> },
    val onSelectBluetoothPrinter: (String) -> Unit = {},
    val onPairBluetoothPrinter: (String) -> Unit = {},
    val onPrinterNameChanged: (String) -> Unit = {},
    val onPaperWidthChanged: (Int) -> Unit = {},
    val onTestPrinter: (String?) -> Unit = {},
    val onSavePrinter: () -> Unit = {},
    val onAddAnother: () -> Unit = {},
    val onFinish: () -> Unit = {},
    val onRequestEditName: () -> Unit = {},
    val onConfirmEditName: () -> Unit = {},
    val onDismissEditName: () -> Unit = {},
    val onRequestArchive: () -> Unit = {},
    val onConfirmArchive: () -> Unit = {},
    val onDismissArchive: () -> Unit = {},
)
