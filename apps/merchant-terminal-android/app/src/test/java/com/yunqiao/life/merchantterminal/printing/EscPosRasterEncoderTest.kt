package com.yunqiao.life.merchantterminal.printing

import com.yunqiao.life.merchantterminal.printing.escpos.AsciiSmokeReceiptEncoder
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.escpos.MonochromeRaster
import com.yunqiao.life.merchantterminal.printing.escpos.PrintWidthValidator
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets

class EscPosRasterEncoderTest {
    @Test
    fun `resolves 58 and 80 millimeter defaults and custom width`() {
        assertEquals(384, PrintWidthValidator.resolve(PaperWidth.MM_58, null))
        assertEquals(576, PrintWidthValidator.resolve(PaperWidth.MM_80, null))
        assertEquals(512, PrintWidthValidator.resolve(PaperWidth.CUSTOM, 512))
    }

    @Test
    fun `rejects unsafe custom widths`() {
        val error = assertThrows(UsbPrinterException::class.java) {
            PrintWidthValidator.resolve(PaperWidth.CUSTOM, 120)
        }
        assertEquals(UsbPrintErrorCode.INVALID_PRINT_WIDTH, error.code)
    }

    @Test
    fun `packs monochrome pixels into esc pos raster bytes`() {
        val raster = MonochromeRaster(
            width = 8,
            height = 1,
            blackPixels = booleanArrayOf(true, false, false, false, false, false, false, true),
        )
        val encoded = EscPosRasterEncoder.encode(raster, CutMode.NONE)

        assertArrayEquals(byteArrayOf(0x1b, 0x40), encoded.copyOfRange(0, 2))
        assertArrayEquals(byteArrayOf(0x1d, 0x76, 0x30, 0x00), encoded.copyOfRange(5, 9))
        assertEquals(0x81.toByte(), encoded[13])
        assertArrayEquals(byteArrayOf(0x0a, 0x0a, 0x0a), encoded.takeLast(3).toByteArray())
    }

    @Test
    fun `cut is opt in and uses selected half or full command`() {
        assertTrue(EscPosRasterEncoder.cutCommand(CutMode.NONE).isEmpty())
        assertArrayEquals(
            byteArrayOf(0x1d, 0x56, 0x01),
            EscPosRasterEncoder.cutCommand(CutMode.HALF),
        )
        assertArrayEquals(
            byteArrayOf(0x1d, 0x56, 0x00),
            EscPosRasterEncoder.cutCommand(CutMode.FULL),
        )
    }

    @Test
    fun `ascii receipt contains no customer data and defaults can omit cut`() {
        val encoded = AsciiSmokeReceiptEncoder.encode(
            deviceModel = "Generic Terminal",
            androidVersion = "13",
            printerVendorId = 1,
            printerProductId = 2,
            timestamp = "2026-07-15 12:00:00 +07:00",
            cutMode = CutMode.NONE,
        )
        val text = String(encoded, StandardCharsets.US_ASCII)

        assertTrue(text.contains("YUNQIAO USB PRINT TEST"))
        assertTrue(text.contains("Printer connection OK"))
        assertFalse(text.contains("customer", ignoreCase = true))
        assertFalse(encoded.takeLast(3).toByteArray().contentEquals(byteArrayOf(0x1d, 0x56, 0x00)))
    }
}
