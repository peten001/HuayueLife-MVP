package com.yunqiao.life.merchantterminal.printing.receipt

import android.graphics.Bitmap
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ReceiptDocumentV1Test {
    @Test
    fun `parses and renders text-only controlled multilingual order snapshot`() {
        val receipt = ReceiptDocumentParser.parse(orderJson())
        assertEquals(ReceiptType.ORDER_CUSTOMER, receipt.receiptType)
        assertEquals("Phở bò", receipt.items.single().nameVi)
        assertEquals("YQ:ORDER:20:A-1", receipt.verificationCode)
        val bitmap = ReceiptDocumentRenderer.render(
            receipt,
            ProductionReceiptRenderConfig(
                paperWidth = PaperWidth.MM_58,
                customDots = null,
                jobId = "123",
                contentHash = "a".repeat(64),
                printedAtEpochMs = 1_700_000_000_000,
            ),
        )
        try {
            assertEquals(384, bitmap.width)
            assertEquals("Order height excludes the former QR and Job area.", 775, bitmap.height)
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun `renders text-only table bill context`() {
        val receipt = ReceiptDocumentParser.parse(tableJson())
        assertEquals(ReceiptType.TABLE_BILL, receipt.receiptType)
        assertEquals(listOf("A-1", "A-2"), receipt.tableSession?.orderNos)
        assertEquals(20_000L, receipt.totals.originalAmount)
        assertEquals(3_000L, receipt.totals.roundingAmount)
        assertEquals(17_000L, receipt.totals.receivedAmount)
        assertEquals(17_000L, receipt.totals.total)
        val bitmap = ReceiptDocumentRenderer.render(
            receipt,
            renderConfig(),
        )
        try {
            assertEquals(384, bitmap.width)
            assertEquals("Table height excludes the former QR and Job area.", 671, bitmap.height)
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun `renders opaque server job identifiers without bitmap failure`() {
        val bitmap = ReceiptDocumentRenderer.render(
            ReceiptDocumentParser.parse(orderJson()),
            ProductionReceiptRenderConfig(
                paperWidth = PaperWidth.MM_80,
                customDots = null,
                jobId = "1dce9c92-b8d7-4b7f-bd67-8ce390e7e2ee",
                contentHash = "b".repeat(64),
                printedAtEpochMs = 1_700_000_000_000,
            ),
        )
        try {
            assertEquals(576, bitmap.width)
            assertTrue(bitmap.height > 250)
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun `preserves both footer lines and renders deterministically for order and table receipts`() {
        listOf(
            ReceiptDocumentParser.parse(orderJson()),
            ReceiptDocumentParser.parse(tableJson()),
        ).forEach(::assertFooterLinesAndDeterminism)
    }

    @Test
    fun `rejects unknown fields instead of treating snapshot as commands`() {
        val error = org.junit.Assert.assertThrows(ReceiptSchemaException::class.java) {
            ReceiptDocumentParser.parse(
                orderJson().replace(
                    "\"verificationCode\":",
                    "\"escpos\":\"1b40\",\"verificationCode\":",
                ),
            )
        }

        assertEquals(ReceiptSchemaException.ERROR_CODE, error.code)
        assertEquals("$", error.path)
        assertEquals(listOf("escpos"), error.unsupportedFields)
    }

    @Test
    fun `rejects unrecognized nested fields with a safe schema path`() {
        val error = org.junit.Assert.assertThrows(ReceiptSchemaException::class.java) {
            ReceiptDocumentParser.parse(
                tableJson().replace(
                    "\"currency\":\"VND\"",
                    "\"currency\":\"VND\",\"rawBytes\":\"1b40\"",
                ),
            )
        }

        assertEquals("$.totals", error.path)
        assertEquals(listOf("rawBytes"), error.unsupportedFields)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects a receipt that would be silently truncated by the raster limit`() {
        val item = """{"name":"很长的菜品名称","nameVi":"Tên món ăn rất dài","nameEn":"Very long item name","quantity":1,"unitPrice":1,"lineTotal":1,"specification":"大份","note":"测试备注"}"""
        val oversized = orderJson().replace(
            Regex("\"items\":\\[.*?],\\n"),
            "\"items\":[${List(500) { item }.joinToString(",")}],\n",
        )
        val receipt = ReceiptDocumentParser.parse(oversized)

        ReceiptDocumentRenderer.render(
            receipt,
            ProductionReceiptRenderConfig(
                paperWidth = PaperWidth.MM_80,
                customDots = null,
                jobId = "123",
                contentHash = "a".repeat(64),
                printedAtEpochMs = 1_700_000_000_000,
            ),
        )
    }

    @Test
    fun `rejects a production custom width above the memory bounded profile`() {
        val error = org.junit.Assert.assertThrows(UsbPrinterException::class.java) {
            ReceiptDocumentRenderer.render(
                ReceiptDocumentParser.parse(orderJson()),
                ProductionReceiptRenderConfig(
                    paperWidth = PaperWidth.CUSTOM,
                    customDots = 600,
                    jobId = "123",
                    contentHash = "a".repeat(64),
                    printedAtEpochMs = 1_700_000_000_000,
                ),
            )
        }
        assertEquals(UsbPrintErrorCode.INVALID_PRINT_WIDTH, error.code)
    }

    private fun assertFooterLinesAndDeterminism(receipt: ReceiptDocumentV1) {
        val baseFooter = ReceiptFooter(zh = "Receipt footer A", vi = "Footer line A")
        val first = ReceiptDocumentRenderer.render(receipt.copy(footer = baseFooter), renderConfig())
        val repeated = ReceiptDocumentRenderer.render(receipt.copy(footer = baseFooter), renderConfig())
        val changedZh = ReceiptDocumentRenderer.render(
            receipt.copy(footer = baseFooter.copy(zh = "Receipt footer B")),
            renderConfig(),
        )
        val changedVi = ReceiptDocumentRenderer.render(
            receipt.copy(footer = baseFooter.copy(vi = "Footer line B")),
            renderConfig(),
        )
        try {
            val firstPixels = pixels(first)
            assertEquals(first.width, repeated.width)
            assertEquals(first.height, repeated.height)
            assertArrayEquals(firstPixels, pixels(repeated))
            assertEquals(first.height, changedZh.height)
            assertFalse(firstPixels.contentEquals(pixels(changedZh)))
            assertEquals(first.height, changedVi.height)
            assertFalse(firstPixels.contentEquals(pixels(changedVi)))
        } finally {
            first.recycle()
            repeated.recycle()
            changedZh.recycle()
            changedVi.recycle()
        }
    }

    private fun renderConfig() = ProductionReceiptRenderConfig(
        paperWidth = PaperWidth.MM_58,
        customDots = null,
        jobId = "123",
        contentHash = "a".repeat(64),
        printedAtEpochMs = 1_700_000_000_000,
    )

    private fun pixels(bitmap: Bitmap): IntArray = IntArray(bitmap.width * bitmap.height).also { pixels ->
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    }

    private fun orderJson() = """
        {
          "schemaVersion":1,
          "receiptType":"ORDER_CUSTOMER",
          "generatedAt":"2026-07-15T10:00:00.000Z",
          "merchant":{"id":"10","name":"云桥餐厅","address":"河内","phone":"000"},
          "order":{"id":"20","orderNo":"A-1","orderType":"DINE_IN","tableName":"A01","guestCount":2,"createdAt":"2026-07-15T09:55:00.000Z"},
          "items":[{"name":"牛肉粉","nameVi":"Phở bò","nameEn":"Beef pho","quantity":1,"unitPrice":50000,"lineTotal":50000,"specification":"大份","note":"少辣"}],
          "totals":{"subtotal":50000,"total":50000,"currency":"VND"},
          "note":"少辣",
          "verificationCode":"YQ:ORDER:20:A-1"
        }
    """.trimIndent()

    private fun tableJson() = """
        {
          "schemaVersion":1,
          "receiptType":"TABLE_BILL",
          "generatedAt":"2026-07-15T10:00:00.000Z",
          "merchant":{"id":"10","name":"云桥餐厅"},
          "tableSession":{"id":"30","sessionNo":"TS-1","tableName":"A01","openedAt":"2026-07-15T09:00:00.000Z","orderNos":["A-1","A-2"]},
          "items":[{"name":"茶","quantity":2,"unitPrice":10000,"lineTotal":20000}],
          "totals":{"subtotal":20000,"discount":3000,"originalAmount":20000,"roundingAmount":3000,"receivedAmount":17000,"total":17000,"currency":"VND"}
        }
    """.trimIndent()
}
