package com.yunqiao.life.merchantterminal.printing.receipt

import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReceiptDocumentV1Test {
    @Test
    fun `parses and renders controlled multilingual order snapshot`() {
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
            assertTrue(bitmap.height > 250)
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun `supports table bill context`() {
        val receipt = ReceiptDocumentParser.parse(tableJson())
        assertEquals(ReceiptType.TABLE_BILL, receipt.receiptType)
        assertEquals(listOf("A-1", "A-2"), receipt.tableSession?.orderNos)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects unknown fields instead of treating snapshot as commands`() {
        ReceiptDocumentParser.parse(orderJson().replace("\"note\":\"少辣\"", "\"note\":\"少辣\",\"escpos\":\"1b40\""))
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
          "totals":{"subtotal":20000,"total":20000,"currency":"VND"}
        }
    """.trimIndent()
}
