package com.yunqiao.life.merchantterminal.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yunqiao.life.merchantterminal.R

@Composable
internal fun AddPrinterTypeScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    ModalScrim(alpha = .56f) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val modalWidth = if (compact) maxWidth else 598.dp
            // Keep the locked 598×562 D2 outer frame. Only the option content area is adapted for the
            // mandatory third Classic Bluetooth card that the source PNG omits.
            val modalHeight = if (compact) maxHeight else 562.dp
            Column(
                Modifier
                    .align(Alignment.Center)
                    .width(modalWidth)
                    .height(modalHeight)
                    .clip(RoundedCornerShape(if (compact) 0.dp else 16.dp))
                    .background(Color.White)
                    .testTag("screen-04-connection-type")
                    .padding(horizontal = if (compact) 20.dp else 35.dp, vertical = if (compact) 20.dp else 26.dp)
                    .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (compact) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        IconTouchTarget(YunQiaoIconKind.BACK, actions.onBack, stringResource(R.string.common_back))
                        Spacer(Modifier.weight(1f))
                        IconTouchTarget(YunQiaoIconKind.CLOSE, actions.onClose, stringResource(R.string.common_close))
                    }
                }
                Text(stringResource(R.string.add_printer_step_one), style = YunQiaoUiTokens.Heading24)
                Spacer(Modifier.height(5.dp))
                Text(stringResource(R.string.choose_connection_type), style = YunQiaoUiTokens.Body)
                Spacer(Modifier.height(if (compact) 20.dp else 10.dp))
                ThreeStepIndicator(current = 1, accent = YunQiaoUiTokens.Type.Green)
                Spacer(Modifier.height(if (compact) 24.dp else 12.dp))
                TransportChoiceCard(
                    transport = PrinterTransportUi.USB,
                    title = stringResource(R.string.usb_printer),
                    description = stringResource(R.string.usb_printer_description),
                    selected = state.selectedTransport == PrinterTransportUi.USB,
                    onClick = { actions.onSelectTransport(PrinterTransportUi.USB) },
                    tag = "transport-usb",
                    compactHeight = !compact,
                )
                Spacer(Modifier.height(if (compact) 12.dp else 7.dp))
                TransportChoiceCard(
                    transport = PrinterTransportUi.LAN,
                    title = stringResource(R.string.lan_printer),
                    description = stringResource(R.string.lan_printer_description),
                    selected = state.selectedTransport == PrinterTransportUi.LAN,
                    onClick = { actions.onSelectTransport(PrinterTransportUi.LAN) },
                    tag = "transport-lan",
                    compactHeight = !compact,
                )
                Spacer(Modifier.height(if (compact) 12.dp else 7.dp))
                TransportChoiceCard(
                    transport = PrinterTransportUi.BLUETOOTH,
                    title = stringResource(R.string.bluetooth_printer),
                    description = stringResource(R.string.bluetooth_printer_description),
                    selected = state.selectedTransport == PrinterTransportUi.BLUETOOTH,
                    onClick = { actions.onSelectTransport(PrinterTransportUi.BLUETOOTH) },
                    tag = "transport-bluetooth-classic",
                    compactHeight = !compact,
                )
                Spacer(Modifier.weight(1f))
                HorizontalDivider(Modifier.fillMaxWidth(), YunQiaoUiTokens.Type.Divider)
                Spacer(Modifier.height(17.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    YunQiaoButton(
                        stringResource(R.string.common_cancel),
                        actions.onClose,
                        Modifier.width(120.dp),
                        style = YunQiaoButtonStyle.TEXT,
                        accent = YunQiaoUiTokens.Type.Green,
                    )
                    Spacer(Modifier.weight(1f))
                    YunQiaoButton(
                        stringResource(R.string.common_next),
                        actions.onContinueAdd,
                        Modifier.width(if (compact) 190.dp else 186.dp),
                        style = YunQiaoButtonStyle.PRIMARY,
                        accent = YunQiaoUiTokens.Type.Green,
                    )
                }
            }
        }
    }
}

