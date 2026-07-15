package com.yunqiao.life.merchantterminal.connector

data class ConnectorRemoteConfig(
    val merchantPrintingEnabled: Boolean,
    val executionEnabled: Boolean,
    val taskCenterEnabled: Boolean,
    val automaticPrintingEnabled: Boolean,
    val pollIntervalMs: Long,
    val heartbeatIntervalMs: Long,
    val boundPrinterId: String?,
    val boundPrinterChannelType: String?,
    val boundPrinterEnabled: Boolean,
    val configVersion: Long,
    val resetUsbConfigVersion: Long?,
)

data class ClaimedPrintJob(
    val id: String,
    val printerId: String,
    val receiptType: String,
    val source: String,
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
    val contentHash: String,
    val snapshotSchemaVersion: Int,
    /** Semantic JSON from the authenticated server; never treated as raw printer commands. */
    val receiptSnapshotJson: String,
)

data class StartPrintingResult(
    val attemptNo: Int,
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
)

data class LeaseExtensionResult(
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
)

class ConnectorApiException(
    val statusCode: Int,
    val errorCode: String,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    /** HTTP 401 means the shared merchant/staff login has expired or was revoked. */
    val invalidMerchantSession: Boolean
        get() = statusCode == 401 && errorCode in setOf(
            "MERCHANT_SESSION_MISSING",
            "MERCHANT_AUTH_INVALID",
            "UNAUTHORIZED",
            "HTTP_401",
        )
}
