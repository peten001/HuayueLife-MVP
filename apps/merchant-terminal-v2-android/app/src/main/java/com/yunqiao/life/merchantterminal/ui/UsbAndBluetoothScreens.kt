package com.yunqiao.life.merchantterminal.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yunqiao.life.merchantterminal.R

@Composable
internal fun UsbSetupScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    val usbPrinters = state.usbPrinters
    val selected = state.selectedUsbIdentity?.let { identity ->
        usbPrinters.firstOrNull { it.identity == identity }
    }
    val busy = state.operation in setOf(
        PrinterOperationUi.DISCOVERING,
        PrinterOperationUi.CONNECTING,
        PrinterOperationUi.TESTING,
        PrinterOperationUi.SYNCING,
    ) || state.usbPermissionState == UsbPermissionStateUi.REQUESTING
    ModalScrim(alpha = .42f) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val modalWidth = if (compact) maxWidth else 891.dp
            val modalHeight = if (compact) maxHeight else 661.dp
            val d2 = !compact && maxWidth >= 1320.dp && maxHeight in 740.dp..790.dp
            Column(
                Modifier.then(
                    if (d2) Modifier.align(Alignment.TopStart).offset(275.dp, 94.dp)
                    else Modifier.align(Alignment.Center),
                )
                    .width(modalWidth).height(modalHeight)
                    .clip(RoundedCornerShape(if (compact) 0.dp else 18.dp))
                    .background(Color.White)
                    .testTag("screen-07-usb-setup")
                    .padding(horizontal = if (compact) 20.dp else 22.dp, vertical = 18.dp)
                    .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    IconTouchTarget(YunQiaoIconKind.BACK, actions.onBack, stringResource(R.string.common_back))
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(R.string.add_usb_printer), style = YunQiaoUiTokens.Heading22)
                        Text(stringResource(R.string.usb_setup_subtitle), style = YunQiaoUiTokens.Body)
                    }
                    IconTouchTarget(YunQiaoIconKind.CLOSE, actions.onClose, stringResource(R.string.common_close))
                }
                Spacer(Modifier.height(15.dp))
                UsbProcessCard()
                Spacer(Modifier.height(17.dp))
                UsbDeviceSection(state, usbPrinters, selected, actions)
                Spacer(Modifier.height(14.dp))
                UsbSettings(state, selected, actions)
                Spacer(Modifier.weight(1f))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    YunQiaoButton(
                        text = stringResource(
                            if (state.operation == PrinterOperationUi.TESTING) R.string.common_testing else R.string.common_test,
                        ),
                        onClick = { actions.onTestPrinter(null) },
                        modifier = Modifier.weight(1f),
                        icon = YunQiaoIconKind.PRINTER,
                        accent = YunQiaoUiTokens.Usb.Green,
                        visualHeight = 53.dp,
                        enabled = selected != null && !busy,
                    )
                    YunQiaoButton(
                        text = stringResource(
                            if (state.operation == PrinterOperationUi.SYNCING) R.string.common_syncing else R.string.common_save,
                        ),
                        onClick = actions.onSavePrinter,
                        modifier = Modifier.weight(1.03f),
                        style = YunQiaoButtonStyle.PRIMARY,
                        accent = YunQiaoUiTokens.Usb.Green,
                        visualHeight = 53.dp,
                        enabled = selected != null && !busy,
                    )
                }
            }
        }
    }
}

@Composable
private fun UsbProcessCard() {
    ReferenceCard(
        Modifier.fillMaxWidth().height(123.dp), radius = 12.dp,
        backgroundColor = YunQiaoUiTokens.Usb.Green.copy(alpha = .035f),
        borderColor = YunQiaoUiTokens.Usb.Green.copy(alpha = .18f), shadow = 0.dp,
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 34.dp), verticalAlignment = Alignment.CenterVertically) {
            ThermalPrinterIllustration(Modifier.size(115.dp))
            Spacer(Modifier.width(38.dp))
            UsbStep(1, R.string.usb_step_connect, R.string.usb_step_connect_body)
            StepArrow()
            UsbStep(2, R.string.usb_step_recognize, R.string.usb_step_recognize_body)
            StepArrow()
            UsbStep(3, R.string.usb_step_ready, R.string.usb_step_ready_body)
        }
    }
}