@Composable
private fun ThreeStepIndicator(current: Int, accent: Color) {
    val labels = listOf(R.string.step_connection, R.string.step_choose_device, R.string.step_test_save)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        labels.forEachIndexed { index, label ->
            val step = index + 1
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(28.dp).clip(RoundedCornerShape(50)).background(
                        if (step <= current) accent else Color(0xFF9299A3),
                    ),
                    contentAlignment = Alignment.Center,
                ) {
                    if (step < current) {
                        YunQiaoIcon(YunQiaoIconKind.CHECK, Modifier.size(16.dp), Color.White)
                    } else {
                        Text(step.toString(), color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.width(7.dp))
                Text(
                    stringResource(label),
                    style = YunQiaoUiTokens.Meta.copy(
                        color = if (step == current) accent else YunQiaoUiTokens.Muted,
                        fontWeight = if (step == current) FontWeight.Bold else FontWeight.Normal,
                    ),
                    maxLines = 1,
                )
            }
            if (index < labels.lastIndex) {
                Spacer(Modifier.weight(1f))
                YunQiaoIcon(YunQiaoIconKind.CHEVRON_RIGHT, Modifier.size(16.dp), Color(0xFF939BA5))
                Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun TransportChoiceCard(
    transport: PrinterTransportUi,
    title: String,
    description: String,
    selected: Boolean,
    onClick: () -> Unit,
    tag: String,
    compactHeight: Boolean,
) {
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .height(if (compactHeight) 89.dp else 133.dp)
            .clip(shape)
            .background(if (selected) YunQiaoUiTokens.Type.Selected else Color.White)
            .border(if (selected) 2.dp else 1.dp, if (selected) YunQiaoUiTokens.Type.Green else YunQiaoUiTokens.Type.Border, shape)
            .semantics {
                role = Role.RadioButton
                this.selected = selected
            }
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .testTag(tag)
            .padding(horizontal = if (compactHeight) 18.dp else 28.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TransportIconTile(transport, Modifier.size(if (compactHeight) 62.dp else 82.dp), YunQiaoUiTokens.Type.Green, illustration = true)
        Spacer(Modifier.width(if (compactHeight) 18.dp else 27.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = YunQiaoUiTokens.ItemTitle)
            Spacer(Modifier.height(8.dp))
            Text(description, style = YunQiaoUiTokens.Body, maxLines = 2)
        }
        Spacer(Modifier.width(15.dp))
        Box(
            Modifier.size(30.dp).clip(RoundedCornerShape(50)).border(
                2.dp,
                if (selected) YunQiaoUiTokens.Type.Green else Color(0xFF9DA4AC),
                RoundedCornerShape(50),
            ).then(if (selected) Modifier.background(YunQiaoUiTokens.Type.Green) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) YunQiaoIcon(YunQiaoIconKind.CHECK, Modifier.size(17.dp), Color.White)
        }
    }
}

@Composable
internal fun LanDiscoveryScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    ModalScrim(alpha = .42f) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val modalWidth = if (compact) maxWidth else 807.dp
            val modalHeight = if (compact) maxHeight else 642.dp
            val d2 = !compact && maxWidth >= 1320.dp && maxHeight in 740.dp..790.dp
            Column(
                Modifier.then(
                    if (d2) Modifier.align(Alignment.TopStart).offset(279.dp, 82.dp)
                    else Modifier.align(Alignment.Center),
                )
                    .width(modalWidth)
                    .height(modalHeight)
                    .clip(RoundedCornerShape(if (compact) 0.dp else 13.dp))
                    .background(Color.White)
                    .testTag("screen-05-lan-discovery")
                    .padding(horizontal = if (compact) 20.dp else 32.dp, vertical = if (compact) 18.dp else 24.dp)
                    .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.add_lan_step_two),
                        style = if (compact) YunQiaoUiTokens.Heading22 else YunQiaoUiTokens.Heading24,
                        modifier = Modifier.weight(1f),
                    )
                    IconTouchTarget(YunQiaoIconKind.CLOSE, actions.onClose, stringResource(R.string.common_close), visualSize = 30.dp)
                }
                Spacer(Modifier.height(if (compact) 14.dp else 16.dp))
                ThreeStepLine(current = 2, accent = YunQiaoUiTokens.LanDiscovery.Green)
                Spacer(Modifier.height(if (compact) 18.dp else 28.dp))
                Row(
                    Modifier.fillMaxWidth().height(36.dp).clip(RoundedCornerShape(8.dp))
                        .background(YunQiaoUiTokens.LanDiscovery.Discovery)
                        .border(1.dp, YunQiaoUiTokens.LanDiscovery.Green.copy(alpha = .15f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    YunQiaoIcon(YunQiaoIconKind.WIFI, Modifier.size(19.dp), YunQiaoUiTokens.LanDiscovery.Green)
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.current_network, "192.168.1.x"), style = YunQiaoUiTokens.Body)
                }
                Spacer(Modifier.height(17.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.discovering_printers), style = YunQiaoUiTokens.Label.copy(fontSize = 17.sp), modifier = Modifier.weight(1f))
                    if (state.operation == PrinterOperationUi.DISCOVERING) {
                        YunQiaoIcon(YunQiaoIconKind.REFRESH, Modifier.size(18.dp), YunQiaoUiTokens.BodyColor)
                        Spacer(Modifier.width(7.dp))
                        Text(stringResource(R.string.searching), style = YunQiaoUiTokens.Body)
                    } else {
                        Row(
                            Modifier.clickable(onClick = actions.onRefresh).padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            YunQiaoIcon(YunQiaoIconKind.REFRESH, Modifier.size(18.dp), YunQiaoUiTokens.BodyColor)
                            Spacer(Modifier.width(7.dp))
                            Text(stringResource(R.string.search_again), style = YunQiaoUiTokens.Body)
                        }
                    }
                }
                Spacer(Modifier.height(9.dp))
                val operationBusy = state.operation in setOf(
                    PrinterOperationUi.DISCOVERING,
                    PrinterOperationUi.CONNECTING,
                    PrinterOperationUi.TESTING,
                    PrinterOperationUi.SYNCING,
                )
                when {
                    state.userMessage != null -> LanStateNotice(
                        state.userMessage,
                        if (state.operation == PrinterOperationUi.FAILURE ||
                            state.operation == PrinterOperationUi.UNCERTAIN
                        ) {
                            YunQiaoUiTokens.Danger
                        } else {
                            YunQiaoUiTokens.Warning
                        },
                        if (operationBusy || state.discoveredLanPrinters.isNotEmpty()) {
                            null
                        } else {
                            actions.onRetry
                        },
                    )
                    state.operation == PrinterOperationUi.FAILURE -> LanStateNotice(
                        stringResource(R.string.lan_search_failure),
                        YunQiaoUiTokens.Danger,
                        actions.onRetry,
                    )
                    state.discoveredLanPrinters.isEmpty() -> LanStateNotice(
                        stringResource(R.string.no_lan_printers),
                        YunQiaoUiTokens.Warning,
                        actions.onRefresh,
                    )
                    else -> state.discoveredLanPrinters.take(3).forEachIndexed { index, printer ->
                        if (index > 0) Spacer(Modifier.height(8.dp))
                        LanPrinterRow(printer, state.selectedLanIdentity == printer.identity) {
                            actions.onSelectLanPrinter(printer.identity)
                        }
                    }
                }
                Spacer(Modifier.height(11.dp))
                ManualLanArea(state, actions)
                Spacer(Modifier.weight(1f))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    YunQiaoButton(stringResource(R.string.common_previous), actions.onBack, Modifier.weight(1f), visualHeight = 48.dp)
                    YunQiaoButton(
                        stringResource(if (state.operation == PrinterOperationUi.DISCOVERING) R.string.searching else R.string.search_again),
                        actions.onRefresh,
                        Modifier.weight(1.06f),
                        icon = YunQiaoIconKind.REFRESH,
                        visualHeight = 48.dp,
                        enabled = !operationBusy,
                    )
                    YunQiaoButton(
                        stringResource(
                            when (state.operation) {
                                PrinterOperationUi.TESTING -> R.string.common_testing
                                PrinterOperationUi.SYNCING -> R.string.common_syncing
                                else -> R.string.common_next
                            },
                        ),
                        actions.onContinueAdd,
                        Modifier.weight(1.18f),
                        style = YunQiaoButtonStyle.PRIMARY,
                        accent = YunQiaoUiTokens.LanDiscovery.Green,
                        visualHeight = 48.dp,
                        enabled = !operationBusy &&
                            (state.selectedLanIdentity != null || state.manualLanHost.isNotBlank()),
                    )
                }
            }
        }
    }
}

