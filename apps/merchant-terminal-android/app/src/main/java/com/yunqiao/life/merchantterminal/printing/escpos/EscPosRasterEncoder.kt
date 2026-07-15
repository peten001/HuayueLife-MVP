package com.yunqiao.life.merchantterminal.printing.escpos

import android.graphics.Bitmap
import android.graphics.Color
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

data class MonochromeRaster(
    val width: Int,
    val height: Int,
    val blackPixels: BooleanArray,
) {
    init {
        require(width > 0 && height > 0) { "Raster dimensions must be positive." }
        require(blackPixels.size == width * height) { "Raster pixel count does not match dimensions." }
    }

    operator fun get(x: Int, y: Int): Boolean = blackPixels[y * width + x]
}

object PrintWidthValidator {
    const val MIN_PRINT_DOTS = 200
    const val MAX_PRINT_DOTS = 1_024

    fun resolve(paperWidth: PaperWidth, customDots: Int?): Int {
        val dots = if (paperWidth == PaperWidth.CUSTOM) customDots else paperWidth.defaultDots
        if (dots == null || dots !in MIN_PRINT_DOTS..MAX_PRINT_DOTS) {
            throw UsbPrinterException(
                UsbPrintErrorCode.INVALID_PRINT_WIDTH,
                "Print width must be $MIN_PRINT_DOTS..$MAX_PRINT_DOTS dots.",
            )
        }
        return dots
    }
}

object EscPosRasterEncoder {
    fun bitmapToRaster(bitmap: Bitmap, threshold: Int): MonochromeRaster {
        require(threshold in 0..255) { "Image threshold must be 0..255." }
        val width = bitmap.width
        val height = bitmap.height
        if (width !in PrintWidthValidator.MIN_PRINT_DOTS..PrintWidthValidator.MAX_PRINT_DOTS ||
            height !in 1..MAX_RASTER_HEIGHT
        ) {
            throw UsbPrinterException(
                UsbPrintErrorCode.INVALID_PRINT_WIDTH,
                "Bitmap dimensions are outside the supported diagnostic range.",
            )
        }
        val colors = IntArray(width * height)
        bitmap.getPixels(colors, 0, width, 0, 0, width, height)
        val blackPixels = BooleanArray(colors.size)
        colors.forEachIndexed { index, color ->
            val alpha = Color.alpha(color)
            val red = compositeOnWhite(Color.red(color), alpha)
            val green = compositeOnWhite(Color.green(color), alpha)
            val blue = compositeOnWhite(Color.blue(color), alpha)
            val luminance = (red * 299 + green * 587 + blue * 114) / 1_000
            blackPixels[index] = luminance <= threshold
        }
        return MonochromeRaster(width, height, blackPixels)
    }

    fun encode(raster: MonochromeRaster, cutMode: CutMode): ByteArray {
        if (raster.width > PrintWidthValidator.MAX_PRINT_DOTS || raster.height > MAX_RASTER_HEIGHT) {
            throw UsbPrinterException(
                UsbPrintErrorCode.INVALID_PRINT_WIDTH,
                "Raster is too large for this diagnostic encoder.",
            )
        }
        val bytesPerRow = (raster.width + 7) / 8
        val output = ByteArrayOutputStream(16 + bytesPerRow * raster.height)
        writePreamble(output)
        for (stripStart in 0 until raster.height step RASTER_STRIP_HEIGHT) {
            val stripRows = minOf(RASTER_STRIP_HEIGHT, raster.height - stripStart)
            writeRasterHeader(output, bytesPerRow, stripRows)
            for (y in stripStart until stripStart + stripRows) {
                for (byteIndex in 0 until bytesPerRow) {
                    var packed = 0
                    for (bit in 0 until 8) {
                        val x = byteIndex * 8 + bit
                        if (x < raster.width && raster[x, y]) packed = packed or (0x80 ushr bit)
                    }
                    output.write(packed)
                }
            }
        }
        writeFooter(output, cutMode)
        return output.toByteArray()
    }

