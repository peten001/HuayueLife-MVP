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

internal data class MeasuredColumnCell(
    val renderedText: String,
    val measuredWidth: Float,
    val availableWidth: Float,
    val textScaleX: Float,
)

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
        val margin = (width * MARGIN_RATIO).coerceAtLeast(14f)
        val contentWidth = width - margin * 2
        val compact = document.schemaVersion >= 3
        val rows = mutableListOf<RenderRow>()
        document.blocks.forEach { block ->
            when (block) {
                is PrintBlock.Text -> {
                    val textPaint = paint(
                        scale, block.bold, block.fontSize, block.underline, block.align, compact,
                    )
                    if (compact && block.overflow != null) {
                        val resolved = resolveCell(
                            PrintColumnCell(
                                block.text, 100, block.align, block.bold, block.fontSize,
                                block.overflow, 0,
                            ),
                            textPaint,
                            contentWidth,
                        )
                        rows += RenderRow.Text(resolved.text, resolved.paint, block.align)
                    } else {
                        rows.wrap(block.text, textPaint, contentWidth, block.align)
                    }
                }
                is PrintBlock.Row -> rows.addRow(block, scale, contentWidth, compact)
                is PrintBlock.Columns -> rows += columnsRow(block, scale, contentWidth, compact)
                is PrintBlock.BoxedTitle -> rows += boxedTitleRow(block, scale, contentWidth, compact)
                PrintBlock.Divider -> {
                    if (compact) {
                        rows += RenderRow.Divider((9f * scale).coerceAtLeast(6f))
                    } else {
                        rows += RenderRow.Text(
                            "-".repeat(if (width <= 384) 30 else 44),
                            paint(scale, false, PrintFontSize.NORMAL, false, PrintAlignment.LEFT, compact),
                            PrintAlignment.LEFT,
                        )
                    }
                }
                is PrintBlock.Feed -> repeat(block.lines) {
                    rows += RenderRow.Text(
                        " ",
                        paint(scale, false, PrintFontSize.NORMAL, false, PrintAlignment.LEFT, compact),
                        PrintAlignment.LEFT,
                    )
                }
                is PrintBlock.Cut -> Unit
            }
        }
        val rowGap = if (compact) {
            (4f * scale).coerceAtLeast(3f)
        } else {
            (6f * scale).coerceAtLeast(4f)
        }
        val height = (margin * 2 + rows.sumOf { ceil(it.height + rowGap).toInt() }).toInt()
        require(height in 1..MAX_HEIGHT) { "Print document exceeds raster height limit." }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap).apply { drawColor(Color.WHITE) }
        var top = margin
        rows.forEach { row ->
            drawRow(canvas, row, margin, contentWidth, top)
            top += row.height + rowGap
        }
        return bitmap
    }

    internal fun contentWidthDots(paperWidth: PaperWidth): Float {
        val width = PrintWidthValidator.resolve(paperWidth, null)
        val margin = (width * MARGIN_RATIO).coerceAtLeast(14f)
        return width - margin * 2
    }

    internal fun measureColumnCell(
        cell: PrintColumnCell,
        paperWidth: PaperWidth,
        availableWidth: Float,
    ): MeasuredColumnCell {
        val width = PrintWidthValidator.resolve(paperWidth, null)
        val resolved = resolveCell(
            cell,
            paint(
                width / 576f,
                cell.bold,
                cell.fontSize,
                false,
                cell.align,
                compact = true,
            ),
            availableWidth,
        )
        return MeasuredColumnCell(
            renderedText = resolved.text,
            measuredWidth = resolved.paint.measureText(resolved.text),
            availableWidth = availableWidth,
            textScaleX = resolved.paint.textScaleX,
        )
    }

    internal fun measureFittedText(
        text: String,
        fontSize: PrintFontSize,
        paperWidth: PaperWidth,
        availableWidth: Float,
    ): MeasuredColumnCell {
        val width = PrintWidthValidator.resolve(paperWidth, null)
        val fitted = fitPaint(
            paint(
                width / 576f,
                bold = true,
                fontSize = fontSize,
                underline = false,
                align = PrintAlignment.CENTER,
                compact = true,
            ),
            text,
            availableWidth,
        )
        return MeasuredColumnCell(
            renderedText = text,
            measuredWidth = fitted.measureText(text),
            availableWidth = availableWidth,
            textScaleX = fitted.textScaleX,
        )
    }

    private fun columnsRow(
        block: PrintBlock.Columns,
        scale: Float,
        contentWidth: Float,
        compact: Boolean,
    ): RenderRow.Columns {
        val bounds = ColumnLayoutCalculator.resolve(contentWidth, block.gapDots, block.cells)
        val cells = block.cells.zip(bounds).map { (cell, cellBounds) ->
            val basePaint = paint(
                scale,
                cell.bold,
                cell.fontSize,
                false,
                cell.align,
                compact,
            )
            val resolved = resolveCell(cell, basePaint, cellBounds.contentWidth)
            RenderedCell(resolved.text, resolved.paint, cellBounds)
        }
        return RenderRow.Columns(cells)
    }

    private fun boxedTitleRow(
        block: PrintBlock.BoxedTitle,
        scale: Float,
        contentWidth: Float,
        compact: Boolean,
    ): RenderRow.BoxedTitle {
        val gap = block.gapDots.toFloat()
        val boxWidth = (contentWidth - gap) * block.boxWeight / 100f
        val rightWidth = contentWidth - gap - boxWidth
        val boxPaint = paint(scale, true, PrintFontSize.LARGE, false, PrintAlignment.CENTER, compact)
        val titlePaint = fitPaint(
            paint(scale, true, block.fontSize, false, PrintAlignment.CENTER, compact),
            block.title,
            rightWidth,
        )
        val subtitlePaint = fitPaint(
            paint(scale, true, PrintFontSize.SMALL, false, PrintAlignment.CENTER, compact),
            block.subtitle,
            rightWidth,
        )
        val textHeight = titlePaint.fontSpacing + subtitlePaint.fontSpacing + (2f * scale).coerceAtLeast(2f)
        val height = maxOf((58f * scale).coerceAtLeast(42f), textHeight)
        return RenderRow.BoxedTitle(
            block = block,
            boxWidth = boxWidth,
            rightWidth = rightWidth,
            gap = gap,
            boxPaint = fitPaint(boxPaint, block.boxText, boxWidth - 8f),
            titlePaint = titlePaint,
            subtitlePaint = subtitlePaint,
            rowHeight = height,
        )
    }

    private fun drawRow(
        canvas: Canvas,
        row: RenderRow,
        margin: Float,
        contentWidth: Float,
        top: Float,
    ) {
        when (row) {
            is RenderRow.Text -> {
                val baseline = centeredBaseline(top, row.height, row.paint)
                val x = when (row.align) {
                    PrintAlignment.LEFT -> margin
                    PrintAlignment.CENTER -> margin + contentWidth / 2f
                    PrintAlignment.RIGHT -> margin + contentWidth
                }
                canvas.drawText(row.text, x, baseline, row.paint)
                row.right?.let {
                    canvas.drawText(it, margin + contentWidth, baseline, row.rightPaint!!)
                }
            }
            is RenderRow.Columns -> {
                row.cells.forEach { cell ->
                    val bounds = cell.bounds
                    val baseline = centeredBaseline(top, row.height, cell.paint)
                    val x = when (cell.paint.textAlign) {
                        Paint.Align.LEFT -> margin + bounds.contentLeft
                        Paint.Align.CENTER -> margin + (bounds.contentLeft + bounds.contentRight) / 2f
                        Paint.Align.RIGHT -> margin + bounds.contentRight
                    }
                    canvas.save()
                    canvas.clipRect(
                        margin + bounds.contentLeft,
                        top,
                        margin + bounds.contentRight,
                        top + row.height,
                    )
                    canvas.drawText(cell.text, x, baseline, cell.paint)
                    canvas.restore()
                }
            }
            is RenderRow.Divider -> {
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.BLACK
                    strokeWidth = 1.5f
                }
                val y = top + row.height / 2f
                canvas.drawLine(margin, y, margin + contentWidth, y, paint)
            }
            is RenderRow.BoxedTitle -> {
                val boxLeft = margin
                val boxRight = margin + row.boxWidth
                val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.BLACK
                    style = Paint.Style.STROKE
                    strokeWidth = 2f
                }
                canvas.drawRect(boxLeft, top, boxRight, top + row.height, stroke)
                canvas.drawText(
                    row.block.boxText,
                    (boxLeft + boxRight) / 2f,
                    centeredBaseline(top, row.height, row.boxPaint),
                    row.boxPaint,
                )
                val rightLeft = boxRight + row.gap
                val rightCenter = rightLeft + row.rightWidth / 2f
                val innerGap = 2f
                val combinedHeight = row.titlePaint.fontSpacing + innerGap + row.subtitlePaint.fontSpacing
                val textTop = top + (row.height - combinedHeight) / 2f
                canvas.drawText(
                    row.block.title,
                    rightCenter,
                    centeredBaseline(textTop, row.titlePaint.fontSpacing, row.titlePaint),
                    row.titlePaint,
                )
                canvas.drawText(
                    row.block.subtitle,
                    rightCenter,
                    centeredBaseline(
                        textTop + row.titlePaint.fontSpacing + innerGap,
                        row.subtitlePaint.fontSpacing,
                        row.subtitlePaint,
                    ),
                    row.subtitlePaint,
                )
            }
        }
    }

    private fun MutableList<RenderRow>.addRow(
        block: PrintBlock.Row,
        scale: Float,
        width: Float,
        compact: Boolean,
    ) {
        val leftPaint = paint(scale, block.bold, PrintFontSize.NORMAL, false, PrintAlignment.LEFT, compact)
        val rightPaint = paint(scale, block.bold, PrintFontSize.NORMAL, false, PrintAlignment.RIGHT, compact)
        val rightLines = wrapText(block.right, rightPaint, width * 0.45f)
        val rightWidth = rightLines.maxOfOrNull(rightPaint::measureText) ?: 0f
        val availableLeft = (width - rightWidth - 12f).coerceAtLeast(1f)
        val leftLines = wrapText(block.left, leftPaint, availableLeft)
        repeat(maxOf(leftLines.size, rightLines.size)) { index ->
            add(
                RenderRow.Text(
                    leftLines.getOrElse(index) { " " },
                    leftPaint,
                    PrintAlignment.LEFT,
                    right = rightLines.getOrNull(index),
                    rightPaint = rightPaint,
                ),
            )
        }
    }

    private fun MutableList<RenderRow>.wrap(
        value: String,
        paint: Paint,
        maxWidth: Float,
        align: PrintAlignment,
    ) = wrapText(value, paint, maxWidth).forEach { add(RenderRow.Text(it, paint, align)) }

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

    private fun resolveCell(cell: PrintColumnCell, basePaint: Paint, maxWidth: Float): ResolvedCell {
        return when (cell.overflow) {
            PrintColumnOverflow.FIT -> ResolvedCell(cell.text, fitPaint(basePaint, cell.text, maxWidth))
            PrintColumnOverflow.ELLIPSIS -> {
                if (basePaint.measureText(cell.text) <= maxWidth) {
                    ResolvedCell(cell.text, basePaint)
                } else {
                    val suffix = "…"
                    val suffixWidth = basePaint.measureText(suffix)
                    val count = basePaint.breakText(
                        cell.text,
                        true,
                        (maxWidth - suffixWidth).coerceAtLeast(1f),
                        null,
                    ).coerceAtLeast(0)
                    ResolvedCell(cell.text.take(count).trimEnd() + suffix, basePaint)
                }
            }
        }
    }

    private fun fitPaint(basePaint: Paint, text: String, maxWidth: Float): Paint {
        val measured = basePaint.measureText(text)
        if (measured <= maxWidth || measured <= 0f) return basePaint
        return Paint(basePaint).apply {
            textScaleX = (basePaint.textScaleX * maxWidth / measured).coerceAtMost(basePaint.textScaleX)
            while (measureText(text) > maxWidth && textScaleX > 0.1f) {
                textScaleX *= 0.98f
            }
        }
    }

    private fun paint(
        scale: Float,
        bold: Boolean,
        fontSize: PrintFontSize,
        underline: Boolean,
        align: PrintAlignment,
        compact: Boolean,
    ) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        val minimum = if (compact) 14f else 16f
        textSize = when (fontSize) {
            PrintFontSize.SMALL -> 20f
            PrintFontSize.NORMAL -> 24f
            PrintFontSize.LARGE -> 34f
        }.times(scale).coerceAtLeast(minimum)
        typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
        isUnderlineText = underline
        textAlign = when (align) {
            PrintAlignment.LEFT -> Paint.Align.LEFT
            PrintAlignment.CENTER -> Paint.Align.CENTER
            PrintAlignment.RIGHT -> Paint.Align.RIGHT
        }
    }

    private fun centeredBaseline(top: Float, height: Float, paint: Paint): Float {
        val metrics = paint.fontMetrics
        return top + (height - (metrics.descent - metrics.ascent)) / 2f - metrics.ascent
    }

    private fun PrintPaperWidth.matches(width: PaperWidth) = when (this) {
        PrintPaperWidth.MM58 -> width == PaperWidth.MM_58
        PrintPaperWidth.MM80 -> width == PaperWidth.MM_80
    }

    private sealed interface RenderRow {
        val height: Float

        data class Text(
            val text: String,
            val paint: Paint,
            val align: PrintAlignment,
            val right: String? = null,
            val rightPaint: Paint? = null,
        ) : RenderRow {
            override val height: Float = maxOf(paint.fontSpacing, rightPaint?.fontSpacing ?: 0f)
        }

        data class Columns(val cells: List<RenderedCell>) : RenderRow {
            override val height: Float = cells.maxOf { it.paint.fontSpacing }
        }

        data class Divider(override val height: Float) : RenderRow

        data class BoxedTitle(
            val block: PrintBlock.BoxedTitle,
            val boxWidth: Float,
            val rightWidth: Float,
            val gap: Float,
            val boxPaint: Paint,
            val titlePaint: Paint,
            val subtitlePaint: Paint,
            val rowHeight: Float,
        ) : RenderRow {
            override val height: Float = rowHeight
        }
    }

    private data class RenderedCell(
        val text: String,
        val paint: Paint,
        val bounds: ColumnBounds,
    )

    private data class ResolvedCell(val text: String, val paint: Paint)

    private const val MARGIN_RATIO = 0.052f
    private const val MAX_HEIGHT = 8_000
}