@Composable
private fun ThreeStepLine(current: Int, accent: Color) {
    val labels = listOf(R.string.step_connection, R.string.step_choose_device, R.string.step_test_save)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        labels.forEachIndexed { index, label ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.size(28.dp).clip(RoundedCornerShape(50)).background(
                        if (index + 1 <= current) accent else Color.White,
                    ).border(1.dp, if (index + 1 <= current) accent else Color(0xFFC6CDD5), RoundedCornerShape(50)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (index + 1 < current) YunQiaoIcon(YunQiaoIconKind.CHECK, Modifier.size(15.dp), Color.White)
                    else Text((index + 1).toString(), color = if (index + 1 <= current) Color.White else YunQiaoUiTokens.Muted)
                }
                Spacer(Modifier.height(7.dp))
                Text(stringResource(label), style = YunQiaoUiTokens.Meta.copy(color = YunQiaoUiTokens.Ink), maxLines = 1)
            }
            if (index < 2) {
                Box(
                    Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 13.dp).height(1.dp).background(
                        if (index + 1 < current) accent else Color(0xFFD3DAE1),
                    ),
                )
            }
        }
    }
}

@Composable
private fun LanPrinterRow(
    printer: DiscoveredLanPrinterUi,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(9.dp)
    Row(
        Modifier.fillMaxWidth().height(70.dp).clip(shape)
            .background(if (selected) YunQiaoUiTokens.LanDiscovery.Discovery else Color.White)
            .border(if (selected) 2.dp else 1.dp, if (selected) YunQiaoUiTokens.LanDiscovery.Green else Color(0xFFDDE4E9), shape)
            .semantics { this.selected = selected; role = Role.RadioButton }
            .clickable(onClick = onClick)
            .padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)).background(YunQiaoUiTokens.LanDiscovery.Green.copy(alpha = .09f)),
            contentAlignment = Alignment.Center,
        ) { YunQiaoIcon(YunQiaoIconKind.PRINTER, Modifier.size(25.dp), YunQiaoUiTokens.Ink) }
        Spacer(Modifier.width(13.dp))
        Column(Modifier.weight(1f)) {
            Text(printer.name, style = YunQiaoUiTokens.Label.copy(fontSize = 17.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(printer.endpoint, style = YunQiaoUiTokens.Body, maxLines = 1)
        }
        StatusPill(stringResource(R.string.common_available), YunQiaoUiTokens.LanDiscovery.Green)
        Spacer(Modifier.width(24.dp))
        YunQiaoIcon(YunQiaoIconKind.CHEVRON_RIGHT, Modifier.size(18.dp), YunQiaoUiTokens.Ink)
    }
}