@Composable
private fun UsbStep(number: Int, title: Int, body: Int) {
    Row(verticalAlignment = Alignment.Top) {
        Box(
            Modifier.size(30.dp).clip(RoundedCornerShape(50)).background(YunQiaoUiTokens.Usb.Green),
            contentAlignment = Alignment.Center,
        ) { Text(number.toString(), color = Color.White, fontWeight = FontWeight.Bold) }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.width(120.dp)) {
            Text(stringResource(title), style = YunQiaoUiTokens.Label)
            Spacer(Modifier.height(4.dp))
            Text(stringResource(body), style = YunQiaoUiTokens.Meta, maxLines = 2)
        }
    }
}

@Composable
private fun StepArrow() {
    Row(Modifier.padding(horizontal = 7.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(18.dp).height(1.dp).background(YunQiaoUiTokens.Usb.Green.copy(alpha = .55f)))
        YunQiaoIcon(YunQiaoIconKind.CHEVRON_RIGHT, Modifier.size(13.dp), YunQiaoUiTokens.Usb.Green.copy(alpha = .65f))
    }
}

@Composable
private fun UsbDeviceSection(
    state: PrinterDevicesUiState,
    printers: List<UsbPrinterCandidateUi>,
    selected: UsbPrinterCandidateUi?,
    actions: PrinterDevicesActions,
) {
    val error = state.operation in setOf(
        PrinterOperationUi.FAILURE,
        PrinterOperationUi.UNCERTAIN,
    ) || state.usbPermissionState in setOf(
        UsbPermissionStateUi.DENIED,
        UsbPermissionStateUi.FAILED,
        UsbPermissionStateUi.TIMED_OUT,
    )
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(23.dp).clip(RoundedCornerShape(50)).background(
                if (printers.isNotEmpty()) YunQiaoUiTokens.Usb.Green else if (error) YunQiaoUiTokens.Danger else YunQiaoUiTokens.Warning,
            ),
            contentAlignment = Alignment.Center,
        ) {
            YunQiaoIcon(if (printers.isNotEmpty()) YunQiaoIconKind.CHECK else YunQiaoIconKind.INFO, Modifier.size(14.dp), Color.White)
        }
        Spacer(Modifier.width(11.dp))
        Text(
            when {
                state.operation == PrinterOperationUi.DISCOVERING -> stringResource(R.string.searching)
                printers.isNotEmpty() -> stringResource(R.string.usb_detected_count, printers.size)
                else -> stringResource(R.string.usb_not_detected)
            },
            style = YunQiaoUiTokens.Label.copy(fontSize = 18.sp),
        )
        if (printers.isEmpty()) {
            Spacer(Modifier.weight(1f))
            YunQiaoButton(
                stringResource(R.string.common_retry_action),
                actions.onRetry,
                Modifier.width(135.dp),
                accent = YunQiaoUiTokens.Usb.Green,
            )
        }
    }
    Spacer(Modifier.height(12.dp))
    if (printers.isNotEmpty()) {
        LazyColumn(Modifier.fillMaxWidth().height(90.dp)) {
            items(printers, key = UsbPrinterCandidateUi::identity) { printer ->
                UsbCandidateRow(printer, actions.onSelectUsb)
            }
        }
    } else {
        val message = state.userMessage ?: stringResource(
            when (state.usbPermissionState) {
                UsbPermissionStateUi.DENIED -> R.string.usb_permission_denied
                UsbPermissionStateUi.FAILED -> R.string.controller_usb_permission_failed
                UsbPermissionStateUi.TIMED_OUT -> R.string.controller_usb_permission_timeout
                else -> R.string.usb_permission_hint
            },
        )
        ReferenceCard(
            Modifier.fillMaxWidth().height(90.dp), radius = 12.dp,
            backgroundColor = (if (error) YunQiaoUiTokens.Danger else YunQiaoUiTokens.Warning).copy(alpha = .06f),
            borderColor = (if (error) YunQiaoUiTokens.Danger else YunQiaoUiTokens.Warning).copy(alpha = .35f), shadow = 0.dp,
        ) {
            Row(Modifier.fillMaxSize().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                YunQiaoIcon(YunQiaoIconKind.USB, Modifier.size(34.dp), if (error) YunQiaoUiTokens.Danger else YunQiaoUiTokens.Warning)
                Spacer(Modifier.width(17.dp))
                Text(message, style = YunQiaoUiTokens.Body, maxLines = 3)
            }
        }
    }
    if (printers.isNotEmpty()) {
        Spacer(Modifier.height(9.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            YunQiaoIcon(YunQiaoIconKind.INFO, Modifier.size(18.dp), YunQiaoUiTokens.Muted)
            Spacer(Modifier.width(9.dp))
            Text(
                state.userMessage ?: when {
                    selected == null -> stringResource(R.string.controller_usb_select_printer)
                    state.usbPermissionState == UsbPermissionStateUi.REQUESTING ->
                        stringResource(R.string.usb_permission_waiting)
                    !selected.hasPermission ->
                        stringResource(R.string.controller_usb_permission_required)
                    else -> stringResource(R.string.usb_permission_hint)
                },
                style = YunQiaoUiTokens.Meta,
                maxLines = 2,
            )
        }
    }
}

