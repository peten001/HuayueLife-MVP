package com.yunqiao.life.merchantterminal.network

import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding

data class V2BootstrapResponse(
    val merchantId: String,
    val terminalId: String,
    val terminalBearer: String,
    val tokenVersion: Long,
    val tokenExpiresAt: Long,
)

data class V2TerminalConfig(
    val merchantId: String,
    val terminalId: String,
    val merchantPrintingEnabled: Boolean,
    val terminalEnabled: Boolean,
    val executionEnabled: Boolean,
    val automaticCreationEnabled: Boolean,
    val heartbeatSeconds: Long,
    val pollIntervalSeconds: Long,
    val configVersion: Long,
    val printers: List<V2RemotePrinter>,
    val archivedBindings: List<V2ArchivedUsbBinding> = emptyList(),
) {
    val canClaimJobs: Boolean
        get() = merchantPrintingEnabled && terminalEnabled && executionEnabled
}

data class V2LanConfig(
    val terminalEnabled: Boolean,
    val lanPrintingEnabled: Boolean,
    val bindings: List<V2LanRemoteBinding>,
    val archivedBindings: List<V2ArchivedLanBinding>,
)

data class V2LanRemoteBinding(
    val printerId: String,
    val localBindingId: String,
    val bindingVersion: Long,
    val enabled: Boolean,
)

data class V2ArchivedLanBinding(
    val printerId: String,
    val localBindingId: String,
    val bindingVersion: Long,
    val archivedAt: Long,
)

data class V2ArchivedUsbBinding(
    val transport: String,
    val printerId: String,
    val localBindingId: String,
    val bindingVersion: Long,
    val archivedAt: Long,
)

data class V2RemotePrinter(
    val printerId: String,
    val displayName: String,
    val channelType: String,
    val paperWidth: String,
    val enabled: Boolean,
    val status: String,
    val localBindingId: String,
    val bindingVersion: Long,
    val transport: String,
)

data class V2BindingSyncResponse(
    val merchantId: String,
    val terminalId: String,
    val printerId: String,
    val localBindingId: String,
    val bindingVersion: Long,
    val channelType: String,
    val status: String,
    val enabled: Boolean,
    val reportedAt: Long,
)

data class V2RouteIdentity(
    val printerId: String,
    val localBindingId: String,
    val bindingVersion: Long,
    val transport: String = "UNKNOWN",
) {
    init {
        require(NUMERIC_ID.matches(printerId))
        require(localBindingId.length in 1..128)
        require(bindingVersion > 0)
    }

    companion object {
        private val NUMERIC_ID = Regex("^[1-9][0-9]{0,18}$")

        fun from(binding: LocalPrinterBinding): V2RouteIdentity = V2RouteIdentity(
            printerId = requireNotNull(binding.printerId),
            localBindingId = binding.localBindingId,
            bindingVersion = binding.bindingVersion,
            transport = binding.transport.name,
        )
    }
}

data class ClaimedV2PrintJob(
    val id: String,
    val merchantId: String,
    val printerId: String,
    val status: String,
    val receiptType: String,
    val source: String,
    val attemptCount: Int,
    val currentAttemptNo: Int?,
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
    val contentHash: String,
    val snapshotSchemaVersion: Int,
    val receiptSnapshotJson: String,
    val route: V2RouteIdentity,
    val adapter: String,
    val renderProtocol: String? = null,
    val canonicalTemplateVersion: String? = null,
    val renderedPayload: ByteArray? = null,
    val renderedPayloadSha256: String? = null,
    val renderedPayloadByteLength: Int? = null,
    val paperWidthMm: Int? = null,
    val widthDots: Int? = null,
    val payloadTransport: String? = null,
    val artifactPath: String? = null,
) {
    val expectedAttemptNo: Int
        get() = currentAttemptNo ?: attemptCount + 1
}

data class V2StartPrintingResponse(
    val attemptNo: Int,
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
)

data class V2LeaseExtension(
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
)

class V2ApiException(
    val statusCode: Int,
    val errorCode: String,
    val currentBindingVersion: Long? = null,
    val currentPrinterId: String? = null,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    val credentialInvalid: Boolean
        get() = statusCode == 401 || errorCode in setOf(
            "TERMINAL_AUTH_INVALID",
            "TERMINAL_CREDENTIAL_EXPIRED",
            "TERMINAL_DISABLED",
        )

    val bindingConflict: Boolean
        get() = statusCode == 409 && errorCode == "V2_BINDING_VERSION_CONFLICT"
}