@Composable
private fun LanStateNotice(text: String, color: Color, action: (() -> Unit)?) {
    val interaction = if (action != null) Modifier.clickable(onClick = action) else Modifier
    Row(
        Modifier.fillMaxWidth().height(70.dp).clip(RoundedCornerShape(9.dp))
            .background(color.copy(alpha = .06f)).border(1.dp, color.copy(alpha = .25f), RoundedCornerShape(9.dp))
            .then(interaction).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        YunQiaoIcon(YunQiaoIconKind.INFO, Modifier.size(22.dp), color)
        Spacer(Modifier.width(12.dp))
        Text(text, style = YunQiaoUiTokens.Body, modifier = Modifier.weight(1f), maxLines = 2)
        if (action != null) {
            Text(stringResource(R.string.common_retry_action), style = YunQiaoUiTokens.Label, color = color)
        }
    }
}

@Composable
private fun ManualLanArea(state: PrinterDevicesUiState, actions: PrinterDevicesActions) {
    if (state.manualLanEntryVisible) {
        var host by remember(state.manualLanHost) { mutableStateOf(state.manualLanHost) }
        var port by remember(state.manualLanPort) { mutableStateOf(state.manualLanPort.toString()) }
        Row(
            Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(9.dp))
                .background(YunQiaoUiTokens.LanDiscovery.Discovery).padding(7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CompactTextField(host, { host = it }, stringResource(R.string.host_address), Modifier.weight(1f))
            CompactTextField(port, { port = it.filter(Char::isDigit).take(5) }, stringResource(R.string.port_number), Modifier.width(95.dp))
            YunQiaoButton(
                stringResource(R.string.manual_ip_submit),
                { actions.onManualLanAddressChanged(host.trim(), port.toIntOrNull() ?: 9100) },
                Modifier.width(145.dp),
                style = YunQiaoButtonStyle.OUTLINE,
                accent = YunQiaoUiTokens.LanDiscovery.Green,
            )
        }
    } else {
        Row(
            Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(9.dp))
                .background(YunQiaoUiTokens.LanDiscovery.Discovery)
                .border(1.dp, YunQiaoUiTokens.LanDiscovery.Green.copy(alpha = .15f), RoundedCornerShape(9.dp))
                .padding(horizontal = 15.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            YunQiaoIcon(YunQiaoIconKind.LIGHTBULB, Modifier.size(22.dp), YunQiaoUiTokens.LanDiscovery.Green)
            Spacer(Modifier.width(12.dp))
            Text(stringResource(R.string.manual_ip_hint), style = YunQiaoUiTokens.Body, modifier = Modifier.weight(1f), maxLines = 2)
            YunQiaoButton(
                stringResource(R.string.manual_ip),
                actions.onManualLanAddress,
                Modifier.width(125.dp),
                accent = YunQiaoUiTokens.LanDiscovery.Green,
                visualHeight = 42.dp,
            )
        }
    }
}

