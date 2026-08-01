package com.yunqiao.life.merchantterminal.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal enum class YunQiaoIconKind {
    BACK,
    CLOSE,
    CHECK,
    PLUS,
    CHEVRON_RIGHT,
    PRINTER,
    USB,
    LAN,
    BLUETOOTH,
    REFRESH,
    INFO,
    SETTINGS,
    EDIT,
    DELETE,
    SERVER,
    USER,
    SHIELD,
    CLOCK,
    WIFI,
    SIGNAL,
    PAPER,
    SYNC,
    LIGHTBULB,
}

@Composable
internal fun YunQiaoIcon(
    kind: YunQiaoIconKind,
    modifier: Modifier = Modifier,
    tint: Color = YunQiaoUiTokens.Ink,
    strokeWidth: Float = 2f,
) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val unit = minOf(w, h)
        val sw = strokeWidth * density
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) = drawLine(
            color = tint,
            start = Offset(x1 * w, y1 * h),
            end = Offset(x2 * w, y2 * h),
            strokeWidth = sw,
            cap = StrokeCap.Round,
        )
        when (kind) {
            YunQiaoIconKind.BACK -> {
                line(.82f, .5f, .18f, .5f)
                line(.18f, .5f, .42f, .22f)
                line(.18f, .5f, .42f, .78f)
            }
            YunQiaoIconKind.CLOSE -> {
                line(.2f, .2f, .8f, .8f)
                line(.8f, .2f, .2f, .8f)
            }
            YunQiaoIconKind.CHECK -> {
                line(.18f, .53f, .42f, .76f)
                line(.42f, .76f, .84f, .25f)
            }
            YunQiaoIconKind.PLUS -> {
                line(.5f, .16f, .5f, .84f)
                line(.16f, .5f, .84f, .5f)
            }
            YunQiaoIconKind.CHEVRON_RIGHT -> {
                line(.32f, .16f, .68f, .5f)
                line(.68f, .5f, .32f, .84f)
            }
            YunQiaoIconKind.PRINTER -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(.18f * w, .36f * h),
                    size = Size(.64f * w, .43f * h),
                    cornerRadius = CornerRadius(.08f * unit),
                    style = Stroke(sw),
                )
                drawRect(
                    color = tint,
                    topLeft = Offset(.28f * w, .09f * h),
                    size = Size(.44f * w, .34f * h),
                    style = Stroke(sw),
                )
                drawRect(
                    color = tint,
                    topLeft = Offset(.30f * w, .62f * h),
                    size = Size(.40f * w, .29f * h),
                    style = Stroke(sw),
                )
                drawCircle(tint, radius = .035f * unit, center = Offset(.70f * w, .50f * h))
            }
            YunQiaoIconKind.USB -> {
                line(.5f, .9f, .5f, .18f)
                line(.5f, .18f, .38f, .32f)
                line(.5f, .18f, .62f, .32f)
                line(.5f, .56f, .25f, .42f)
                drawCircle(tint, .08f * unit, Offset(.22f * w, .38f * h), style = Stroke(sw))
                line(.5f, .68f, .76f, .52f)
                drawRect(tint, Offset(.72f * w, .42f * h), Size(.13f * w, .13f * h), style = Stroke(sw))
                drawCircle(tint, .08f * unit, Offset(.5f * w, .86f * h))
            }
            YunQiaoIconKind.LAN -> {
                drawRoundRect(
                    tint,
                    Offset(.35f * w, .08f * h),
                    Size(.30f * w, .25f * h),
                    CornerRadius(.05f * unit),
                    style = Stroke(sw),
                )
                line(.5f, .33f, .5f, .56f)
                line(.18f, .56f, .82f, .56f)
                line(.18f, .56f, .18f, .72f)
                line(.82f, .56f, .82f, .72f)
                drawCircle(tint, .09f * unit, Offset(.18f * w, .82f * h), style = Stroke(sw))
                drawCircle(tint, .09f * unit, Offset(.50f * w, .82f * h), style = Stroke(sw))
                drawCircle(tint, .09f * unit, Offset(.82f * w, .82f * h), style = Stroke(sw))
                line(.5f, .56f, .5f, .72f)
            }
            YunQiaoIconKind.BLUETOOTH -> {
                val p = Path().apply {
                    moveTo(.45f * w, .08f * h)
                    lineTo(.75f * w, .32f * h)
                    lineTo(.25f * w, .72f * h)
                    lineTo(.45f * w, .9f * h)
                    close()
                    moveTo(.45f * w, .08f * h)
                    lineTo(.45f * w, .9f * h)
                    moveTo(.25f * w, .28f * h)
                    lineTo(.75f * w, .72f * h)
                }
                drawPath(p, tint, style = Stroke(sw, cap = StrokeCap.Round))
            }
            YunQiaoIconKind.REFRESH, YunQiaoIconKind.SYNC -> {
                drawArc(
                    tint,
                    startAngle = 35f,
                    sweepAngle = 275f,
                    useCenter = false,
                    topLeft = Offset(.15f * w, .15f * h),
                    size = Size(.70f * w, .70f * h),
                    style = Stroke(sw, cap = StrokeCap.Round),
                )
                line(.76f, .12f, .85f, .34f)
                line(.85f, .34f, .62f, .34f)
            }
            YunQiaoIconKind.INFO -> {
                drawCircle(tint, .42f * unit, Offset(.5f * w, .5f * h), style = Stroke(sw))
                line(.5f, .46f, .5f, .72f)
                drawCircle(tint, .04f * unit, Offset(.5f * w, .28f * h))
            }
            YunQiaoIconKind.SETTINGS -> {
                drawCircle(tint, .21f * unit, Offset(.5f * w, .5f * h), style = Stroke(sw))
                repeat(8) { index ->
                    val angle = Math.toRadians(index * 45.0)
                    val x1 = .5f * w + kotlin.math.cos(angle).toFloat() * .31f * unit
                    val y1 = .5f * h + kotlin.math.sin(angle).toFloat() * .31f * unit
                    val x2 = .5f * w + kotlin.math.cos(angle).toFloat() * .46f * unit
                    val y2 = .5f * h + kotlin.math.sin(angle).toFloat() * .46f * unit
                    drawLine(tint, Offset(x1, y1), Offset(x2, y2), sw, StrokeCap.Round)
                }
            }
            YunQiaoIconKind.EDIT -> {
                line(.18f, .76f, .28f, .48f)
                line(.28f, .48f, .68f, .08f)
                line(.68f, .08f, .87f, .27f)
                line(.87f, .27f, .47f, .67f)
                line(.47f, .67f, .18f, .76f)
                line(.14f, .88f, .86f, .88f)
            }
            YunQiaoIconKind.DELETE -> {
                drawRoundRect(tint, Offset(.28f * w, .30f * h), Size(.44f * w, .56f * h), CornerRadius(.04f * unit), style = Stroke(sw))
                line(.18f, .22f, .82f, .22f)
                line(.39f, .12f, .61f, .12f)
                line(.42f, .40f, .42f, .72f)
                line(.58f, .40f, .58f, .72f)
            }
            YunQiaoIconKind.SERVER -> {
                repeat(2) { index ->
                    val top = (.18f + index * .38f) * h
                    drawRoundRect(tint, Offset(.16f * w, top), Size(.68f * w, .26f * h), CornerRadius(.05f * unit), style = Stroke(sw))
                    drawCircle(tint, .035f * unit, Offset(.27f * w, top + .13f * h))
                }
            }
            YunQiaoIconKind.USER -> {
                drawCircle(tint, .18f * unit, Offset(.5f * w, .3f * h), style = Stroke(sw))
                drawArc(tint, 205f, 130f, false, Offset(.18f * w, .42f * h), Size(.64f * w, .48f * h), style = Stroke(sw, cap = StrokeCap.Round))
            }
            YunQiaoIconKind.SHIELD -> {
                val p = Path().apply {
                    moveTo(.5f * w, .08f * h)
                    lineTo(.82f * w, .22f * h)
                    lineTo(.76f * w, .66f * h)
                    lineTo(.5f * w, .9f * h)
                    lineTo(.24f * w, .66f * h)
                    lineTo(.18f * w, .22f * h)
                    close()
                }
                drawPath(p, tint, style = Stroke(sw))
                line(.34f, .5f, .46f, .63f)
                line(.46f, .63f, .68f, .37f)
            }
            YunQiaoIconKind.CLOCK -> {
                drawCircle(tint, .40f * unit, Offset(.5f * w, .5f * h), style = Stroke(sw))
                line(.5f, .24f, .5f, .53f)
                line(.5f, .53f, .69f, .64f)
            }
            YunQiaoIconKind.WIFI -> {
                drawArc(tint, 215f, 110f, false, Offset(.10f * w, .12f * h), Size(.80f * w, .70f * h), style = Stroke(sw, cap = StrokeCap.Round))
                drawArc(tint, 215f, 110f, false, Offset(.27f * w, .35f * h), Size(.46f * w, .38f * h), style = Stroke(sw, cap = StrokeCap.Round))
                drawCircle(tint, .07f * unit, Offset(.5f * w, .78f * h))
            }
            YunQiaoIconKind.SIGNAL -> {
                repeat(4) { index ->
                    val barW = .12f * w
                    val barH = (.22f + index * .17f) * h
                    drawRoundRect(tint, Offset((.12f + index * .20f) * w, .86f * h - barH), Size(barW, barH), CornerRadius(.03f * unit))
                }
            }
            YunQiaoIconKind.PAPER -> {
                drawRoundRect(tint, Offset(.22f * w, .08f * h), Size(.56f * w, .82f * h), CornerRadius(.04f * unit), style = Stroke(sw))
                line(.34f, .38f, .66f, .38f)
                line(.34f, .55f, .66f, .55f)
                line(.34f, .72f, .58f, .72f)
            }
            YunQiaoIconKind.LIGHTBULB -> {
                drawArc(tint, 180f, 180f, false, Offset(.2f * w, .08f * h), Size(.6f * w, .58f * h), style = Stroke(sw, cap = StrokeCap.Round))
                line(.22f, .37f, .40f, .70f)
                line(.78f, .37f, .60f, .70f)
                line(.40f, .70f, .60f, .70f)
                line(.40f, .82f, .60f, .82f)
                line(.44f, .92f, .56f, .92f)
            }
        }
    }
}

