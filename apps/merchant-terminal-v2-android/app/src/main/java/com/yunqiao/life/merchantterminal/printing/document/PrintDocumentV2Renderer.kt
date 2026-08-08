package com.yunqiao.life.merchantterminal.printing.document

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.escpos.PrintWidthValidator
import java.io.ByteArrayOutputStream
import kotlin.math.ceil

object PrintDocumentV2Renderer {
    fun renderBytes(document: PrintDocumentV2, bindingPaperWidth: PaperWidth): ByteArray {
        require(document.paperWidth.matches(bindingPaperWidth)) { "Print document paper width mismatch." }
        val cutMode = when ((document.blocks.lastOrNull() as? PrintBlock.Cut)?.mode) {
            PrintCutMode.NONE, null -> CutMode.NONE
            PrintCutMode.HALF -> CutMode.HALF
            PrintCutMode.FULL -> CutMode.FULL
        }
        val bitmap = renderBitmap(document, bindingPaperWidth)
        return try {
            val oneCopy = EscPosRasterEncoder.encodeBitmap(bitmap, threshold = 160, cutMode = cutMode)
            ByteArrayOutputStream(oneCopy.size * document.copies).use { output ->
                repeat(document.copies) { output.write(oneCopy) }
                output.toByteArray()
            }
        } finally {
            bitmap.recycle()
        }
    }

    fun renderBitmap(document: PrintDocumentV2, bindingPaperWidth: PaperWidth): Bitmap {
        val width = PrintWidthValidator.resolve(bindingPaperWidth, null)
        val scale = width / 576f
        val margin = (width * 0.052f).coerceAtLeast(14f)
        val contentWidth = width - margin * 2
        val rows = mutableListOf<VisualRow>()
        document.blocks.forEach { block ->
            when (block) {
                is PrintBlock.Text -> rows.wrap(
                    block.text,
                    paint(scale, block.bold, block.fontSize, block.underline, block.align),
                    contentWidth,
                    block.align,
                )
                is PrintBlock.Row -> rows.addRow(block, scale, contentWidth)
                PrintBlock.Divider -> rows += VisualRow(
                    "-".repeat(if (width <= 384) 30 else 44),
                    paint(scale, false, PrintFontSize.NORMAL, false, PrintAlignment.LEFT),
                    PrintAlignment.LEFT,
                )
                is PrintBlock.Feed -> repeat(block.lines) {
                    rows += VisualRow(" ", paint(scale, false, PrintFontSize.NORMAL, false, PrintAlignment.LEFT), PrintAlignment.LEFT)
                }
                is PrintBlock.Cut -> Unit
            }
        }
        val gap = (6f * scale).coerceAtLeast(4f)
        val height = (margin * 2 + rows.sumOf { ceil(it.paint.fontSpacing + gap).toInt() }).toInt()
        require(height in 1..MAX_HEIGHT) { "Print document exceeds raster height limit." }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap).apply { drawColor(Color.WHITE) }
        var y = margin
        rows.forEach { row ->
            y -= row.paint.fontMetrics.ascent
            val x = when (row.align) {
                PrintAlignment.LEFT -> margin
                PrintAlignment.CENTER -> width / 2f
                PrintAlignment.RIGHT -> width - margin
            }
            canvas.drawText(row.text, x, y, row.paint)
            row.right?.let { canvas.drawText(it, width - margin, y, row.rightPaint!!) }
            y += row.paint.fontMetrics.descent + gap
        }
        return bitmap
    }

    private fun MutableList<VisualRow>.addRow(block: PrintBlock.Row, scale: Float, width: Float) {
        val leftPaint = paint(scale, block.bold, PrintFontSize.NORMAL, false, PrintAlignment.LEFT)
        val rightPaint = paint(scale, block.bold, PrintFontSize.NORMAL, false, PrintAlignment.RIGHT)
        val rightLines = wrapText(block.right, rightPaint, width * 0.45f)
        val rightWidth = rightLines.maxOfOrNull(rightPaint::measureText) ?: 0f
        val availableLeft = (width - rightWidth - 12f).coerceAtLeast(1f)
        val leftLines = wrapText(block.left, leftPaint, availableLeft)
        repeat(maxOf(leftLines.size, rightLines.size)) { index ->
            add(
                VisualRow(
                    leftLines.getOrElse(index) { " " },
                    leftPaint,
                    PrintAlignment.LEFT,
                    right = rightLines.getOrNull(index),
                    rightPaint = rightPaint,
                ),
            )
        }
    }

    private fun MutableList<VisualRow>.wrap(
        value: String,
        paint: Paint,
        maxWidth: Float,
        align: PrintAlignment,
    ) = wrapText(value, paint, maxWidth).forEach { add(VisualRow(it, paint, align)) }

    private fun wrapText(value: String, paint: Paint, maxWidth: Float): List<String> {
        if (value.isEmpty()) return listOf(" ")
        val result = mutableListOf<String>()
        var remaining = value
        while (remaining.isNotEmpty()) {
            val count = paint.breakText(remaining, true, maxWidth, null).coerceAtLeast(1)
            result += remaining.take(count)
            remaining = remaining.drop(count)
        }
        return result
    }

    private fun paint(
        scale: Float,
        bold: Boolean,
        fontSize: PrintFontSize,
        underline: Boolean,
        align: PrintAlignment,
    ) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        textSize = when (fontSize) {
            PrintFontSize.SMALL -> 20f
            PrintFontSize.NORMAL -> 24f
            PrintFontSize.LARGE -> 34f
        }.times(scale).coerceAtLeast(16f)
        typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
        isUnderlineText = underline
        textAlign = when (align) {
            PrintAlignment.LEFT -> Paint.Align.LEFT
            PrintAlignment.CENTER -> Paint.Align.CENTER
            PrintAlignment.RIGHT -> Paint.Align.RIGHT
        }
    }

    private fun PrintPaperWidth.matches(width: PaperWidth) = when (this) {
        PrintPaperWidth.MM58 -> width == PaperWidth.MM_58
        PrintPaperWidth.MM80 -> width == PaperWidth.MM_80
    }

    private data class VisualRow(
        val text: String,
        val paint: Paint,
        val align: PrintAlignment,
        val right: String? = null,
        val rightPaint: Paint? = null,
    )

    private const val MAX_HEIGHT = 8_000
}
