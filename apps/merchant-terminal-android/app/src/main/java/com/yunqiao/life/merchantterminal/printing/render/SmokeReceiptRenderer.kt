package com.yunqiao.life.merchantterminal.printing.render

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import com.yunqiao.life.merchantterminal.printing.escpos.PrintWidthValidator
import kotlin.math.ceil

data class SmokeReceiptData(
    val deviceModel: String,
    val androidVersion: String,
    val printerVendorId: Int,
    val printerProductId: Int,
    val timestamp: String,
)

data class ReceiptRenderConfig(
    val paperWidth: PaperWidth = PaperWidth.MM_80,
    val customDots: Int? = null,
    val qrPayload: String = "YUNQIAO-USB-TEST",
)

object SmokeReceiptRenderer {
    fun render(data: SmokeReceiptData, config: ReceiptRenderConfig): Bitmap {
        val width = PrintWidthValidator.resolve(config.paperWidth, config.customDots)
        return runCatching { renderInternal(data, config, width) }
            .getOrElse { throwable ->
                if (throwable is UsbPrinterException) throw throwable
                throw UsbPrinterException(
                    UsbPrintErrorCode.BITMAP_RENDER_FAILED,
                    "Could not render USB smoke receipt bitmap.",
                    throwable,
                )
            }
    }

    private fun renderInternal(
        data: SmokeReceiptData,
        config: ReceiptRenderConfig,
        width: Int,
    ): Bitmap {
        val horizontalMargin = (width * 0.055f).coerceAtLeast(16f)
        val contentWidth = width - horizontalMargin * 2
        val scale = width / 576f
        val normalPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = (25f * scale).coerceAtLeast(19f)
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        val titlePaint = Paint(normalPaint).apply {
            textSize = (31f * scale).coerceAtLeast(23f)
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
        }
        val linePaint = Paint(normalPaint).apply {
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
        }
        val lines = buildList {
            add(Line("YUNQIAO USB PRINT TEST", titlePaint, centered = true))
            add(Line("--------------------------------", linePaint))
            addWrapped("Device Model: ${data.deviceModel}", normalPaint, contentWidth)
            addWrapped("Android: ${data.androidVersion}", normalPaint, contentWidth)
            add(Line("Printer VID: ${data.printerVendorId} (0x${data.printerVendorId.toHex4()})", normalPaint))
            add(Line("Printer PID: ${data.printerProductId} (0x${data.printerProductId.toHex4()})", normalPaint))
            addWrapped("Time: ${data.timestamp}", normalPaint, contentWidth)
            add(Line("", normalPaint))
            add(Line("ASCII: 1234567890", normalPaint))
            add(Line("English: Printer connection OK", normalPaint))
            add(Line("Chinese: 云桥打印测试", normalPaint))
            add(Line("Vietnamese: Xin chào - Cảm ơn", normalPaint))
            add(Line("--------------------------------", linePaint))
        }
        val lineGap = (7f * scale).coerceAtLeast(5f)
        val textHeight = lines.sumOf { line ->
            ceil(line.paint.fontSpacing + lineGap).toInt()
        }
        val qrSize = minOf((width * 0.42f).toInt(), 240).coerceAtLeast(150)
        val footerHeight = ceil(normalPaint.fontSpacing * 2 + lineGap * 3).toInt()
        val bitmapHeight = (
            horizontalMargin.toInt() + textHeight + qrSize + footerHeight + horizontalMargin.toInt()
            ).coerceAtMost(MAX_RECEIPT_HEIGHT)
        val bitmap = Bitmap.createBitmap(width, bitmapHeight, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        var y = horizontalMargin
        lines.forEach { line ->
            y -= line.paint.fontMetrics.ascent
            val x = if (line.centered) width / 2f else horizontalMargin
            canvas.drawText(line.text, x, y, line.paint)
            y += line.paint.fontMetrics.descent + lineGap
        }

        val qrBitmap = QrCodeBitmapRenderer.render(config.qrPayload, qrSize)
        val qrLeft = (width - qrBitmap.width) / 2f
        canvas.drawBitmap(qrBitmap, qrLeft, y, null)
        y += qrBitmap.height + normalPaint.fontSpacing
        qrBitmap.recycle()
        normalPaint.textAlign = Paint.Align.CENTER
        canvas.drawText("QR: ${config.qrPayload}", width / 2f, y, normalPaint)
        y += normalPaint.fontSpacing + lineGap
        canvas.drawText("END", width / 2f, y, normalPaint)
        return bitmap
    }

    private fun MutableList<Line>.addWrapped(text: String, paint: Paint, maxWidth: Float) {
        var remainder = text
        while (remainder.isNotEmpty()) {
            val measuredCount = paint.breakText(remainder, true, maxWidth, null)
            val safeCount = measuredCount.coerceAtLeast(1).coerceAtMost(remainder.length)
            add(Line(remainder.take(safeCount), paint))
            remainder = remainder.drop(safeCount)
        }
    }

    private fun Int.toHex4(): String = toString(16).uppercase().padStart(4, '0')

    private data class Line(
        val text: String,
        val paint: Paint,
        val centered: Boolean = false,
    )

    private const val MAX_RECEIPT_HEIGHT = 8_000
}

object QrCodeBitmapRenderer {
    fun render(payload: String, size: Int): Bitmap {
        require(payload.isNotBlank()) { "QR payload must not be blank." }
        require(size in 96..1_024) { "QR size must be 96..1024 dots." }
        val matrix = QRCodeWriter().encode(
            payload,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(EncodeHintType.MARGIN to 1, EncodeHintType.CHARACTER_SET to "UTF-8"),
        )
        val pixels = IntArray(size * size)
        for (y in 0 until size) {
            for (x in 0 until size) {
                pixels[y * size + x] = if (matrix[x, y]) Color.BLACK else Color.WHITE
            }
        }
        return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
    }
}
