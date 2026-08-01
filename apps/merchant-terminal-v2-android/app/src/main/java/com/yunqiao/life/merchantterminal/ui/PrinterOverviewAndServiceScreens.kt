package com.yunqiao.life.merchantterminal.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yunqiao.life.merchantterminal.R

@Composable
internal fun PrinterDevicesOverviewScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val panelWidth = if (compact) maxWidth else if (maxWidth >= 1320.dp) 1165.dp else maxWidth * .855f
        val panelHeight = if (compact) maxHeight else if (maxHeight in 740.dp..790.dp) 665.dp else maxHeight * .87f
        Column(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .width(panelWidth)
                .height(panelHeight)
                .background(YunQiaoUiTokens.Overview.Page)
                .padding(horizontal = if (compact) 20.dp else 26.dp, vertical = if (compact) 18.dp else 20.dp)
                .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
        ) {
            PageTitle(
                title = stringResource(R.string.printer_devices_title),
                subtitle = stringResource(R.string.printer_devices_subtitle),
                onBack = actions.onBack,
                headingStyle = if (compact) YunQiaoUiTokens.Heading24 else YunQiaoUiTokens.Heading02,
                framedBack = true,
            )
            Spacer(Modifier.height(if (compact) 18.dp else 8.dp))
            LocalServiceSummaryCard(state, actions, compact)
            Spacer(Modifier.height(if (compact) 19.dp else 21.dp))
            Row(
                modifier = Modifier.fillMaxWidth().height(if (compact) 64.dp else 56.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    stringResource(R.string.added_printers),
                    style = YunQiaoUiTokens.Heading24.copy(fontSize = if (compact) 20.sp else 22.sp),
                )
                YunQiaoButton(
                    text = stringResource(R.string.add_printer),
                    onClick = actions.onAddPrinter,
                    modifier = Modifier.width(if (compact) 150.dp else 179.dp),
                    style = YunQiaoButtonStyle.OUTLINE,
                    accent = YunQiaoUiTokens.Overview.Green,
                    icon = YunQiaoIconKind.PLUS,
                    visualHeight = 49.dp,
                )
            }
            if (state.printers.isEmpty()) {
                EmptyPrinterCard(actions, state.operation, compact)
            } else {
                state.printers.take(if (compact) state.printers.size else 3).forEachIndexed { index, printer ->
                    if (index > 0) Spacer(Modifier.height(8.dp))
                    PrinterOverviewRow(printer, state.operation, actions, compact)
                }
            }
        }
    }
}

@Composable
private fun PageTitle(
    title: String,
    subtitle: String,
    onBack: () -> Unit,
    headingStyle: androidx.compose.ui.text.TextStyle,
    framedBack: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth().height(72.dp),
        verticalAlignment = Alignment.Top,
    ) {
        IconTouchTarget(
            YunQiaoIconKind.BACK,
            onBack,
            stringResource(R.string.common_back),
            framed = framedBack,
            visualSize = if (framedBack) 36.dp else 30.dp,
        )
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = headingStyle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = YunQiaoUiTokens.Body, maxLines = 2)
        }
    }
}

@Composable
private fun LocalServiceSummaryCard(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    ReferenceCard(
        modifier = Modifier.fillMaxWidth().height(if (compact) 128.dp else 109.dp),
        radius = 10.dp,
        borderColor = YunQiaoUiTokens.Overview.Border,
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = if (compact) 16.dp else 25.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(if (compact) 60.dp else 68.dp)
                    .clip(RoundedCornerShape(50))
                    .background(YunQiaoUiTokens.Overview.Mint),
                contentAlignment = Alignment.Center,
            ) {
                YunQiaoIcon(YunQiaoIconKind.PRINTER, Modifier.size(37.dp), YunQiaoUiTokens.Overview.Green, 2.3f)
            }
            Spacer(Modifier.width(if (compact) 14.dp else 25.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.local_print_service), style = YunQiaoUiTokens.ItemTitle)
                    Spacer(Modifier.width(13.dp))
                    val status = when {
                        state.serviceRunning -> R.string.service_running
                        state.operation == PrinterOperationUi.RECOVERING || state.operation == PrinterOperationUi.CONNECTING -> R.string.simple_service_connecting
                        else -> R.string.simple_service_error
                    }
                    StatusPill(
                        text = stringResource(status),
                        color = if (state.serviceRunning) YunQiaoUiTokens.Overview.Green else YunQiaoUiTokens.Warning,
                    )
                }
                Spacer(Modifier.height(7.dp))
                Text(
                    stringResource(if (state.serviceRunning) R.string.simple_service_running_body else R.string.simple_service_error_body),
                    style = YunQiaoUiTokens.Body,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!state.serviceRunning && state.operation != PrinterOperationUi.CONNECTING && state.operation != PrinterOperationUi.RECOVERING) {
                Spacer(Modifier.width(18.dp))
                YunQiaoButton(
                    text = stringResource(R.string.simple_reconnect_service),
                    onClick = actions.onRetry,
                    modifier = Modifier.width(140.dp),
                    visualHeight = 44.dp,
                    icon = YunQiaoIconKind.REFRESH,
                    accent = YunQiaoUiTokens.BodyColor,
                )
            }
        }
    }
}

