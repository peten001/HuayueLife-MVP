package com.yunqiao.life.merchantterminal.printing.document

import org.json.JSONObject

enum class PrintPaperWidth { MM58, MM80 }
enum class PrintAlignment { LEFT, CENTER, RIGHT }
enum class PrintFontSize { SMALL, NORMAL, LARGE }
enum class PrintCutMode { NONE, HALF, FULL }

sealed interface PrintBlock {
    data class Text(
        val text: String,
        val align: PrintAlignment,
        val bold: Boolean,
        val fontSize: PrintFontSize,
        val underline: Boolean,
    ) : PrintBlock

    data class Row(val left: String, val right: String, val bold: Boolean) : PrintBlock
    data object Divider : PrintBlock
    data class Feed(val lines: Int) : PrintBlock
    data class Cut(val mode: PrintCutMode) : PrintBlock
}

data class PrintDocumentV2(
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
        require(root.optInt("schemaVersion", -1) == 2) { "Unsupported print document schema." }
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
                        "type", "text", "align", "bold", "fontSize", "underline",
                    )
                    PrintBlock.Text(
                        text = block.requiredTextAllowEmpty("text", 2_000),
                        align = enumValueOf(block.requiredText("align", 16)),
                        bold = block.requiredBoolean("bold"),
                        fontSize = enumValueOf(block.requiredText("fontSize", 16)),
                        underline = block.requiredBoolean("underline"),
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
        return PrintDocumentV2(paperWidth, copies, blocks)
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

    private const val MAX_JSON_CHARS = 512_000
}
