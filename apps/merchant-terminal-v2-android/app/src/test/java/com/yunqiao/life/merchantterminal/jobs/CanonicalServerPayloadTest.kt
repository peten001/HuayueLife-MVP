package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.network.ClaimedV2PrintJob
import com.yunqiao.life.merchantterminal.network.V2RouteIdentity
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class CanonicalServerPayloadTest {
    @Test
    fun canonicalJobReturnsAnUnmodifiedCopyWithoutLocalLayout() {
        val payload = byteArrayOf(0x1b, 0x40, 0x1d, 0x56, 0x01)
        val job = job(renderProtocol = "ESC_POS_RASTER_V1", payload = payload)

        val received = CanonicalServerPayload.forJob(job, 576)

        assertArrayEquals(payload, received)
        assertNotSame(payload, received)
    }

    @Test
    fun legacyJobIsTheOnlyPathAllowedToReachTheLegacyRenderer() {
        assertNull(CanonicalServerPayload.forJob(job(renderProtocol = null), 576))
    }

    @Test
    fun unsupportedProtocolAndProfileMismatchAreRejected() {
        assertThrows(IllegalStateException::class.java) {
            CanonicalServerPayload.forJob(job(renderProtocol = "FUTURE_LAYOUT_V9"), 576)
        }
        assertThrows(IllegalArgumentException::class.java) {
            CanonicalServerPayload.forJob(
                job(renderProtocol = "ESC_POS_RASTER_V1", payload = byteArrayOf(1)),
                384,
            )
        }
    }

    private fun job(renderProtocol: String?, payload: ByteArray? = null) = ClaimedV2PrintJob(
        id = "1",
        merchantId = "4",
        printerId = "39",
        status = "CLAIMED",
        receiptType = "TABLE_BILL",
        source = "AUTOMATIC",
        attemptCount = 0,
        currentAttemptNo = null,
        leaseVersion = 1,
        leaseExpiresAt = 1,
        contentHash = "a".repeat(64),
        snapshotSchemaVersion = 3,
        receiptSnapshotJson = "{}",
        route = V2RouteIdentity("39", "binding", 1, "USB"),
        adapter = "ANDROID_USB_ESCPOS",
        renderProtocol = renderProtocol,
        canonicalTemplateVersion = "YQ_CANONICAL_RECEIPT_V1",
        renderedPayload = payload,
        renderedPayloadSha256 = "b".repeat(64),
        renderedPayloadByteLength = payload?.size,
        paperWidthMm = 80,
        widthDots = 576,
    )
}