@Composable
private fun CompactTextField(
    value: String,
    onValueChange: (String) -> Unit,
    hint: String,
    modifier: Modifier,
) {
    Box(
        modifier.height(42.dp).clip(RoundedCornerShape(7.dp)).background(Color.White)
            .border(1.dp, Color(0xFFD8E0E5), RoundedCornerShape(7.dp)).padding(horizontal = 10.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (value.isBlank()) Text(hint, style = YunQiaoUiTokens.Meta)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            textStyle = YunQiaoUiTokens.Body.copy(color = YunQiaoUiTokens.Ink),
            cursorBrush = SolidColor(YunQiaoUiTokens.LanDiscovery.Green),
            singleLine = true,
        )
    }
}

@Composable
internal fun LanSuccessScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    val printer = state.selectedPrinter ?: state.printers.firstOrNull()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = if (compact) maxWidth else 1025.dp
        val height = if (compact) maxHeight else 632.dp
        val d2 = !compact && maxWidth >= 1320.dp && maxHeight in 740.dp..790.dp
        Column(
            Modifier.then(
                if (d2) Modifier.align(Alignment.TopStart).offset(268.dp, 117.dp)
                else Modifier.align(Alignment.Center),
            )
                .width(width).height(height)
                .clip(RoundedCornerShape(if (compact) 0.dp else 14.dp))
                .background(Color.White)
                .testTag("screen-06-lan-success")
                .padding(horizontal = if (compact) 20.dp else 53.dp, vertical = if (compact) 18.dp else 20.dp)
                .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconTouchTarget(YunQiaoIconKind.BACK, actions.onBack, stringResource(R.string.common_back))
                Spacer(Modifier.width(15.dp))
                Text(stringResource(R.string.add_lan_step_three), style = YunQiaoUiTokens.Heading20)
            }
            Spacer(Modifier.height(10.dp))
            ThreeStepLine(current = 3, accent = YunQiaoUiTokens.LanSuccess.Green)
            Spacer(Modifier.height(20.dp))
            PrinterSuccessSummary(printer)
            Spacer(Modifier.height(12.dp))
            OperationResultCard(state.operation)
            Spacer(Modifier.height(10.dp))
            PrinterFactTable(printer, state)
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                YunQiaoIcon(YunQiaoIconKind.INFO, Modifier.size(20.dp), YunQiaoUiTokens.Muted)
                Spacer(Modifier.width(10.dp))
                Text(stringResource(R.string.automatic_rules_admin), style = YunQiaoUiTokens.Meta, modifier = Modifier.weight(1f))
                YunQiaoButton(stringResource(R.string.continue_adding), actions.onAddAnother, Modifier.width(145.dp))
                Spacer(Modifier.width(15.dp))
                YunQiaoButton(
                    stringResource(if (state.operation == PrinterOperationUi.SYNCING) R.string.common_syncing else R.string.common_finish),
                    actions.onFinish,
                    Modifier.width(144.dp),
                    style = YunQiaoButtonStyle.PRIMARY,
                    accent = YunQiaoUiTokens.LanSuccess.Green,
                    enabled = state.operation != PrinterOperationUi.SYNCING,
                )
            }
        }
    }
}

@Composable
private fun PrinterSuccessSummary(printer: PrinterSummaryUi?) {
    ReferenceCard(
        Modifier.fillMaxWidth().height(102.dp), radius = 10.dp,
        borderColor = YunQiaoUiTokens.LanSuccess.Border, shadow = 2.dp,
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
            ThermalPrinterIllustration(Modifier.size(70.dp))
            Spacer(Modifier.width(18.dp))
            Column(Modifier.weight(1f)) {
                Text(printer?.name ?: stringResource(R.string.lan_printer), style = YunQiaoUiTokens.ItemTitle)
                Spacer(Modifier.height(7.dp))
                Text(
                    listOfNotNull(stringResource(R.string.lan_printer), printer?.endpoint, stringResource(R.string.paper_width_value, printer?.paperWidthMm ?: 80)).joinToString(" · "),
                    style = YunQiaoUiTokens.Body,
                )
            }
            StatusPill(stringResource(R.string.status_connected), YunQiaoUiTokens.LanSuccess.Green, dot = true)
        }
    }
}

