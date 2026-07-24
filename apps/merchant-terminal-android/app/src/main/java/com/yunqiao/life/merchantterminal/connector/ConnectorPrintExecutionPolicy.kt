package com.yunqiao.life.merchantterminal.connector

import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot

/**
 * Fail-closed checks shared by the poll loop and the final pre-USB execution path.
 * The server remains authoritative; these checks ensure a stale or malformed response cannot
 * become physical output on the terminal.
 */
object ConnectorPrintExecutionPolicy {
    fun capabilityBlockCode(
        remote: ConnectorRemoteConfig,
        expectedMerchantId: String?,
    ): String? = when {
        !remote.merchantPrintingEnabled -> "PRINTING_NOT_ENABLED"
        !remote.taskCenterEnabled -> "PRINTING_TASK_CENTER_DISABLED"
        !remote.executionEnabled -> "PRINTING_EXECUTION_DISABLED"
        expectedMerchantId != null && remote.merchantId != expectedMerchantId ->
            "MERCHANT_SCOPE_MISMATCH"
        else -> null
    }

    fun configurationBlockCode(
        remote: ConnectorRemoteConfig,
        expectedPrinterId: String? = null,
    ): String? = when {
        remote.boundPrinterId == null -> "USB_PRINTER_NOT_CONFIGURED"
        expectedPrinterId != null && remote.boundPrinterId != expectedPrinterId ->
            "PRINTER_BINDING_MISMATCH"
        remote.boundPrinterChannelType != "LOCAL_USB_ESCPOS" ->
            "PRINT_CHANNEL_NOT_IMPLEMENTED"
        !remote.boundPrinterConnectionConfigValid -> "PRINTER_CONFIG_INVALID"
        else -> null
    }

    fun connectionBlockCode(remote: ConnectorRemoteConfig): String? = when {
        remote.boundPrinterStatus != "ONLINE" -> "PRINTER_STATUS_NOT_READY"
        remote.boundPrinterReadinessState != "READY" -> "PRINTER_READINESS_EXPIRED"
        else -> null
    }

    fun printerEnabledBlockCode(remote: ConnectorRemoteConfig): String? =
        if (remote.boundPrinterEnabled) null else "PRINTER_DISABLED"

    /** Platform/configuration authority only; live USB readiness is evaluated independently. */
    fun remoteBlockCode(
        remote: ConnectorRemoteConfig,
        expectedMerchantId: String?,
        expectedPrinterId: String? = null,
    ): String? = capabilityBlockCode(remote, expectedMerchantId)
        ?: configurationBlockCode(remote, expectedPrinterId)
        ?: printerEnabledBlockCode(remote)

    fun claimedJobBlockCode(
        job: ClaimedPrintJob,
        settings: ConnectorSettingsSnapshot,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): String? {
        val binding = settings.usbBinding
        return when {
            !settings.canExecute -> "LOCAL_EXECUTION_NOT_READY"
            settings.merchantId.isNullOrBlank() -> "MERCHANT_SCOPE_MISSING"
            job.merchantId != settings.merchantId -> "MERCHANT_SCOPE_MISMATCH"
            job.status != "CLAIMED" -> "PRINT_JOB_NOT_CLAIMED"
            binding?.printerId == null -> "USB_BINDING_MISSING"
            binding.printerId != job.printerId -> "PRINTER_BINDING_MISMATCH"
            job.leaseExpiresAt <= nowEpochMs -> "LEASE_EXPIRED"
            else -> null
        }
    }
}