@Composable
private fun EmptyPrinterCard(
    actions: PrinterDevicesActions,
    operation: PrinterOperationUi,
    compact: Boolean,
) {
    val isRecovery = operation == PrinterOperationUi.RECOVERING || operation == PrinterOperationUi.FAILURE
    ReferenceCard(
        modifier = Modifier.fillMaxWidth().height(if (compact) 176.dp else 168.dp),
        radius = 10.dp,
        borderColor = YunQiaoUiTokens.Overview.Border,
        shadow = 2.dp,
    ) {
        Column(
            Modifier.fillMaxSize().padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            TransportIconTile(PrinterTransportUi.LAN, Modifier.size(68.dp))
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.no_printers_title), style = YunQiaoUiTokens.ItemTitle)
            Spacer(Modifier.height(6.dp))
            Text(
                stringResource(if (isRecovery) R.string.overview_recovery_body else R.string.no_printers_body),
                style = YunQiaoUiTokens.Body,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun PrinterOverviewRow(
    printer: PrinterSummaryUi,
    operation: PrinterOperationUi,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    val statusText = when (printer.physicalState) {
        PrinterPhysicalStateUi.CONNECTED -> R.string.status_connected
        PrinterPhysicalStateUi.PAIRED -> R.string.status_paired
        PrinterPhysicalStateUi.CONFIGURED -> R.string.status_configured
        PrinterPhysicalStateUi.OFFLINE -> R.string.status_offline
        PrinterPhysicalStateUi.ERROR -> R.string.status_error
        PrinterPhysicalStateUi.UNKNOWN -> R.string.status_unknown
    }
    val statusColor = when (printer.physicalState) {
        PrinterPhysicalStateUi.CONNECTED, PrinterPhysicalStateUi.PAIRED, PrinterPhysicalStateUi.CONFIGURED -> YunQiaoUiTokens.Overview.Green
        PrinterPhysicalStateUi.OFFLINE, PrinterPhysicalStateUi.UNKNOWN -> YunQiaoUiTokens.Warning
        PrinterPhysicalStateUi.ERROR -> YunQiaoUiTokens.Danger
    }
    ReferenceCard(
        modifier = Modifier.fillMaxWidth().height(if (compact) 150.dp else 105.dp),
        radius = 10.dp,
        borderColor = YunQiaoUiTokens.Overview.Border,
        shadow = 2.dp,
    ) {
        if (compact) {
            Column(Modifier.fillMaxSize().padding(14.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    PrinterIdentity(printer, Modifier.weight(1f))
                    StatusPill(stringResource(statusText), statusColor)
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    YunQiaoButton(
                        stringResource(R.string.common_test),
                        { actions.onTestPrinter(printer.id) },
                        Modifier.weight(1f),
                        accent = YunQiaoUiTokens.Overview.Green,
                        icon = YunQiaoIconKind.PRINTER,
                        enabled = operation != PrinterOperationUi.TESTING,
                    )
                    YunQiaoButton(
                        stringResource(R.string.common_manage),
                        { actions.onManagePrinter(printer.id) },
                        Modifier.weight(1f),
                        icon = YunQiaoIconKind.SETTINGS,
                        accent = YunQiaoUiTokens.BodyColor,
                    )
                }
            }
        } else {
            Row(
                Modifier.fillMaxSize().padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PrinterIdentity(printer, Modifier.weight(1f))
                StatusPill(stringResource(statusText), statusColor, Modifier.width(112.dp))
                Spacer(Modifier.width(184.dp))
                YunQiaoButton(
                    stringResource(if (operation == PrinterOperationUi.TESTING) R.string.common_testing else R.string.common_test),
                    { actions.onTestPrinter(printer.id) },
                    Modifier.width(145.dp),
                    accent = YunQiaoUiTokens.Overview.Green,
                    icon = YunQiaoIconKind.PRINTER,
                    visualHeight = 44.dp,
                    enabled = operation != PrinterOperationUi.TESTING,
                )
                Spacer(Modifier.width(23.dp))
                YunQiaoButton(
                    stringResource(R.string.common_manage),
                    { actions.onManagePrinter(printer.id) },
                    Modifier.width(152.dp),
                    icon = YunQiaoIconKind.SETTINGS,
                    accent = YunQiaoUiTokens.BodyColor,
                    visualHeight = 44.dp,
                )
            }
        }
    }
}

@Composable
private fun PrinterIdentity(printer: PrinterSummaryUi, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        TransportIconTile(printer.transport, Modifier.size(67.dp))
        Spacer(Modifier.width(27.dp))
        Column {
            Text(printer.name, style = YunQiaoUiTokens.ItemTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(5.dp))
            val connection = when (printer.transport) {
                PrinterTransportUi.LAN -> stringResource(R.string.lan_printer)
                PrinterTransportUi.USB -> "USB"
                PrinterTransportUi.BLUETOOTH -> stringResource(R.string.bluetooth_printer)
            }
            Text(
                listOfNotNull(connection, printer.endpoint, stringResource(R.string.paper_width_value, printer.paperWidthMm)).joinToString(" · "),
                style = YunQiaoUiTokens.Body,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
internal fun LocalPrintServiceScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val panelWidth = if (compact) maxWidth else if (maxWidth >= 1320.dp) 1172.dp else maxWidth * .86f
        val panelHeight = if (compact) maxHeight else if (maxHeight in 740.dp..790.dp) 669.dp else maxHeight * .875f
        Column(
            Modifier.align(Alignment.BottomEnd)
                .width(panelWidth)
                .height(panelHeight)
                .background(YunQiaoUiTokens.Service.Page)
                .padding(horizontal = if (compact) 20.dp else 22.dp, vertical = 20.dp)
                .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
        ) {
            PageTitle(
                title = stringResource(R.string.local_print_service),
                subtitle = stringResource(R.string.service_page_subtitle),
                onBack = actions.onBack,
                headingStyle = if (compact) YunQiaoUiTokens.Heading24 else YunQiaoUiTokens.Heading03,
                framedBack = false,
            )
            Spacer(Modifier.height(if (compact) 21.dp else 7.dp))
            ServiceHero(state)
            Spacer(Modifier.height(if (compact) 16.dp else 15.dp))
            ServiceMatrix(state, compact)
            Spacer(Modifier.height(if (compact) 20.dp else 23.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                YunQiaoButton(
                    text = stringResource(
                        if (state.operation == PrinterOperationUi.RECOVERING) R.string.common_recovering else R.string.refresh_service_status,
                    ),
                    onClick = if (state.operation == PrinterOperationUi.FAILURE) actions.onRetry else actions.onRefresh,
                    modifier = Modifier.width(if (compact) 0.dp else 248.dp).then(if (compact) Modifier.weight(1f) else Modifier),
                    style = YunQiaoButtonStyle.PRIMARY,
                    accent = YunQiaoUiTokens.Service.Green,
                    icon = YunQiaoIconKind.REFRESH,
                )
                YunQiaoButton(
                    text = stringResource(R.string.back_to_printers),
                    onClick = actions.onBack,
                    modifier = Modifier.width(if (compact) 0.dp else 227.dp).then(if (compact) Modifier.weight(1f) else Modifier),
                    icon = YunQiaoIconKind.BACK,
                    accent = YunQiaoUiTokens.BodyColor,
                )
            }
            Spacer(Modifier.height(if (compact) 20.dp else 18.dp))
            ReferenceCard(
                Modifier.fillMaxWidth().height(if (compact) 90.dp else 69.dp),
                radius = 9.dp,
                backgroundColor = YunQiaoUiTokens.Service.Info,
                borderColor = YunQiaoUiTokens.Service.InfoBorder,
                shadow = 0.dp,
            ) {
                Row(Modifier.fillMaxSize().padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    YunQiaoIcon(YunQiaoIconKind.INFO, Modifier.size(25.dp), YunQiaoUiTokens.Information)
                    Spacer(Modifier.width(17.dp))
                    Text(stringResource(R.string.service_info), style = YunQiaoUiTokens.Body, maxLines = 3)
                }
            }
        }
    }
}

@Composable
private fun ServiceHero(state: PrinterDevicesUiState) {
    val healthy = state.serviceRunning && state.terminalAuthenticated && state.operation != PrinterOperationUi.FAILURE
    ReferenceCard(
        Modifier.fillMaxWidth().height(109.dp),
        radius = 10.dp,
        borderColor = if (healthy) YunQiaoUiTokens.Service.SuccessBorder else YunQiaoUiTokens.Danger.copy(alpha = .35f),
        shadow = 0.dp,
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 31.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(77.dp).clip(RoundedCornerShape(50)).background(
                    if (healthy) YunQiaoUiTokens.Service.Green.copy(alpha = .10f) else YunQiaoUiTokens.Danger.copy(alpha = .08f),
                ),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(38.dp).clip(RoundedCornerShape(50)).background(
                        if (healthy) YunQiaoUiTokens.Service.Green else YunQiaoUiTokens.Danger,
                    ),
                    contentAlignment = Alignment.Center,
                ) {
                    YunQiaoIcon(
                        if (healthy) YunQiaoIconKind.CHECK else YunQiaoIconKind.CLOSE,
                        Modifier.size(22.dp),
                        Color.White,
                        2.5f,
                    )
                }
            }
            Spacer(Modifier.width(26.dp))
            Column {
                Text(
                    stringResource(if (healthy) R.string.service_running else R.string.service_unavailable),
                    style = YunQiaoUiTokens.Heading24,
                    color = if (healthy) YunQiaoUiTokens.Service.Green else YunQiaoUiTokens.Danger,
                )
                Spacer(Modifier.height(5.dp))
                Text(
                    stringResource(if (healthy) R.string.service_running_body else R.string.service_failure_body),
                    style = YunQiaoUiTokens.Body,
                    maxLines = 2,
                )
            }
        }
    }
}

@Composable
private fun ServiceMatrix(state: PrinterDevicesUiState, compact: Boolean) {
    val rows = listOf(
        Triple(YunQiaoIconKind.SERVER, R.string.service_status, if (state.serviceRunning) R.string.service_running else R.string.service_unavailable),
        Triple(YunQiaoIconKind.SHIELD, R.string.platform_authentication, if (state.terminalAuthenticated) R.string.state_configured else R.string.state_waiting),
        Triple(YunQiaoIconKind.USER, R.string.merchant_session, if (state.terminalAuthenticated) R.string.state_logged_in else R.string.state_waiting),
        Triple(YunQiaoIconKind.PRINTER, R.string.automatic_printing, R.string.automatic_rules_admin),
        Triple(YunQiaoIconKind.USB, R.string.usb_print_support, if (state.usbSupported) R.string.state_available else R.string.service_unavailable),
        Triple(YunQiaoIconKind.LAN, R.string.lan_print_support, if (state.lanSupported) R.string.state_available else R.string.service_unavailable),
        Triple(YunQiaoIconKind.BLUETOOTH, R.string.bluetooth_print_support, if (state.bluetoothSupported) R.string.state_available else R.string.service_unavailable),
        Triple(YunQiaoIconKind.CLOCK, R.string.last_status_update, R.string.state_just_now),
    )
    ReferenceCard(
        Modifier.fillMaxWidth().height(if (compact) 450.dp else 262.dp),
        radius = 10.dp,
        borderColor = YunQiaoUiTokens.Service.Border,
        shadow = 2.dp,
    ) {
        if (compact) {
            Column(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                rows.forEachIndexed { index, row ->
                    ServiceMatrixCell(row, Modifier.weight(1f))
                    if (index != rows.lastIndex) HorizontalDivider(Modifier.fillMaxWidth())
                }
            }
        } else {
            Row(Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    listOf(rows[0], rows[2], rows[4], rows[6]).forEachIndexed { index, row ->
                        ServiceMatrixCell(row, Modifier.weight(1f))
                        if (index < 3) HorizontalDivider(Modifier.fillMaxWidth())
                    }
                }
                Box(Modifier.width(1.dp).fillMaxHeight().padding(vertical = 22.dp).background(YunQiaoUiTokens.Service.Border))
                Column(Modifier.weight(1f).fillMaxHeight().padding(start = 35.dp)) {
                    listOf(rows[1], rows[3], rows[5], rows[7]).forEachIndexed { index, row ->
                        ServiceMatrixCell(row, Modifier.weight(1f))
                        if (index < 3) HorizontalDivider(Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
}

@Composable
private fun ServiceMatrixCell(
    row: Triple<YunQiaoIconKind, Int, Int>,
    modifier: Modifier,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        YunQiaoIcon(row.first, Modifier.size(22.dp), YunQiaoUiTokens.Service.Green)
        Spacer(Modifier.width(24.dp))
        Text(stringResource(row.second), style = YunQiaoUiTokens.Body.copy(color = YunQiaoUiTokens.Ink), modifier = Modifier.weight(1f))
        Text(
            stringResource(row.third),
            style = YunQiaoUiTokens.Label,
            color = YunQiaoUiTokens.Service.Green,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
