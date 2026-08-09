package com.yunqiao.life.merchantterminal.printing.document

import org.json.JSONObject

enum class PrintPaperWidth { MM58, MM80 }
enum class PrintAlignment { LEFT, CENTER, RIGHT }
enum class PrintFontSize { SMALL, NORMAL, LARGE }
enum class PrintCutMode { NONE, HALF, FULL }
enum class PrintColumnOverflow { ELLIPSIS, FIT }

data class PrintColumnCell(
    val text: String,
    val weight: Int,
    val align: PrintAlignment,
    val bold: Boolean,
    val fontSize: PrintFontSize,
    val overflow: PrintColumnOverflow,
    val paddingDots: Int,
)

sealed interface PrintBlock {
    data class Text(
        val text: String,
        val align: PrintAlignment,
        val bold: Boolean,
        val fontSize: PrintFontSize,
        val underline: Boolean,
        val overflow: PrintColumnOverflow?,
    ) : PrintBlock

    data class Row(val left: String, val right: String, val bold: Boolean) : PrintBlock
    data class Columns(val gapDots: Int, val cells: List<PrintColumnCell>) : PrintBlock
    data class BoxedTitle(
        val boxText: String,
        val title: String,
        val subtitle: String,
        val boxWeight: Int,
        val gapDots: Int,
        val fontSize: PrintFontSize,
    ) : PrintBlock
    data object Divider : PrintBlock
    data class Feed(val lines: Int) : PrintBlock
    data class Cut(val mode: PrintCutMode) : PrintBlock
}

data class PrintDocumentV2(
    val schemaVersion: Int,
    val paperWidth: PrintPaperWidth,
    val copies: Int,
    val blocks: List<PrintBlock>,
)