@Composable
internal fun ThermalPrinterIllustration(
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
) {
    Image(
        painter = painterResource(com.yunqiao.life.merchantterminal.R.drawable.yunqiao_thermal_printer_illustration),
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = ContentScale.Fit,
    )
}

@Composable
internal fun ReferenceCard(
    modifier: Modifier = Modifier,
    radius: Dp = 10.dp,
    borderColor: Color = Color(0xFFE5E9EC),
    backgroundColor: Color = Color.White,
    borderWidth: Dp = 1.dp,
    shadow: Dp = 4.dp,
    content: @Composable BoxScope.() -> Unit,
) {
    val shape = RoundedCornerShape(radius)
    Box(
        modifier = modifier
            .shadow(shadow, shape, ambientColor = Color.Black.copy(alpha = .06f), spotColor = Color.Black.copy(alpha = .08f))
            .clip(shape)
            .background(backgroundColor)
            .border(borderWidth, borderColor, shape),
        content = content,
    )
}

internal enum class YunQiaoButtonStyle { PRIMARY, OUTLINE, DANGER, TEXT }

@Composable
internal fun YunQiaoButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: YunQiaoButtonStyle = YunQiaoButtonStyle.OUTLINE,
    accent: Color = YunQiaoUiTokens.Overview.Green,
    icon: YunQiaoIconKind? = null,
    visualHeight: Dp = 48.dp,
    enabled: Boolean = true,
    textStyle: TextStyle = YunQiaoUiTokens.Label,
) {
    val shape = RoundedCornerShape(9.dp)
    val background = when (style) {
        YunQiaoButtonStyle.PRIMARY -> accent
        else -> Color.White
    }
    val foreground = when (style) {
        YunQiaoButtonStyle.PRIMARY -> Color.White
        YunQiaoButtonStyle.DANGER -> YunQiaoUiTokens.Danger
        YunQiaoButtonStyle.TEXT -> accent
        YunQiaoButtonStyle.OUTLINE -> YunQiaoUiTokens.Ink
    }.copy(alpha = if (enabled) 1f else .42f)
    val border = when (style) {
        YunQiaoButtonStyle.PRIMARY, YunQiaoButtonStyle.TEXT -> Color.Transparent
        YunQiaoButtonStyle.DANGER -> YunQiaoUiTokens.Danger
        YunQiaoButtonStyle.OUTLINE -> if (icon != null) accent else Color(0xFFD7DEE5)
    }
    Box(
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .semantics { role = Role.Button }
            .clickable(
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(visualHeight)
                .clip(shape)
                .background(background)
                .border(if (border == Color.Transparent) 0.dp else 1.dp, border, shape)
                .padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                YunQiaoIcon(icon, Modifier.size(20.dp), foreground)
                Spacer(Modifier.width(9.dp))
            }
            Text(
                text = text,
                color = foreground,
                style = textStyle,
                textAlign = TextAlign.Center,
                maxLines = 2,
            )
        }
    }
}