@Composable
private fun UsbCandidateRow(
    candidate: UsbPrinterCandidateUi,
    onSelect: (String) -> Unit,
) {
    val color = if (candidate.hasPermission) YunQiaoUiTokens.Usb.Green else YunQiaoUiTokens.Warning
    ReferenceCard(
        Modifier.fillMaxWidth().height(82.dp)
            .semantics { selected = candidate.selected; role = Role.RadioButton }
            .clickable { onSelect(candidate.identity) },
        radius = 12.dp,
        backgroundColor = if (candidate.selected) color.copy(alpha = .05f) else Color.White,
        borderColor = if (candidate.selected) color else YunQiaoUiTokens.Usb.Border,
        shadow = 0.dp,
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(54.dp).clip(RoundedCornerShape(10.dp))
                    .background(YunQiaoUiTokens.Usb.Green.copy(alpha = .09f)),
                contentAlignment = Alignment.Center,
            ) { ThermalPrinterIllustration(Modifier.size(50.dp)) }
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f)) {
                Text(candidate.name, style = YunQiaoUiTokens.ItemTitle, maxLines = 1)
                Spacer(Modifier.height(4.dp))
                Text(candidate.endpoint, style = YunQiaoUiTokens.Body, maxLines = 1)
            }
            StatusPill(
                stringResource(
                    if (candidate.hasPermission) {
                        R.string.common_available
                    } else {
                        R.string.usb_permission_required_short
                    },
                ),
                color,
                dot = candidate.hasPermission,
            )
        }
    }
}

@Composable
private fun UsbSettings(
    state: PrinterDevicesUiState,
    selected: UsbPrinterCandidateUi?,
    actions: PrinterDevicesActions,
) {
    ReferenceCard(
        Modifier.fillMaxWidth().height(160.dp), radius = 12.dp,
        borderColor = YunQiaoUiTokens.Usb.Border, shadow = 0.dp,
    ) {
        Column(Modifier.fillMaxSize().padding(17.dp)) {
            Text(stringResource(R.string.printer_settings), style = YunQiaoUiTokens.Label.copy(fontSize = 18.sp))
            Spacer(Modifier.height(13.dp))
            LabeledNameField(
                label = stringResource(R.string.printer_name),
                initial = state.printerNameDraft.ifBlank { selected?.name.orEmpty() },
                onChanged = actions.onPrinterNameChanged,
                accent = YunQiaoUiTokens.Usb.Green,
            )
            Spacer(Modifier.height(13.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.paper_width), style = YunQiaoUiTokens.Body.copy(color = YunQiaoUiTokens.Ink), modifier = Modifier.width(130.dp))
                PaperWidthChoice(58, state.paperWidthMm == 58, { actions.onPaperWidthChanged(58) }, Modifier.weight(1f), YunQiaoUiTokens.Usb.Green)
                Spacer(Modifier.width(9.dp))
                PaperWidthChoice(80, state.paperWidthMm == 80, { actions.onPaperWidthChanged(80) }, Modifier.weight(1f), YunQiaoUiTokens.Usb.Green)
            }
        }
    }
}

@Composable
internal fun LabeledNameField(
    label: String,
    initial: String,
    onChanged: (String) -> Unit,
    accent: Color,
) {
    var value by remember(initial) { mutableStateOf(initial) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = YunQiaoUiTokens.Body.copy(color = YunQiaoUiTokens.Ink), modifier = Modifier.width(130.dp))
        Box(
            Modifier.weight(1f).height(42.dp).clip(RoundedCornerShape(8.dp)).background(Color.White)
                .border(1.dp, Color(0xFFD8E0E5), RoundedCornerShape(8.dp)).padding(horizontal = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            BasicTextField(
                value = value,
                onValueChange = { value = it.take(20); onChanged(value) },
                modifier = Modifier.fillMaxWidth(),
                textStyle = YunQiaoUiTokens.Body.copy(color = YunQiaoUiTokens.Ink),
                cursorBrush = SolidColor(accent),
                singleLine = true,
            )
        }
    }
}