/** Strict presentation-only parser. Raw commands and business fields are rejected. */
object PrintDocumentV2Parser {
    fun parse(json: String): PrintDocumentV2 {
        require(json.length in 2..MAX_JSON_CHARS) { "Print document size is invalid." }
        val root = JSONObject(json)
        root.requireOnly("$", "documentType", "schemaVersion", "paperWidth", "copies", "blocks")
        require(root.requiredText("documentType", 32) == "PRINT_DOCUMENT")
        val schemaVersion = root.optInt("schemaVersion", -1)
        require(schemaVersion == 2 || schemaVersion == 3) { "Unsupported print document schema." }
        val paperWidth = enumValueOf<PrintPaperWidth>(root.requiredText("paperWidth", 8))
        val copies = root.optInt("copies", -1).also { require(it in 1..10) }
        val values = root.optJSONArray("blocks") ?: error("Print blocks are missing.")
        require(values.length() in 1..2_000) { "Print block count is invalid." }
        val blocks = (0 until values.length()).map { index ->
            val block = values.optJSONObject(index) ?: error("Print block is invalid.")
            when (val type = block.requiredText("type", 16)) {
                "TEXT" -> {
                    block.requireOnly(
                        "$.blocks[$index]",
                        *(if (schemaVersion == 3) {
                            arrayOf("type", "text", "align", "bold", "fontSize", "underline", "overflow")
                        } else {
                            arrayOf("type", "text", "align", "bold", "fontSize", "underline")
                        }),
                    )
                    PrintBlock.Text(
                        text = block.requiredTextAllowEmpty("text", 2_000),
                        align = enumValueOf(block.requiredText("align", 16)),
                        bold = block.requiredBoolean("bold"),
                        fontSize = enumValueOf(block.requiredText("fontSize", 16)),
                        underline = block.requiredBoolean("underline"),
                        overflow = block.optString("overflow")
                            .takeIf { schemaVersion == 3 && block.has("overflow") && it.isNotEmpty() }
                            ?.let { enumValueOf<PrintColumnOverflow>(it) },
                    )
                }
                "ROW" -> {
                    block.requireOnly("$.blocks[$index]", "type", "left", "right", "bold")
                    PrintBlock.Row(
                        left = block.requiredTextAllowEmpty("left", 1_000),
                        right = block.requiredTextAllowEmpty("right", 1_000),
                        bold = block.requiredBoolean("bold"),
                    )
                }
                "COLUMNS" -> {
                    require(schemaVersion == 3) { "COLUMNS requires print document schema 3." }
                    block.requireOnly("$.blocks[$index]", "type", "gapDots", "cells")
                    val cellsJson = block.optJSONArray("cells") ?: error("Column cells are missing.")
                    require(cellsJson.length() in 2..4) { "Column cell count is invalid." }
                    val cells = (0 until cellsJson.length()).map { cellIndex ->
                        val cell = cellsJson.optJSONObject(cellIndex) ?: error("Column cell is invalid.")
                        cell.requireOnly(
                            "$.blocks[$index].cells[$cellIndex]",
                            "text", "weight", "align", "bold", "fontSize", "overflow", "paddingDots",
                        )
                        PrintColumnCell(
                            text = cell.requiredTextAllowEmpty("text", 2_000),
                            weight = cell.requiredInt("weight", 1..100),
                            align = enumValueOf(cell.requiredText("align", 16)),
                            bold = cell.requiredBoolean("bold"),
                            fontSize = enumValueOf(cell.requiredText("fontSize", 16)),
                            overflow = enumValueOf(cell.requiredText("overflow", 16)),
                            paddingDots = cell.requiredInt("paddingDots", 0..24),
                        )
                    }
                    PrintBlock.Columns(
                        gapDots = block.requiredInt("gapDots", 0..40),
                        cells = cells,
                    )
                }
                "BOXED_TITLE" -> {
                    require(schemaVersion == 3) { "BOXED_TITLE requires print document schema 3." }
                    block.requireOnly(
                        "$.blocks[$index]",
                        "type", "boxText", "title", "subtitle", "boxWeight", "gapDots", "fontSize",
                    )
                    PrintBlock.BoxedTitle(
                        boxText = block.requiredText("boxText", 64),
                        title = block.requiredText("title", 200),
                        subtitle = block.requiredText("subtitle", 64),
                        boxWeight = block.requiredInt("boxWeight", 10..50),
                        gapDots = block.requiredInt("gapDots", 0..40),
                        fontSize = enumValueOf(block.requiredText("fontSize", 16)),
                    )
                }
                "DIVIDER" -> {
                    block.requireOnly("$.blocks[$index]", "type")
                    PrintBlock.Divider
                }
                "FEED" -> {
                    block.requireOnly("$.blocks[$index]", "type", "lines")
                    PrintBlock.Feed(block.optInt("lines", -1).also { require(it in 1..20) })
                }
                "CUT" -> {
                    block.requireOnly("$.blocks[$index]", "type", "mode")
                    PrintBlock.Cut(enumValueOf(block.requiredText("mode", 8)))
                }
                else -> error("Unsupported print block type: $type")
            }
        }
        require(blocks.count { it is PrintBlock.Cut } <= 1) { "Only one CUT block is supported." }
        require(blocks.indexOfFirst { it is PrintBlock.Cut }.let { it == -1 || it == blocks.lastIndex }) {
            "CUT must be the final print block."
        }
        return PrintDocumentV2(schemaVersion, paperWidth, copies, blocks)
    }

    fun schemaVersion(json: String): Int {
        require(json.length in 2..MAX_JSON_CHARS) { "Print document size is invalid." }
        return JSONObject(json).optInt("schemaVersion", -1)
    }

    private fun JSONObject.requireOnly(path: String, vararg allowed: String) {
        val allowedSet = allowed.toSet()
        val unsupported = keys().asSequence().filterNot(allowedSet::contains).sorted().toList()
        require(unsupported.isEmpty()) {
            "Print document contains unsupported fields at $path: ${unsupported.joinToString(",")}."
        }
    }

    private fun JSONObject.requiredText(key: String, max: Int): String =
        requiredTextAllowEmpty(key, max).also { require(it.isNotEmpty()) }

    private fun JSONObject.requiredTextAllowEmpty(key: String, max: Int): String =
        optString(key).takeIf { has(key) && it.length <= max && !it.contains('\u0000') }
            ?: error("Invalid print text: $key")

    private fun JSONObject.requiredBoolean(key: String): Boolean {
        require(has(key) && get(key) is Boolean) { "Invalid print boolean: $key" }
        return getBoolean(key)
    }

    private fun JSONObject.requiredInt(key: String, range: IntRange): Int {
        require(has(key) && get(key) is Number) { "Invalid print integer: $key" }
        val value = getInt(key)
        require(value in range) { "Print integer is out of range: $key" }
        return value
    }

    private const val MAX_JSON_CHARS = 512_000
}
