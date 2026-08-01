package com.yunqiao.life.merchantterminal.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yunqiao.life.merchantterminal.R

@Composable
internal fun PrinterDetailScreen(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    val printer = state.selectedPrinter ?: state.printers.firstOrNull()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val panelWidth = if (compact) maxWidth else if (maxWidth >= 1320.dp) 1170.dp else maxWidth * .857f
        val panelHeight = if (compact) maxHeight else if (maxHeight in 740.dp..790.dp) 666.dp else maxHeight * .87f
        Column(
            Modifier.align(Alignment.BottomEnd)
                .width(panelWidth).height(panelHeight)
                .background(YunQiaoUiTokens.Detail.Page)
                .testTag("screen-09-printer-detail")
                .padding(
                    start = if (compact) 20.dp else 34.dp,
                    end = if (compact) 20.dp else 27.dp,
                    top = 18.dp,
                    bottom = 18.dp,
                )
                .then(if (compact) Modifier.verticalScroll(rememberScrollState()) else Modifier),
        ) {
            Row(Modifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically) {
                IconTouchTarget(
                    YunQiaoIconKind.BACK,
                    actions.onBack,
                    stringResource(R.string.common_back),
                    visualSize = 32.dp,
                    framed = false,
                )
                Spacer(Modifier.width(14.dp))
                Text(stringResource(R.string.printer_detail), style = YunQiaoUiTokens.Heading24)
            }
            PrinterDetailHero(printer, state.operation)
            Spacer(Modifier.height(if (compact) 17.dp else 16.dp))
            PrinterDetailCard(printer, state, actions, compact)
        }
    }
}

@Composable
private fun PrinterDetailHero(printer: PrinterSummaryUi?, operation: PrinterOperationUi) {
    val physical = printer?.physicalState ?: PrinterPhysicalStateUi.UNKNOWN
    val statusRes = when {
        operation == PrinterOperationUi.ARCHIVED -> R.string.status_archived
        physical == PrinterPhysicalStateUi.CONNECTED -> R.string.status_connected
        physical == PrinterPhysicalStateUi.PAIRED -> R.string.status_paired
        physical == PrinterPhysicalStateUi.CONFIGURED -> R.string.status_configured
        physical == PrinterPhysicalStateUi.OFFLINE -> R.string.status_offline
        physical == PrinterPhysicalStateUi.ERROR -> R.string.status_error
        else -> R.string.status_unknown
    }
    val accent = when (physical) {
        PrinterPhysicalStateUi.CONNECTED, PrinterPhysicalStateUi.PAIRED, PrinterPhysicalStateUi.CONFIGURED -> YunQiaoUiTokens.Detail.Green
        PrinterPhysicalStateUi.ERROR -> YunQiaoUiTokens.Danger
        else -> YunQiaoUiTokens.Warning
    }
    ReferenceCard(
        Modifier.fillMaxWidth().height(170.dp), radius = 12.dp,
        borderColor = YunQiaoUiTokens.Detail.Border, shadow = 4.dp,
    ) {
        Row(Modifier.fillMaxSize().padding(horizontal = 44.dp), verticalAlignment = Alignment.CenterVertically) {
            ThermalPrinterIllustration(Modifier.size(108.dp))
            Spacer(Modifier.width(45.dp))
            Column(Modifier.weight(1f)) {
                Text(printer?.name ?: stringResource(R.string.lan_printer), style = YunQiaoUiTokens.Heading24)
                Spacer(Modifier.height(12.dp))
                val transport = when (printer?.transport ?: PrinterTransportUi.LAN) {
                    PrinterTransportUi.LAN -> stringResource(R.string.lan_printer)
                    PrinterTransportUi.USB -> "USB"
                    PrinterTransportUi.BLUETOOTH -> stringResource(R.string.bluetooth_printer)
                }
                Text(
                    listOfNotNull(transport, printer?.endpoint, stringResource(R.string.paper_width_value, printer?.paperWidthMm ?: 80)).joinToString(" · "),
                    style = YunQiaoUiTokens.Body,
                )
                Spacer(Modifier.height(14.dp))
                StatusPill(stringResource(statusRes), accent)
            }
        }
    }
}