@Composable
private fun PaperWidthChoice(
    width: Int,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier,
    accent: Color,
    tall: Boolean = false,
) {
    val shape = RoundedCornerShape(9.dp)
    Row(
        modifier.height(if (tall) 80.dp else 43.dp).clip(shape)
            .background(if (selected) accent.copy(alpha = .10f) else Color.White)
            .border(if (selected) 2.dp else 1.dp, if (selected) accent else Color(0xFFDDE3E8), shape)
            .semantics { role = Role.RadioButton; this.selected = selected }
            .clickable(onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.paper_width_value, width), style = YunQiaoUiTokens.Label, color = if (selected) accent else YunQiaoUiTokens.Ink)
            if (tall) Text(stringResource(R.string.paper_width), style = YunQiaoUiTokens.Meta)
        }
        if (selected) {
            Box(Modifier.size(19.dp).clip(RoundedCornerShape(50)).background(accent), contentAlignment = Alignment.Center) {
                YunQiaoIcon(YunQiaoIconKind.CHECK, Modifier.size(12.dp), Color.White)
            }
        }
    }
}

@Composable
internal fun BluetoothSetupScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    val paired = state.bluetoothPrinters.filter { it.paired }
    val nearby = state.bluetoothPrinters.filterNot { it.paired }
    val selected = state.bluetoothPrinters.firstOrNull { it.address == state.selectedBluetoothAddress }
        ?: paired.firstOrNull() ?: nearby.firstOrNull()
    ModalScrim(alpha = .25f) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val modalWidth = if (compact) maxWidth else 1053.dp
            val modalHeight = if (compact) maxHeight else 646.dp
            val d2 = !compact && maxWidth >= 1320.dp && maxHeight in 740.dp..790.dp
            Column(
                Modifier.then(
                    if (d2) Modifier.align(Alignment.TopStart).offset(234.dp, 93.dp)
                    else Modifier.align(Alignment.Center),
                ).width(modalWidth).height(modalHeight)
                    .clip(RoundedCornerShape(if (compact) 0.dp else 20.dp)).background(Color.White)
                    .testTag("screen-08-bluetooth-setup")
                    .padding(horizontal = if (compact) 20.dp else 43.dp, vertical = 25.dp)
                    .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.add_bluetooth_printer), style = if (compact) YunQiaoUiTokens.Heading24 else YunQiaoUiTokens.Heading02)
                        Spacer(Modifier.height(5.dp))
                        Text(stringResource(R.string.bluetooth_setup_subtitle), style = YunQiaoUiTokens.Body)
                    }
                    StatusPill(
                        stringResource(if (state.bluetoothSupported) R.string.bluetooth_on else R.string.bluetooth_off),
                        if (state.bluetoothSupported) YunQiaoUiTokens.Bluetooth.Green else YunQiaoUiTokens.Danger,
                        dot = true,
                    )
                    Spacer(Modifier.width(10.dp))
                    IconTouchTarget(YunQiaoIconKind.CLOSE, actions.onClose, stringResource(R.string.common_close))
                }
                Spacer(Modifier.height(26.dp))
                if (compact) {
                    BluetoothDeviceColumn(state, paired, nearby, actions, Modifier.fillMaxWidth())
                    Spacer(Modifier.height(20.dp))
                    BluetoothSettings(state, selected, actions, Modifier.fillMaxWidth())
                } else {
                    Row(Modifier.fillMaxWidth().height(430.dp), horizontalArrangement = Arrangement.spacedBy(78.dp)) {
                        BluetoothDeviceColumn(state, paired, nearby, actions, Modifier.width(435.dp).fillMaxHeight())
                        BluetoothSettings(state, selected, actions, Modifier.weight(1f).fillMaxHeight())
                    }
                }
                Spacer(Modifier.weight(1f))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    YunQiaoButton(
                        text = stringResource(if (state.operation == PrinterOperationUi.TESTING) R.string.common_testing else R.string.common_test),
                        onClick = { actions.onTestPrinter(selected?.address) },
                        modifier = Modifier.width(if (compact) 0.dp else 171.dp).then(if (compact) Modifier.weight(1f) else Modifier),
                        accent = YunQiaoUiTokens.BodyColor,
                        visualHeight = 54.dp,
                        enabled = selected != null && state.operation != PrinterOperationUi.TESTING,
                    )
                    Spacer(Modifier.width(24.dp))
                    YunQiaoButton(
                        text = stringResource(if (state.operation == PrinterOperationUi.SYNCING) R.string.common_syncing else R.string.common_save),
                        onClick = actions.onSavePrinter,
                        modifier = Modifier.width(if (compact) 0.dp else 181.dp).then(if (compact) Modifier.weight(1f) else Modifier),
                        style = YunQiaoButtonStyle.PRIMARY,
                        accent = YunQiaoUiTokens.Bluetooth.Green,
                        visualHeight = 54.dp,
                        enabled = selected?.paired == true && state.operation != PrinterOperationUi.SYNCING,
                    )
                }
            }
        }
    }
}

