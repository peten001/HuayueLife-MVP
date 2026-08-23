package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.network.ClaimedV2PrintJob

object CanonicalServerPayload {
    private const val PROTOCOL = "ESC_POS_RASTER_V1"
    private const val TEMPLATE = "YQ_CANONICAL_RECEIPT_V1"

    fun forJob(job: ClaimedV2PrintJob, expectedWidthDots: Int): ByteArray? =
        when (job.renderProtocol) {
            null -> null
            PROTOCOL -> {
                require(job.canonicalTemplateVersion == TEMPLATE) {
                    "Canonical template version is unsupported."
                }
                require(job.widthDots == expectedWidthDots) {
                    "Canonical payload profile mismatch."
                }
                requireNotNull(job.renderedPayload) {
                    "Canonical payload is missing."
                }.copyOf()
            }
            else -> error("Unsupported server render protocol: ${job.renderProtocol}")
        }
}
