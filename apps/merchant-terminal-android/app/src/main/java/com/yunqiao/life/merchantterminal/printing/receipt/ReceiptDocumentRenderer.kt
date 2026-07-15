package com.yunqiao.life.merchantterminal.printing.receipt

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import com.yunqiao.life.merchantterminal.printing.escpos.PrintWidthValidator
import com.yunqiao.life.merchantterminal.printing.render.QrCodeBitmapRenderer
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil

data class ProductionReceiptRenderConfig(
    val paperWidth: PaperWidth,
    val customDots: Int?,
    val jobId: String,
    val contentHash: String,
    val printedAtEpochMs: Long,
)

/** Bitmap renderer for the two controlled V1 receipt schemas. */
object ReceiptDocumentRenderer {
    fun render(document: ReceiptDocumentV1, config: ProductionReceiptRenderConfig): Bitmap {
        require(config.jobId.matches(Regex("^[1-9][0-9]{0,38}$")))
        require(config.contentHash.matches(Regex("^[0-9a-f]{64}$")))
        val width = PrintWidthValidator.resolve(config.paperWidth, config.customDots)
        if (width > MAX_PRODUCTION_WIDTH) {
            throw UsbPrinterException(
                UsbPrintErrorCode.INVALID_PRINT_WIDTH,
                "Production receipt width exceeds the bounded V1 raster profile.",
            )
        }
        val scale = width / 576f
        val margin = (width * 0.052f).coerceAtLeast(14f)
        val contentWidth = width - margin * 2
        val normal = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = (24f * scale).coerceAtLeast(18f)
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        val bold = Paint(normal).apply { typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
        val title = Paint(bold).apply {
            textSize = (34f * scale).coerceAtLeast(25f)
            textAlign = Paint.Align.CENTER
        }
        val divider = "-".repeat(if (width <= 384) 30 else 44)
        val rows = mutableListOf<ReceiptRow>()
        rows.wrap(document.merchant.name, title, contentWidth, centered = true)
        document.merchant.address?.takeIf(String::isNotBlank)?.let { rows.wrap(it, normal, contentWidth, true) }
        document.merchant.phone?.takeIf(String::isNotBlank)?.let {
            rows.wrap(it, normal, contentWidth, centered = true)
        }
        rows += ReceiptRow(divider, normal)
        when (document.receiptType) {
            ReceiptType.ORDER_CUSTOMER -> addOrderHeader(rows, requireNotNull(document.order), bold, normal, contentWidth)
            ReceiptType.TABLE_BILL -> addTableHeader(rows, requireNotNull(document.tableSession), bold, normal, contentWidth)
        }
        rows += ReceiptRow(divider, normal)
        document.items.forEachIndexed { index, item ->
            rows.wrap("${index + 1}. ${item.name}", bold, contentWidth)
            item.nameVi?.takeIf { it.isNotBlank() && it != item.name }?.let {
                rows.wrap("   $it", normal, contentWidth)
            }
            item.nameEn?.takeIf { it.isNotBlank() && it != item.name && it != item.nameVi }?.let {
                rows.wrap("   $it", normal, contentWidth)
            }
            item.specification?.takeIf(String::isNotBlank)?.let {
                rows.wrap("   规格 / Quy cách: $it", normal, contentWidth)
            }
            rows.wrap(
                "   ${item.quantity} x ${vnd(item.unitPrice)} = ${vnd(item.lineTotal)} VND",
                normal,
                contentWidth,
            )
            item.note?.takeIf(String::isNotBlank)?.let {
                rows.wrap("   备注 / Ghi chú: $it", normal, contentWidth)
            }
        }
        rows += ReceiptRow(divider, normal)
        rows += ReceiptRow("小计 / Tạm tính: ${vnd(document.totals.subtotal)} VND", normal)
        document.totals.discount?.let {
            rows += ReceiptRow("优惠 / Giảm giá: ${vnd(it)} VND", normal)
        }
        document.totals.serviceFee?.let {
            rows += ReceiptRow("服务费 / Phí dịch vụ: ${vnd(it)} VND", normal)
        }
        rows += ReceiptRow("合计 / Tổng cộng: ${vnd(document.totals.total)} VND", bold)
        document.note?.takeIf(String::isNotBlank)?.let {
            rows.wrap("订单备注 / Ghi chú: $it", normal, contentWidth)
        }
        rows += ReceiptRow(divider, normal)
        rows += ReceiptRow("生成 / Tạo: ${formatTime(document.generatedAt)}", normal)
        rows += ReceiptRow("打印 / In: ${formatTime(config.printedAtEpochMs)}", normal)

        val gap = (6f * scale).coerceAtLeast(4f)
        val textHeight = rows.sumOf { ceil(it.paint.fontSpacing + gap).toInt() }
        val qrSize = minOf((width * 0.35f).toInt(), 220).coerceAtLeast(128)
        val requestedHeight = (margin * 2 + textHeight + qrSize + normal.fontSpacing * 3).toInt()
        require(requestedHeight in 1..MAX_HEIGHT) {
            "Receipt exceeds the controlled raster height limit."
        }
        val height = requestedHeight
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        var y = margin
        rows.forEach { row ->
            y -= row.paint.fontMetrics.ascent
            val drawPaint = if (row.centered && row.paint.textAlign != Paint.Align.CENTER) {
                Paint(row.paint).apply { textAlign = Paint.Align.CENTER }
            } else {
                row.paint
            }
            canvas.drawText(row.text, if (row.centered) width / 2f else margin, y, drawPaint)
            y += row.paint.fontMetrics.descent + gap
        }
        val qrPayload = document.verificationCode
            ?.takeIf(String::isNotBlank)
            ?: "YQ:J:${config.jobId}:${config.contentHash.take(16)}"
        val qr = QrCodeBitmapRenderer.render(qrPayload, qrSize)
        canvas.drawBitmap(qr, (width - qrSize) / 2f, y, null)
        y += qrSize + normal.fontSpacing
        qr.recycle()
        val centered = Paint(normal).apply { textAlign = Paint.Align.CENTER }
        canvas.drawText("Job ${config.jobId}", width / 2f, y, centered)
        return bitmap
    }

    private fun addOrderHeader(
        rows: MutableList<ReceiptRow>,
        order: ReceiptOrder,
        bold: Paint,
        normal: Paint,
        width: Float,
    ) {
        rows += ReceiptRow("订单 / Đơn: ${order.orderNo}", bold)
        order.tableName?.takeIf(String::isNotBlank)?.let { rows.wrap("桌台 / Bàn: $it", normal, width) }
        rows += ReceiptRow("类型 / Loại: ${order.orderType}", normal)
        order.guestCount?.let { rows += ReceiptRow("人数 / Khách: $it", normal) }
        rows += ReceiptRow("下单 / Đặt lúc: ${formatTime(order.createdAt)}", normal)
    }

    private fun addTableHeader(
        rows: MutableList<ReceiptRow>,
        table: ReceiptTableSession,
        bold: Paint,
        normal: Paint,
        width: Float,
    ) {
        rows.wrap("桌账 / Hóa đơn bàn: ${table.tableName}", bold, width)
        rows += ReceiptRow("Session: ${table.sessionNo}", normal)
        rows += ReceiptRow("开台 / Mở bàn: ${formatTime(table.openedAt)}", normal)
        if (table.orderNos.isNotEmpty()) rows.wrap("订单 / Đơn: ${table.orderNos.joinToString(", ")}", normal, width)
    }

    private fun MutableList<ReceiptRow>.wrap(
        value: String,
        paint: Paint,
        maxWidth: Float,
        centered: Boolean = false,
    ) {
        var remaining = value
        while (remaining.isNotEmpty()) {
            val count = paint.breakText(remaining, true, maxWidth, null).coerceAtLeast(1)
            add(ReceiptRow(remaining.take(count), paint, centered))
            remaining = remaining.drop(count)
        }
    }

    private fun vnd(value: Long): String = VND_FORMAT.format(value)

    private fun formatTime(value: String): String = runCatching {
        TIME_FORMAT.format(Instant.parse(value))
    }.getOrDefault(value.take(32))

    private fun formatTime(epochMs: Long): String = TIME_FORMAT.format(Instant.ofEpochMilli(epochMs))

    private data class ReceiptRow(val text: String, val paint: Paint, val centered: Boolean = false)

    private val VND_FORMAT = NumberFormat.getIntegerInstance(Locale("vi", "VN"))
    private val TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
        .withLocale(Locale.US)
        .withZone(ZoneId.systemDefault())
    private const val MAX_PRODUCTION_WIDTH = 576
    private const val MAX_HEIGHT = 8_000
}