@Composable
private fun BluetoothDeviceColumn(
    state: PrinterDevicesUiState,
    paired: List<BluetoothPrinterUi>,
    nearby: List<BluetoothPrinterUi>,
    actions: PrinterDevicesActions,
    modifier: Modifier,
) {
    Column(modifier) {
        Text(stringResource(R.string.paired_devices), style = YunQiaoUiTokens.Label.copy(fontSize = 18.sp))
        Spacer(Modifier.height(12.dp))
        if (paired.isEmpty()) {
            BluetoothEmptyNotice(stringResource(R.string.bluetooth_empty), actions.onRetry)
        } else {
            BluetoothDeviceRow(paired.first(), state.selectedBluetoothAddress == paired.first().address, actions)
        }
        Spacer(Modifier.height(27.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.nearby_devices), style = YunQiaoUiTokens.Label.copy(fontSize = 18.sp))
            Spacer(Modifier.width(14.dp))
            if (state.operation == PrinterOperationUi.DISCOVERING) {
                YunQiaoIcon(YunQiaoIconKind.REFRESH, Modifier.size(18.dp), YunQiaoUiTokens.Muted)
                Spacer(Modifier.width(7.dp))
                Text(stringResource(R.string.scanning), style = YunQiaoUiTokens.Body)
            }
        }
        Spacer(Modifier.height(12.dp))
        when {
            state.operation == PrinterOperationUi.FAILURE -> BluetoothEmptyNotice(stringResource(R.string.bluetooth_permission_denied), actions.onRetry)
            nearby.isEmpty() -> BluetoothEmptyNotice(stringResource(R.string.bluetooth_empty), actions.onRetry)
            else -> nearby.take(2).forEachIndexed { index, item ->
                if (index > 0) Spacer(Modifier.height(12.dp))
                BluetoothDeviceRow(item, state.selectedBluetoothAddress == item.address, actions)
            }
        }
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically) {
            YunQiaoIcon(YunQiaoIconKind.INFO, Modifier.size(20.dp), YunQiaoUiTokens.Muted)
            Spacer(Modifier.width(10.dp))
            Text(stringResource(R.string.bluetooth_not_found), style = YunQiaoUiTokens.Meta, maxLines = 2)
        }
    }
}

