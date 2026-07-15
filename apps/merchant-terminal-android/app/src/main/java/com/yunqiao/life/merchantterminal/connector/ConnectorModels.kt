package com.yunqiao.life.merchantterminal.connector

data class ConnectorRemoteConfig(
    val merchantId: String,
    val merchantPrintingEnabled: Boolean,
    val executionEnabled: Boolean,
    val taskCenterEnabled: Boolean,
    val automaticPrintingEnabled: Boolean,
    val pollIntervalMs: Long,
    val configRefreshIntervalMs: Long,
    val boundPrinterId: String?,
    val boundPrinterChannelType: String?,
    val boundPrinterEnabled: Boolean,
    val boundPrinterStatus: String?,
    val boundPrinterReadinessState: String?,
    val boundPrinterConnectionConfigValid: Boolean,
    val configVersion: Long,
    val resetUsbConfigVersion: Long?,
)

data class ClaimedPrintJob(
    val id: String,
    val merchantId: String,
    val printerId: String,
    val status: String,
    val receiptType: String,
    val source: String,
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
    val contentHash: String,
    val snapshotSchemaVersion: Int,
    /** Semantic JSON from the authenticated server; never treated as raw printer commands. */
    val receiptSnapshotJson: String,
)

data class UsbReadinessEvidence(
    val usbDeviceRecognized: Boolean,
    val usbPermissionGranted: Boolean,
    val usbInterfaceValid: Boolean,
    val usbEndpointValid: Boolean,
    val appExecutionReady: Boolean,
) {
    val isReady: Boolean
        get() = usbDeviceRecognized && usbPermissionGranted && usbInterfaceValid &&
            usbEndpointValid && appExecutionReady
}

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
    /** 401 or a live staff-scope 403 means the shared merchant/staff access is no longer usable. */
    val invalidMerchantSession: Boolean
        get() = (statusCode == 401 && errorCode in setOf(
            "MERCHANT_SESSION_MISSING",
            "MERCHANT_AUTH_INVALID",
            "UNAUTHORIZED",
            "HTTP_401",
        )) || (statusCode == 403 && errorCode in setOf(
            "MERCHANT_AUTH_INVALID",
            "MERCHANT_STAFF_DISABLED",
            "FORBIDDEN",
            "HTTP_403",
        ))

    val printingDisabled: Boolean
        get() = errorCode in setOf(
            "PRINTING_NOT_ENABLED",
            "MERCHANT_PRINTING_DISABLED",
            "PRINTING_TASK_CENTER_DISABLED",
            "PRINTING_EXECUTION_DISABLED",
        )
}