@Composable
internal fun IconTouchTarget(
    kind: YunQiaoIconKind,
    onClick: () -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    visualSize: Dp = 36.dp,
    tint: Color = YunQiaoUiTokens.Ink,
    framed: Boolean = false,
) {
    Box(
        modifier = modifier
            .size(48.dp)
            .semantics {
                role = Role.Button
                this.contentDescription = contentDescription
            }
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .size(visualSize)
                .then(
                    if (framed) {
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color.White)
                            .border(1.dp, Color(0xFFE5E9EC), RoundedCornerShape(8.dp))
                    } else {
                        Modifier
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            YunQiaoIcon(kind, Modifier.size(20.dp), tint)
        }
    }
}

@Composable
internal fun StatusPill(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
    dot: Boolean = false,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(7.dp))
            .background(color.copy(alpha = .10f))
            .padding(horizontal = 11.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (dot) Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(color))
        Text(text, style = YunQiaoUiTokens.Label, color = color)
    }
}

@Composable
internal fun ModalScrim(
    alpha: Float,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = alpha)),
        content = content,
    )
}

@Composable
internal fun TransportIconTile(
    transport: PrinterTransportUi,
    modifier: Modifier = Modifier,
    accent: Color = YunQiaoUiTokens.Overview.Green,
    illustration: Boolean = false,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(accent.copy(alpha = .09f)),
        contentAlignment = Alignment.Center,
    ) {
        if (illustration) {
            ThermalPrinterIllustration(Modifier.fillMaxSize().padding(5.dp))
            val symbol = when (transport) {
                PrinterTransportUi.USB -> YunQiaoIconKind.USB
                PrinterTransportUi.LAN -> YunQiaoIconKind.WIFI
                PrinterTransportUi.BLUETOOTH -> YunQiaoIconKind.BLUETOOTH
            }
            YunQiaoIcon(
                symbol,
                Modifier.align(Alignment.TopEnd).padding(5.dp).size(22.dp),
                accent,
                strokeWidth = 2.2f,
            )
        } else {
            val icon = when (transport) {
                PrinterTransportUi.USB -> YunQiaoIconKind.USB
                PrinterTransportUi.LAN -> YunQiaoIconKind.LAN
                PrinterTransportUi.BLUETOOTH -> YunQiaoIconKind.BLUETOOTH
            }
            YunQiaoIcon(icon, Modifier.size(34.dp), accent, strokeWidth = 2.2f)
        }
    }
}

@Composable
internal fun HorizontalDivider(
    modifier: Modifier = Modifier,
    color: Color = Color(0xFFE8ECF0),
) {
    Box(modifier.height(1.dp).background(color))
}
