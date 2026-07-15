package com.yunqiao.life.merchantterminal.connector

data class PairingRequest(
    val pairingId: String,
    val pairingCode: String,
    val deviceIdentifier: String,
    val name: String,
)

data class PairingResult(
    val terminalId: String,
    val merchantId: String,
    val terminalName: String,
    val token: String,
)

data class ConnectorRemoteConfig(
    val terminalEnabled: Boolean,
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
    /**
     * Connector API contract: only HTTP 401 invalidates the independent terminal credential.
     * A reversible TERMINAL_DISABLED response is HTTP 409 and must retain local pairing.
     */
    val invalidTerminalCredential: Boolean
        get() = statusCode == 401 && errorCode in setOf(
            "TERMINAL_AUTH_INVALID",
            "TERMINAL_CREDENTIAL_MISSING",
            "TERMINAL_REVOKED",
            "TERMINAL_CREDENTIAL_EXPIRED",
            "TERMINAL_CREDENTIAL_ROTATED",
        )
}