@Composable
private fun OperationResultCard(operation: PrinterOperationUi) {
    val (title, body, color, icon) = when (operation) {
        PrinterOperationUi.FAILURE -> arrayOf(R.string.test_failure_title, R.string.test_failure_body, 1, 0)
        PrinterOperationUi.UNCERTAIN -> arrayOf(R.string.test_uncertain_title, R.string.test_uncertain_body, 2, 0)
        PrinterOperationUi.SYNCING -> arrayOf(R.string.common_syncing, R.string.sync_failure_body, 0, 1)
        else -> arrayOf(R.string.printer_added_success, R.string.printer_added_success_body, 0, 1)
    }
    val accent = when (color) {
        1 -> YunQiaoUiTokens.Danger
        2 -> YunQiaoUiTokens.Warning
        else -> YunQiaoUiTokens.LanSuccess.SuccessIcon
    }
    ReferenceCard(
        Modifier.fillMaxWidth().height(90.dp), radius = 10.dp,
        backgroundColor = accent.copy(alpha = .10f), borderColor = accent.copy(alpha = .35f), shadow = 0.dp,
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(47.dp).clip(RoundedCornerShape(50)).background(accent), contentAlignment = Alignment.Center) {
                YunQiaoIcon(if (icon == 1) YunQiaoIconKind.CHECK else YunQiaoIconKind.INFO, Modifier.size(27.dp), Color.White, 2.5f)
            }
            Spacer(Modifier.width(22.dp))
            Column {
                Text(stringResource(title), style = YunQiaoUiTokens.Label.copy(fontSize = 18.sp))
                Spacer(Modifier.height(5.dp))
                Text(stringResource(body), style = YunQiaoUiTokens.Body, maxLines = 2)
            }
        }
    }
}

@Composable
private fun PrinterFactTable(printer: PrinterSummaryUi?, state: PrinterDevicesUiState) {
    val rows = listOf(
        Triple(YunQiaoIconKind.PRINTER, R.string.printer_name, printer?.name ?: stringResource(R.string.lan_printer)),
        Triple(YunQiaoIconKind.PAPER, R.string.paper_width, stringResource(R.string.paper_width_value, printer?.paperWidthMm ?: 80)),
        Triple(YunQiaoIconKind.LAN, R.string.connection_type, stringResource(R.string.lan_printer)),
        Triple(YunQiaoIconKind.CHECK, R.string.local_test, stringResource(if (state.operation == PrinterOperationUi.TESTING) R.string.common_testing else R.string.test_passed)),
        Triple(
            YunQiaoIconKind.SYNC,
            R.string.platform_sync,
            stringResource(
                when {
                    state.operation == PrinterOperationUi.SYNCING -> R.string.common_syncing
                    printer?.platformSynced == true -> R.string.sync_complete
                    state.operation == PrinterOperationUi.FAILURE -> R.string.sync_failure_title
                    else -> R.string.sync_waiting
                },
            ),
        ),
    )
    ReferenceCard(
        Modifier.fillMaxWidth().height(202.dp), radius = 10.dp,
        borderColor = YunQiaoUiTokens.LanSuccess.Border, shadow = 1.dp,
    ) {
        Column(Modifier.fillMaxSize()) {
            rows.forEachIndexed { index, row ->
                Row(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 27.dp), verticalAlignment = Alignment.CenterVertically) {
                    YunQiaoIcon(row.first, Modifier.size(20.dp), YunQiaoUiTokens.BodyColor)
                    Spacer(Modifier.width(20.dp))
                    Text(stringResource(row.second), style = YunQiaoUiTokens.Label, modifier = Modifier.weight(.75f))
                    Text(
                        row.third,
                        style = YunQiaoUiTokens.Body,
                        color = if (index >= 3) YunQiaoUiTokens.LanSuccess.Green else YunQiaoUiTokens.BodyColor,
                        modifier = Modifier.weight(1.3f),
                    )
                }
                if (index < rows.lastIndex) HorizontalDivider(Modifier.fillMaxWidth())
            }
        }
    }
}