@Composable
private fun PrinterDetailCard(
    printer: PrinterSummaryUi?,
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    ReferenceCard(
        Modifier.fillMaxWidth().height(if (compact) 560.dp else 379.dp),
        radius = 12.dp,
        borderColor = YunQiaoUiTokens.Detail.Border,
        shadow = 3.dp,
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 26.dp, vertical = 22.dp)) {
            if (compact) {
                DetailFactsSingleColumn(printer)
                Spacer(Modifier.height(16.dp))
                ReadOnlyBusinessFacts(printer)
            } else {
                Row(Modifier.fillMaxWidth().height(178.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(17.dp)) {
                        DetailFact(stringResource(R.string.printer_name), printer?.name.orEmpty())
                        DetailFact(stringResource(R.string.connection_type), transportLabel(printer?.transport))
                        DetailFact(stringResource(R.string.ip_port), printer?.endpoint ?: "—")
                        DetailFact(stringResource(R.string.paper_width), stringResource(R.string.paper_width_value, printer?.paperWidthMm ?: 80))
                    }
                    Spacer(Modifier.width(55.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(17.dp)) {
                        DetailFact(stringResource(R.string.last_successful_connection), printer?.lastConnectedAt ?: "—")
                        DetailFact(stringResource(R.string.last_test_print), printer?.lastTestedAt ?: "—")
                        ReadOnlyEnabledRow(printer?.businessEnabled == true)
                        DetailFact(stringResource(R.string.automatic_printing), stringResource(R.string.automatic_rules_admin))
                    }
                }
            }
            ReadOnlyInformationStrip()
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 25.dp)) {
                YunQiaoButton(
                    text = stringResource(
                        if (state.operation == PrinterOperationUi.TESTING) R.string.common_testing else R.string.common_test,
                    ),
                    onClick = { actions.onTestPrinter(printer?.id) },
                    modifier = Modifier.weight(1f),
                    icon = YunQiaoIconKind.PRINTER,
                    accent = YunQiaoUiTokens.BodyColor,
                    visualHeight = 54.dp,
                    enabled = printer != null && state.operation != PrinterOperationUi.TESTING,
                )
                YunQiaoButton(
                    stringResource(R.string.edit_name),
                    actions.onRequestEditName,
                    Modifier.weight(1f).testTag("edit-name-action"),
                    icon = YunQiaoIconKind.EDIT,
                    accent = YunQiaoUiTokens.BodyColor,
                    visualHeight = 54.dp,
                )
                YunQiaoButton(
                    stringResource(R.string.archive_printer),
                    actions.onRequestArchive,
                    Modifier.weight(1f).testTag("archive-printer-action"),
                    style = YunQiaoButtonStyle.DANGER,
                    icon = YunQiaoIconKind.DELETE,
                    visualHeight = 54.dp,
                )
            }
        }
    }
}

@Composable
private fun DetailFactsSingleColumn(printer: PrinterSummaryUi?) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        DetailFact(stringResource(R.string.printer_name), printer?.name.orEmpty())
        DetailFact(stringResource(R.string.connection_type), transportLabel(printer?.transport))
        DetailFact(stringResource(R.string.ip_port), printer?.endpoint ?: "—")
        DetailFact(stringResource(R.string.paper_width), stringResource(R.string.paper_width_value, printer?.paperWidthMm ?: 80))
        DetailFact(stringResource(R.string.last_successful_connection), printer?.lastConnectedAt ?: "—")
        DetailFact(stringResource(R.string.last_test_print), printer?.lastTestedAt ?: "—")
    }
}

@Composable
private fun ReadOnlyBusinessFacts(printer: PrinterSummaryUi?) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ReadOnlyEnabledRow(printer?.businessEnabled == true)
        DetailFact(stringResource(R.string.automatic_printing), stringResource(R.string.automatic_rules_admin))
    }
}

@Composable
private fun DetailFact(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = YunQiaoUiTokens.Label, modifier = Modifier.weight(.75f), maxLines = 1)
        Text(value, style = YunQiaoUiTokens.Body, modifier = Modifier.weight(1.25f), maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ReadOnlyEnabledRow(enabled: Boolean) {
    val status = stringResource(if (enabled) R.string.enabled_read_only else R.string.disabled_read_only)
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(R.string.enabled_status), style = YunQiaoUiTokens.Label, modifier = Modifier.weight(.75f))
        Row(
            Modifier.weight(1.25f)
                .semantics { stateDescription = status }
                .testTag("business-enabled-read-only"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.width(42.dp).height(23.dp).clip(RoundedCornerShape(14.dp))
                    .background(if (enabled) YunQiaoUiTokens.Detail.Green else Color(0xFFB8C0C8))
                    .padding(2.dp),
                contentAlignment = if (enabled) Alignment.CenterEnd else Alignment.CenterStart,
            ) {
                Box(Modifier.size(19.dp).clip(RoundedCornerShape(50)).background(Color.White))
            }
            Spacer(Modifier.width(11.dp))
            Text(status, style = YunQiaoUiTokens.Body)
        }
    }
}

