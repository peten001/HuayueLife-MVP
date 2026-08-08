package com.yunqiao.life.merchantterminal.printing.document

import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.receipt.ReceiptDocumentParser
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    private fun documentJson(blocks: String) =
        """
        {
          "documentType":"PRINT_DOCUMENT",
          "schemaVersion":2,
          "paperWidth":"MM80",
          "copies":1,
          "blocks":[$blocks]
        }
        """.trimIndent()
}
