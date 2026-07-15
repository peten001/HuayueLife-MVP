package com.yunqiao.life.merchantterminal.printing

import android.graphics.Bitmap
import android.graphics.Color
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.render.QrCodeBitmapRenderer
import com.yunqiao.life.merchantterminal.printing.render.ReceiptRenderConfig
import com.yunqiao.life.merchantterminal.printing.render.SmokeReceiptData
import com.yunqiao.life.merchantterminal.printing.render.SmokeReceiptRenderer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class SmokeReceiptRendererTest {
    private val data = SmokeReceiptData(
        deviceModel = "Android Test Device",
        androidVersion = "13",
        printerVendorId = 1,
        printerProductId = 2,
        timestamp = "2026-07-15 12:00:00 +07:00",
    )

    @Test
    fun `renders nonempty Chinese Vietnamese and English receipt at 58mm`() {
        val bitmap = SmokeReceiptRenderer.render(
            data,
            ReceiptRenderConfig(paperWidth = PaperWidth.MM_58),
        )

        try {
            assertEquals(384, bitmap.width)
            assertTrue(bitmap.height > 200)
            assertTrue(countBlackPixels(bitmap) > 2_000)
            assertTrue(EscPosRasterEncoder.bitmapToRaster(bitmap, 160).blackPixels.any { it })
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun `renders 80mm and custom widths`() {
        val eighty = SmokeReceiptRenderer.render(
            data,
            ReceiptRenderConfig(paperWidth = PaperWidth.MM_80),
        )
        val custom = SmokeReceiptRenderer.render(
            data,
            ReceiptRenderConfig(paperWidth = PaperWidth.CUSTOM, customDots = 512),
        )

        try {
            assertEquals(576, eighty.width)
            assertEquals(512, custom.width)
        } finally {
            eighty.recycle()
            custom.recycle()
        }
    }

    @Test
    fun `qr bitmap contains both black and white modules`() {
        val bitmap = QrCodeBitmapRenderer.render("YUNQIAO-USB-TEST", 160)
        try {
            val colors = pixels(bitmap).toSet()
            assertTrue(Color.BLACK in colors)
            assertTrue(Color.WHITE in colors)
        } finally {
            bitmap.recycle()
        }
    }

    private fun countBlackPixels(bitmap: Bitmap): Int = pixels(bitmap).count { color ->
        Color.red(color) < 128 && Color.green(color) < 128 && Color.blue(color) < 128
    }

    private fun pixels(bitmap: Bitmap): IntArray = IntArray(bitmap.width * bitmap.height).also { pixels ->
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    }
}