@Composable
private fun ReadOnlyInformationStrip() {
    Row(
        Modifier.fillMaxWidth().height(59.dp).clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFF7F9FB))
            .border(1.dp, Color(0xFFDCE4EA), RoundedCornerShape(8.dp))
            .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        YunQiaoIcon(YunQiaoIconKind.INFO, Modifier.size(21.dp), YunQiaoUiTokens.Information)
        Spacer(Modifier.width(15.dp))
        Text(stringResource(R.string.connection_read_only), style = YunQiaoUiTokens.Meta, maxLines = 3)
    }
}

@Composable
private fun transportLabel(transport: PrinterTransportUi?): String = when (transport ?: PrinterTransportUi.LAN) {
    PrinterTransportUi.LAN -> stringResource(R.string.lan_printer)
    PrinterTransportUi.USB -> "USB"
    PrinterTransportUi.BLUETOOTH -> stringResource(R.string.bluetooth_printer)
}

@Composable
internal fun ArchivePrinterConfirmation(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    ModalScrim(alpha = .48f) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                Modifier.width(if (compact) 360.dp else 520.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White)
                    .border(1.dp, YunQiaoUiTokens.Detail.Border, RoundedCornerShape(16.dp))
                    .testTag("archive-confirmation")
                    .padding(24.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(44.dp).clip(RoundedCornerShape(50)).background(YunQiaoUiTokens.Danger.copy(alpha = .10f)),
                        contentAlignment = Alignment.Center,
                    ) { YunQiaoIcon(YunQiaoIconKind.DELETE, Modifier.size(25.dp), YunQiaoUiTokens.Danger) }
                    Spacer(Modifier.width(14.dp))
                    Text(stringResource(R.string.archive_confirm_title), style = YunQiaoUiTokens.Heading20, modifier = Modifier.weight(1f))
                    IconTouchTarget(YunQiaoIconKind.CLOSE, actions.onDismissArchive, stringResource(R.string.common_close))
                }
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.archive_confirm_body), style = YunQiaoUiTokens.Body)
                state.selectedPrinter?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(it.name, style = YunQiaoUiTokens.Label)
                }
                Spacer(Modifier.height(24.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    YunQiaoButton(stringResource(R.string.common_cancel), actions.onDismissArchive, Modifier.weight(1f))
                    YunQiaoButton(
                        stringResource(R.string.archive_confirm_action),
                        actions.onConfirmArchive,
                        Modifier.weight(1f),
                        style = YunQiaoButtonStyle.DANGER,
                        icon = YunQiaoIconKind.DELETE,
                    )
                }
            }
        }
    }
}

@Composable
internal fun EditPrinterNameConfirmation(
    state: PrinterDevicesUiState,
    actions: PrinterDevicesActions,
    compact: Boolean,
) {
    ModalScrim(alpha = .48f) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                Modifier.width(if (compact) 360.dp else 520.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White)
                    .border(1.dp, YunQiaoUiTokens.Detail.Border, RoundedCornerShape(16.dp))
                    .testTag("edit-name-confirmation")
                    .padding(24.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.edit_name), style = YunQiaoUiTokens.Heading20, modifier = Modifier.weight(1f))
                    IconTouchTarget(YunQiaoIconKind.CLOSE, actions.onDismissEditName, stringResource(R.string.common_close))
                }
                Spacer(Modifier.height(18.dp))
                LabeledNameField(
                    label = stringResource(R.string.printer_name),
                    initial = state.printerNameDraft.ifBlank { state.selectedPrinter?.name.orEmpty() },
                    onChanged = actions.onPrinterNameChanged,
                    accent = YunQiaoUiTokens.Detail.Green,
                )
                Spacer(Modifier.height(24.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    YunQiaoButton(stringResource(R.string.common_cancel), actions.onDismissEditName, Modifier.weight(1f))
                    YunQiaoButton(
                        stringResource(R.string.common_save),
                        actions.onConfirmEditName,
                        Modifier.weight(1f),
                        style = YunQiaoButtonStyle.PRIMARY,
                        accent = YunQiaoUiTokens.Detail.Green,
                    )
                }
            }
        }
    }
}