    /**
     * Memory-bounded production path: reads one bitmap row at a time and emits <=256-row raster
     * strips. Cheap ESC/POS firmware need not buffer one giant image block, and no full-size
     * IntArray/BooleanArray duplicates the ARGB bitmap.
     */
    fun encodeBitmap(bitmap: Bitmap, threshold: Int, cutMode: CutMode): ByteArray {
        require(threshold in 0..255) { "Image threshold must be 0..255." }
        val width = bitmap.width
        val height = bitmap.height
        if (width !in PrintWidthValidator.MIN_PRINT_DOTS..PrintWidthValidator.MAX_PRINT_DOTS ||
            height !in 1..MAX_RASTER_HEIGHT
        ) {
            throw UsbPrinterException(
                UsbPrintErrorCode.INVALID_PRINT_WIDTH,
                "Bitmap dimensions are outside the supported raster range.",
            )
        }
        val bytesPerRow = (width + 7) / 8
        val output = ByteArrayOutputStream(16 + bytesPerRow * height)
        val row = IntArray(width)
        writePreamble(output)
        for (stripStart in 0 until height step RASTER_STRIP_HEIGHT) {
            val stripRows = minOf(RASTER_STRIP_HEIGHT, height - stripStart)
            writeRasterHeader(output, bytesPerRow, stripRows)
            for (y in stripStart until stripStart + stripRows) {
                bitmap.getPixels(row, 0, width, 0, y, width, 1)
                for (byteIndex in 0 until bytesPerRow) {
                    var packed = 0
                    for (bit in 0 until 8) {
                        val x = byteIndex * 8 + bit
                        if (x < width && isBlack(row[x], threshold)) {
                            packed = packed or (0x80 ushr bit)
                        }
                    }
                    output.write(packed)
                }
            }
        }
        writeFooter(output, cutMode)
        return output.toByteArray()
    }

    fun cutCommand(cutMode: CutMode): ByteArray = when (cutMode) {
        CutMode.NONE -> ByteArray(0)
        CutMode.HALF -> byteArrayOf(GS, CUT, 1)
        CutMode.FULL -> byteArrayOf(GS, CUT, 0)
    }

    private fun compositeOnWhite(channel: Int, alpha: Int): Int =
        (channel * alpha + 255 * (255 - alpha)) / 255

    private fun isBlack(color: Int, threshold: Int): Boolean {
        val alpha = Color.alpha(color)
        val red = compositeOnWhite(Color.red(color), alpha)
        val green = compositeOnWhite(Color.green(color), alpha)
        val blue = compositeOnWhite(Color.blue(color), alpha)
        return (red * 299 + green * 587 + blue * 114) / 1_000 <= threshold
    }

    private fun writePreamble(output: ByteArrayOutputStream) {
        output.write(ESC_INIT)
        output.write(ALIGN_CENTER)
    }

    private fun writeRasterHeader(
        output: ByteArrayOutputStream,
        bytesPerRow: Int,
        rows: Int,
    ) {
        output.write(
            byteArrayOf(
                GS,
                RASTER_PRINT,
                RASTER_COMMAND_ZERO,
                0,
                (bytesPerRow and 0xff).toByte(),
                ((bytesPerRow ushr 8) and 0xff).toByte(),
                (rows and 0xff).toByte(),
                ((rows ushr 8) and 0xff).toByte(),
            ),
        )
    }

    private fun writeFooter(output: ByteArrayOutputStream, cutMode: CutMode) {
        output.write(FEED_AFTER_DOCUMENT)
        output.write(cutCommand(cutMode))
    }

    private const val MAX_RASTER_HEIGHT = 8_000
    private const val RASTER_STRIP_HEIGHT = 256
    private const val GS: Byte = 0x1d
    private const val RASTER_PRINT: Byte = 0x76
    private const val RASTER_COMMAND_ZERO: Byte = 0x30
    private const val CUT: Byte = 0x56
    private val ESC_INIT = byteArrayOf(0x1b, 0x40)
    private val ALIGN_CENTER = byteArrayOf(0x1b, 0x61, 0x01)
    private val FEED_AFTER_DOCUMENT = byteArrayOf(0x0a, 0x0a, 0x0a)
}

object AsciiSmokeReceiptEncoder {
    fun encode(
        deviceModel: String,
        androidVersion: String,
        printerVendorId: Int,
        printerProductId: Int,
        timestamp: String,
        cutMode: CutMode,
    ): ByteArray {
        val body = buildString {
            appendLine("YUNQIAO USB PRINT TEST")
            appendLine("--------------------------------")
            appendLine("Device Model: ${deviceModel.toSafeAscii()}")
            appendLine("Android: ${androidVersion.toSafeAscii()}")
            appendLine("Printer VID: $printerVendorId")
            appendLine("Printer PID: $printerProductId")
            appendLine("Time: ${timestamp.toSafeAscii()}")
            appendLine()
            appendLine("ASCII: 1234567890")
            appendLine("English: Printer connection OK")
            appendLine("Vietnamese ASCII: Xin chao - Cam on")
            appendLine("--------------------------------")
            appendLine("END")
            appendLine()
            appendLine()
            appendLine()
        }.toByteArray(StandardCharsets.US_ASCII)
        return ESC_INIT + ALIGN_LEFT + body + EscPosRasterEncoder.cutCommand(cutMode)
    }

    private fun String.toSafeAscii(): String = buildString(length) {
        this@toSafeAscii.forEach { character ->
            append(if (character.code in 32..126) character else '?')
        }
    }

    private val ESC_INIT = byteArrayOf(0x1b, 0x40)
    private val ALIGN_LEFT = byteArrayOf(0x1b, 0x61, 0x00)
}
