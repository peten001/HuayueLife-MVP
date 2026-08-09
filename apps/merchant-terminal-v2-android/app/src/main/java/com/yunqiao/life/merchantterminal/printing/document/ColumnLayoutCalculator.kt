package com.yunqiao.life.merchantterminal.printing.document

internal data class ColumnBounds(
    val left: Float,
    val right: Float,
    val contentLeft: Float,
    val contentRight: Float,
) {
    val contentWidth: Float get() = contentRight - contentLeft
}

/** Resolves weighted receipt columns in printer dots, reserving real gaps between cells. */
internal object ColumnLayoutCalculator {
    fun resolve(
        contentWidth: Float,
        gapDots: Int,
        cells: List<PrintColumnCell>,
    ): List<ColumnBounds> {
        require(cells.size in 2..4)
        val gapTotal = gapDots.toFloat() * (cells.size - 1)
        require(contentWidth > gapTotal)
        val weightedWidth = contentWidth - gapTotal
        val totalWeight = cells.sumOf { it.weight }.toFloat()
        var left = 0f
        var allocated = 0f
        return cells.mapIndexed { index, cell ->
            val width = if (index == cells.lastIndex) {
                weightedWidth - allocated
            } else {
                weightedWidth * cell.weight / totalWeight
            }
            val right = left + width
            val padding = cell.paddingDots.toFloat().coerceAtMost(width / 2f)
            ColumnBounds(
                left = left,
                right = right,
                contentLeft = left + padding,
                contentRight = right - padding,
            ).also {
                allocated += width
                left = right + gapDots
            }
        }
    }
}
