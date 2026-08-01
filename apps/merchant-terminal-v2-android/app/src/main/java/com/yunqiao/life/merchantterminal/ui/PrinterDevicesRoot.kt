package com.yunqiao.life.merchantterminal.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
fun PrinterDevicesRoot(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    modifier: Modifier = Modifier,
) {
    BackHandler(enabled = true) {
        when {
            state.archiveConfirmationVisible -> actions.onDismissArchive()
            state.nameEditVisible -> actions.onDismissEditName()
            else -> actions.onBack()
        }
    }
    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .testTag("printer-devices-root"),
    ) {
        val compact = maxWidth < 900.dp
        when (state.route) {
            PrinterDevicesRoute.OVERVIEW -> PrinterDevicesOverviewScreen(state, actions, compact)
            PrinterDevicesRoute.LOCAL_SERVICE -> LocalPrintServiceScreen(state, actions, compact)
            PrinterDevicesRoute.CONNECTION_TYPE -> AddPrinterTypeScreen(state, actions, compact)
            PrinterDevicesRoute.LAN_DISCOVERY -> LanDiscoveryScreen(state, actions, compact)
            PrinterDevicesRoute.LAN_SUCCESS -> LanSuccessScreen(state, actions, compact)
            PrinterDevicesRoute.USB_SETUP -> UsbSetupScreen(state, actions, compact)
            PrinterDevicesRoute.BLUETOOTH_SETUP -> BluetoothSetupScreen(state, actions, compact)
            PrinterDevicesRoute.PRINTER_DETAIL -> PrinterDetailScreen(state, actions, compact)
        }
        if (state.archiveConfirmationVisible) {
            ArchivePrinterConfirmation(state, actions, compact)
        }
        if (state.nameEditVisible) {
            EditPrinterNameConfirmation(state, actions, compact)
        }
    }
}
