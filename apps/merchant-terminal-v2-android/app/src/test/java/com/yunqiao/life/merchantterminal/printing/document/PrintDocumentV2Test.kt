package com.yunqiao.life.merchantterminal.printing.document

import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.receipt.ReceiptDocumentParser
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PrintDocumentV2Test {
    @Test
    fun `schema 3 parses measured columns and a real boxed title`() {
        val document = PrintDocumentV2Parser.parse(
            documentJson(
                """
                {"type":"BOXED_TITLE","boxText":"A01","title":"结账小票/Hóa đơn thanh toán","subtitle":"TS-20260808-01","boxWeight":24,"gapDots":10,"fontSize":"NORMAL"},
                ${columnsJson("MM80")}
                """.trimIndent(),
                schemaVersion = 3,
            ),
        )

        assertEquals(3, document.schemaVersion)
        assertTrue(document.blocks[0] is PrintBlock.BoxedTitle)
        assertTrue(document.blocks[1] is PrintBlock.Columns)
        val bitmap = PrintDocumentV2Renderer.renderBitmap(document, PaperWidth.MM_80)
        try {
            val margin = (bitmap.width * 0.052f).coerceAtLeast(14f).toInt()
            val darkPixelsOnLeftBorder = (margin until (margin + 55).coerceAtMost(bitmap.height))
                .count { y -> bitmap.getPixel(margin, y) != android.graphics.Color.WHITE }
            assertTrue("A01 border must be drawn with Canvas pixels", darkPixelsOnLeftBorder > 20)
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun `schema 2 rejects schema 3 layout blocks while old blocks remain supported`() {
        assertThrows(IllegalArgumentException::class.java) {
            PrintDocumentV2Parser.parse(documentJson(columnsJson("MM80"), schemaVersion = 2))
        }
        val old = PrintDocumentV2Parser.parse(
            documentJson("""{"type":"ROW","left":"旧任务","right":"98.000 VND","bold":false}"""),
        )
        assertEquals(2, old.schemaVersion)
        assertTrue(PrintDocumentV2Renderer.renderBytes(old, PaperWidth.MM_80).isNotEmpty())
    }

    @Test
    fun `schema 3 one-line text fits while schema 2 rejects the extra field`() {
        val block = """{"type":"TEXT","text":"商家中文名称 / Tên nhà hàng rất dài","align":"CENTER","bold":true,"fontSize":"LARGE","underline":false,"overflow":"FIT"}"""
        val current = PrintDocumentV2Parser.parse(documentJson(block, schemaVersion = 3))

        assertEquals(PrintColumnOverflow.FIT, (current.blocks.single() as PrintBlock.Text).overflow)
        assertTrue(PrintDocumentV2Renderer.renderBytes(current, PaperWidth.MM_80).isNotEmpty())
        assertThrows(IllegalArgumentException::class.java) {
            PrintDocumentV2Parser.parse(documentJson(block, schemaVersion = 2))
        }
    }

    @Test
    fun `80mm measured columns protect numeric cells and ellipsize only the long name`() {
        assertMeasuredProfile(
            paperWidth = PaperWidth.MM_80,
            gapDots = 8,
            weights = listOf(48, 20, 8, 24),
            longName = "招牌酸菜鱼特大份家庭分享装 / Cá dưa đặc biệt phần lớn dành cho gia đình",
        )
    }

    @Test
    fun `58mm measured columns protect numeric cells and keep Vietnamese name full width below`() {
        assertMeasuredProfile(
            paperWidth = PaperWidth.MM_58,
            gapDots = 6,
            weights = listOf(38, 22, 10, 30),
            longName = "招牌酸菜鱼特大份家庭分享装",
        )
        val document = PrintDocumentV2Parser.parse(
            documentJson(
                """
                ${columnsJson("MM58")},
                {"type":"COLUMNS","gapDots":6,"cells":[
                  {"text":"招牌酸菜鱼特大份家庭分享装","weight":38,"align":"LEFT","bold":false,"fontSize":"SMALL","overflow":"ELLIPSIS","paddingDots":0},
                  {"text":"12.345.678","weight":22,"align":"RIGHT","bold":false,"fontSize":"SMALL","overflow":"FIT","paddingDots":0},
                  {"text":"1","weight":10,"align":"CENTER","bold":false,"fontSize":"SMALL","overflow":"FIT","paddingDots":0},
                  {"text":"12.345.678","weight":30,"align":"RIGHT","bold":false,"fontSize":"SMALL","overflow":"FIT","paddingDots":0}
                ]},
                {"type":"TEXT","text":"Cá dưa đặc biệt phần lớn dành cho gia đình và bạn bè","align":"LEFT","bold":false,"fontSize":"SMALL","underline":false}
                """.trimIndent(),
                schemaVersion = 3,
                paperWidth = "MM58",
            ),
        )
        assertTrue(document.blocks[1] is PrintBlock.Columns)
        assertEquals(
            "Cá dưa đặc biệt phần lớn dành cho gia đình và bạn bè",
            (document.blocks[2] as PrintBlock.Text).text,
        )
        assertTrue(PrintDocumentV2Renderer.renderBytes(document, PaperWidth.MM_58).isNotEmpty())
    }

    @Test
    fun `58mm boxed title fits the exact bilingual title on one physical line`() {
        val contentWidth = PrintDocumentV2Renderer.contentWidthDots(PaperWidth.MM_58)
        val gap = 6f
        val boxWidth = (contentWidth - gap) * 0.28f
        val titleWidth = contentWidth - gap - boxWidth
        val measured = PrintDocumentV2Renderer.measureFittedText(
            "结账小票/Hóa đơn thanh toán",
            PrintFontSize.SMALL,
            PaperWidth.MM_58,
            titleWidth,
        )

        assertEquals("结账小票/Hóa đơn thanh toán", measured.renderedText)
        assertTrue(measured.measuredWidth <= titleWidth + 0.1f)
    }

    @Test
    fun `parses and renders ordinary rounding rows without business fields`() {
        val document = PrintDocumentV2Parser.parse(
            documentJson(
                """
                {"type":"ROW","left":"小计","right":"513,000 VND","bold":false},
                {"type":"ROW","left":"抹零","right":"-3,000 VND","bold":false},
                {"type":"ROW","left":"最终应收","right":"510,000 VND","bold":true}
                """.trimIndent(),
            ),
        )

        assertEquals(3, document.blocks.size)
        val bytes = PrintDocumentV2Renderer.renderBytes(document, PaperWidth.MM_80)
        assertTrue(bytes.isNotEmpty())
    }

    @Test
    fun `future discount and server-only wording are ordinary row text`() {
        val discount = PrintDocumentV2Parser.parse(
            documentJson(
                """
                {"type":"ROW","left":"小计","right":"828,000 VND","bold":false},
                {"type":"ROW","left":"折扣（9折）","right":"-82,800 VND","bold":false},
                {"type":"ROW","left":"抹零","right":"-5,200 VND","bold":false},
                {"type":"ROW","left":"最终应收","right":"740,000 VND","bold":true}
                """.trimIndent(),
            ),
        )
        val renamed = PrintDocumentV2Parser.parse(
            documentJson(
                """
                {"type":"ROW","left":"小计","right":"828,000 VND","bold":false},
                {"type":"ROW","left":"优惠 10%","right":"-82,800 VND","bold":false},
                {"type":"ROW","left":"抹零","right":"-5,200 VND","bold":false},
                {"type":"ROW","left":"最终应收","right":"740,000 VND","bold":true}
                """.trimIndent(),
            ),
        )

        assertEquals("折扣（9折）", (discount.blocks[1] as PrintBlock.Row).left)
        assertEquals("优惠 10%", (renamed.blocks[1] as PrintBlock.Row).left)
        assertFalse(
            PrintDocumentV2Renderer.renderBytes(discount, PaperWidth.MM_80).contentEquals(
                PrintDocumentV2Renderer.renderBytes(renamed, PaperWidth.MM_80),
            ),
        )
    }

    @Test
    fun `renders kitchen and Chinese Vietnamese text exactly as supplied`() {
        val document = PrintDocumentV2Parser.parse(
            documentJson(
                """
                {"type":"TEXT","text":"牛肉粉 / Phở bò","align":"LEFT","bold":true,"fontSize":"LARGE","underline":false},
                {"type":"ROW","left":"数量 / Số lượng","right":"2","bold":true},
                {"type":"TEXT","text":"备注 / Ghi chú: 少辣","align":"LEFT","bold":false,"fontSize":"NORMAL","underline":false}
                """.trimIndent(),
            ),
        )

        assertEquals("牛肉粉 / Phở bò", (document.blocks[0] as PrintBlock.Text).text)
        assertEquals("数量 / Số lượng", (document.blocks[1] as PrintBlock.Row).left)
        assertEquals("备注 / Ghi chú: 少辣", (document.blocks[2] as PrintBlock.Text).text)
        assertTrue(PrintDocumentV2Renderer.renderBytes(document, PaperWidth.MM_80).isNotEmpty())
    }

    @Test
    fun `rejects business semantics and raw command fields`() {
        assertThrows(IllegalArgumentException::class.java) {
            PrintDocumentV2Parser.parse(
                documentJson(
                    """{"type":"ROW","left":"小计","right":"1 VND","bold":false,"discountAmount":1}""",
                ),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            PrintDocumentV2Parser.parse(
                documentJson(
                    """{"type":"TEXT","text":"x","align":"LEFT","bold":false,"fontSize":"NORMAL","underline":false,"escpos":"1b40"}""",
                ),
            )
        }
    }

    @Test
    fun `rendering is deterministic for a shared USB and LAN document`() {
        val document = PrintDocumentV2Parser.parse(
            documentJson(
                """{"type":"TEXT","text":"同一份内容 / Cùng nội dung","align":"CENTER","bold":true,"fontSize":"NORMAL","underline":false}""",
            ),
        )
        val usbBytes = PrintDocumentV2Renderer.renderBytes(document, PaperWidth.MM_80)
        val lanBytes = PrintDocumentV2Renderer.renderBytes(document, PaperWidth.MM_80)
        assertArrayEquals(usbBytes, lanBytes)
    }

    @Test
    fun `historical Receipt V1 parser remains available`() {
        val receipt = ReceiptDocumentParser.parse(
            """
            {
              "schemaVersion":1,
              "receiptType":"ORDER_CUSTOMER",
              "generatedAt":"2026-08-07T10:00:00.000Z",
              "merchant":{"id":"11","name":"花悦餐厅"},
              "order":{"id":"20","orderNo":"A-1","orderType":"DINE_IN","createdAt":"2026-08-07T09:55:00.000Z"},
              "items":[{"name":"茶","quantity":1,"unitPrice":10000,"lineTotal":10000}],
              "totals":{"subtotal":10000,"discount":3000,"roundingAmount":3000,"total":7000,"currency":"VND"}
            }
            """.trimIndent(),
        )
        assertEquals(3_000L, receipt.totals.discount)
        assertEquals(3_000L, receipt.totals.roundingAmount)
    }

    private fun assertMeasuredProfile(
        paperWidth: PaperWidth,
        gapDots: Int,
        weights: List<Int>,
        longName: String,
    ) {
        val cells = listOf(
            PrintColumnCell(longName, weights[0], PrintAlignment.LEFT, false, PrintFontSize.SMALL, PrintColumnOverflow.ELLIPSIS, 0),
            PrintColumnCell("123.456.789", weights[1], PrintAlignment.RIGHT, false, PrintFontSize.SMALL, PrintColumnOverflow.FIT, 0),
            PrintColumnCell("999", weights[2], PrintAlignment.CENTER, false, PrintFontSize.SMALL, PrintColumnOverflow.FIT, 0),
            PrintColumnCell("123.456.789", weights[3], PrintAlignment.RIGHT, false, PrintFontSize.SMALL, PrintColumnOverflow.FIT, 0),
        )
        val bounds = ColumnLayoutCalculator.resolve(
            PrintDocumentV2Renderer.contentWidthDots(paperWidth),
            gapDots,
            cells,
        )
        bounds.zipWithNext().forEach { (left, right) -> assertTrue(left.right < right.left) }
        cells.zip(bounds).forEachIndexed { index, (cell, bound) ->
            val measured = PrintDocumentV2Renderer.measureColumnCell(cell, paperWidth, bound.contentWidth)
            assertTrue(
                "cell $index measured=${measured.measuredWidth} available=${measured.availableWidth} scale=${measured.textScaleX} text=${measured.renderedText}",
                measured.measuredWidth <= measured.availableWidth + 0.1f,
            )
            if (index == 0) {
                assertTrue(measured.renderedText.endsWith('…'))
                assertNotEquals(cell.text, measured.renderedText)
            } else {
                assertEquals(cell.text, measured.renderedText)
            }
        }

        val headerCells = listOf("Món", "Đơn giá", "SL", "Thành tiền").mapIndexed { index, value ->
            PrintColumnCell(value, weights[index], PrintAlignment.LEFT, true, PrintFontSize.SMALL, PrintColumnOverflow.FIT, 0)
        }
        headerCells.zip(bounds).forEach { (cell, bound) ->
            val measured = PrintDocumentV2Renderer.measureColumnCell(cell, paperWidth, bound.contentWidth)
            assertEquals(cell.text, measured.renderedText)
            assertTrue(measured.measuredWidth <= measured.availableWidth + 0.1f)
        }
    }

    private fun columnsJson(paperWidth: String): String {
        val gap = if (paperWidth == "MM58") 6 else 8
        val weights = if (paperWidth == "MM58") listOf(38, 22, 10, 30) else listOf(48, 20, 8, 24)
        return """
          {"type":"COLUMNS","gapDots":$gap,"cells":[
            {"text":"Món","weight":${weights[0]},"align":"LEFT","bold":true,"fontSize":"SMALL","overflow":"FIT","paddingDots":0},
            {"text":"Đơn giá","weight":${weights[1]},"align":"RIGHT","bold":true,"fontSize":"SMALL","overflow":"FIT","paddingDots":0},
            {"text":"SL","weight":${weights[2]},"align":"CENTER","bold":true,"fontSize":"SMALL","overflow":"FIT","paddingDots":0},
            {"text":"Thành tiền","weight":${weights[3]},"align":"RIGHT","bold":true,"fontSize":"SMALL","overflow":"FIT","paddingDots":0}
          ]}
        """.trimIndent()
    }

    private fun documentJson(
        blocks: String,
        schemaVersion: Int = 2,
        paperWidth: String = "MM80",
    ) =
        """
        {
          "documentType":"PRINT_DOCUMENT",
          "schemaVersion":$schemaVersion,
          "paperWidth":"$paperWidth",
          "copies":1,
          "blocks":[$blocks]
        }
        """.trimIndent()
}