@Composable
private fun BluetoothDeviceRow(
    printer: BluetoothPrinterUi,
    selected: Boolean,
    actions: PrinterDevicesActions,
) {
    ReferenceCard(
        Modifier.fillMaxWidth().height(87.dp).clickable { actions.onSelectBluetoothPrinter(printer.address) },
        radius = 12.dp,
        backgroundColor = if (selected) YunQiaoUiTokens.Bluetooth.Selected else Color.White,
        borderColor = if (selected) YunQiaoUiTokens.Bluetooth.Green else YunQiaoUiTokens.Bluetooth.Neutral,
        borderWidth = if (selected) 2.dp else 1.dp,
        shadow = 1.dp,
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(48.dp).clip(RoundedCornerShape(50)).background(YunQiaoUiTokens.Bluetooth.Green.copy(alpha = if (printer.paired) 1f else .10f)),
                contentAlignment = Alignment.Center,
            ) { YunQiaoIcon(YunQiaoIconKind.PRINTER, Modifier.size(26.dp), if (printer.paired) Color.White else YunQiaoUiTokens.Bluetooth.Green) }
            Spacer(Modifier.width(15.dp))
            Column(Modifier.weight(1f)) {
                Text(printer.name, style = YunQiaoUiTokens.Label.copy(fontSize = 17.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(5.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (printer.paired) StatusPill(stringResource(R.string.paired), YunQiaoUiTokens.Bluetooth.Green)
                    else {
                        YunQiaoIcon(YunQiaoIconKind.SIGNAL, Modifier.size(28.dp, 15.dp), YunQiaoUiTokens.Bluetooth.Green)
                        Spacer(Modifier.width(7.dp))
                        Text(stringResource(if (printer.signalLevel >= 3) R.string.signal_good else R.string.signal_fair), style = YunQiaoUiTokens.Meta)
                    }
                }
            }
            if (printer.paired) {
                YunQiaoIcon(YunQiaoIconKind.CHEVRON_RIGHT, Modifier.size(18.dp), YunQiaoUiTokens.Muted)
            } else {
                YunQiaoButton(
                    stringResource(R.string.pair),
                    { actions.onPairBluetoothPrinter(printer.address) },
                    Modifier.width(78.dp),
                    accent = YunQiaoUiTokens.Bluetooth.Green,
                    visualHeight = 43.dp,
                )
            }
        }
    }
}

@Composable
private fun BluetoothEmptyNotice(text: String, onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(87.dp).clip(RoundedCornerShape(12.dp))
            .background(YunQiaoUiTokens.Warning.copy(alpha = .06f))
            .border(1.dp, YunQiaoUiTokens.Warning.copy(alpha = .25f), RoundedCornerShape(12.dp))
            .clickable(onClick = onRetry).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        YunQiaoIcon(YunQiaoIconKind.BLUETOOTH, Modifier.size(28.dp), YunQiaoUiTokens.Warning)
        Spacer(Modifier.width(12.dp))
        Text(text, style = YunQiaoUiTokens.Body, modifier = Modifier.weight(1f), maxLines = 3)
        Text(stringResource(R.string.common_retry_action), style = YunQiaoUiTokens.Label, color = YunQiaoUiTokens.Warning)
    }
}

@Composable
private fun BluetoothSettings(
    state: PrinterDevicesUiState,
    selected: BluetoothPrinterUi?,
    actions: PrinterDevicesActions,
    modifier: Modifier,
) {
    Column(modifier) {
        Text(stringResource(R.string.selected_printer_settings), style = YunQiaoUiTokens.Label.copy(fontSize = 18.sp))
        Spacer(Modifier.height(12.dp))
        ReferenceCard(
            Modifier.fillMaxWidth().height(245.dp), radius = 12.dp,
            borderColor = YunQiaoUiTokens.Bluetooth.Neutral, shadow = 0.dp,
        ) {
            Column(Modifier.fillMaxSize().padding(18.dp)) {
                Text(stringResource(R.string.printer_name), style = YunQiaoUiTokens.Label)
                Spacer(Modifier.height(8.dp))
                LabeledNameField(
                    label = "",
                    initial = state.printerNameDraft.ifBlank { selected?.name.orEmpty() },
                    onChanged = actions.onPrinterNameChanged,
                    accent = YunQiaoUiTokens.Bluetooth.Green,
                )
                Spacer(Modifier.height(20.dp))
                Text(stringResource(R.string.paper_width), style = YunQiaoUiTokens.Label)
                Spacer(Modifier.height(9.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    PaperWidthChoice(58, state.paperWidthMm == 58, { actions.onPaperWidthChanged(58) }, Modifier.weight(1f), YunQiaoUiTokens.Bluetooth.Green, tall = true)
                    PaperWidthChoice(80, state.paperWidthMm == 80, { actions.onPaperWidthChanged(80) }, Modifier.weight(1f), YunQiaoUiTokens.Bluetooth.Green, tall = true)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(10.dp))
                .background(YunQiaoUiTokens.Bluetooth.Green.copy(alpha = .06f))
                .border(1.dp, YunQiaoUiTokens.Bluetooth.Green.copy(alpha = .18f), RoundedCornerShape(10.dp))
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            YunQiaoIcon(YunQiaoIconKind.LIGHTBULB, Modifier.size(24.dp), YunQiaoUiTokens.Bluetooth.Green)
            Spacer(Modifier.width(12.dp))
            Text(stringResource(R.string.bluetooth_test_hint), style = YunQiaoUiTokens.Meta, maxLines = 3)
        }
    }
}
