package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.data.local.LocalPrintingDatabase

internal data class AppliedConnectorRemoteConfig(
    val remote: ConnectorRemoteConfig,
    val settings: ConnectorSettingsSnapshot,
    val capabilityBlockCode: String?,
    val configurationBlockCode: String?,
    val connectionBlockCode: String?,
)

/** Applies the authenticated server authority without changing the retained local USB descriptor. */
internal suspend fun applyConnectorRemoteConfig(
    context: Context,
    settingsStore: ConnectorSettings,
    remote: ConnectorRemoteConfig,
): AppliedConnectorRemoteConfig {
    val app = context.applicationContext
    if (!settingsStore.bindMerchantScopeIfAbsent(remote.merchantId)) {
        settingsStore.applyRemoteConfig(
            merchantPrintingEnabled = remote.merchantPrintingEnabled,
            executionEnabled = false,
            printerConfigured = false,
            printerEnabled = false,
            automaticPrintingEnabled = remote.automaticPrintingEnabled,
            pollIntervalMs = remote.pollIntervalMs,
            configRefreshIntervalMs = remote.configRefreshIntervalMs,
        )
        settingsStore.recordError("MERCHANT_SCOPE_MISMATCH")
        return AppliedConnectorRemoteConfig(
            remote = remote,
            settings = settingsStore.snapshot(),
            capabilityBlockCode = "MERCHANT_SCOPE_MISMATCH",
            configurationBlockCode = null,
            connectionBlockCode = null,
        )
    }

    settingsStore.associatePrinterId(remote.boundPrinterId)
    val dao = LocalPrintingDatabase.get(app).printingDao()
    dao.printerBinding()?.let { localBinding ->
        dao.savePrinterBinding(
            localBinding.copy(
                printerId = remote.boundPrinterId,
                updatedAt = System.currentTimeMillis(),
            ),
        )
    }
    remote.resetUsbConfigVersion?.let { resetVersion ->
        if ((settingsStore.snapshot().appliedConfigVersion ?: -1) < resetVersion) {
            settingsStore.clearUsbBinding()
            dao.clearPrinterBinding()
            settingsStore.markConfigApplied(resetVersion)
        }
    }

    val scopedSettings = settingsStore.snapshot()
    val capabilityBlock = ConnectorPrintExecutionPolicy.capabilityBlockCode(
        remote = remote,
        expectedMerchantId = scopedSettings.merchantId,
    )
    val configurationBlock = ConnectorPrintExecutionPolicy.configurationBlockCode(remote)
    val connectionBlock = ConnectorPrintExecutionPolicy.connectionBlockCode(remote)
    val printerEnabledBlock = ConnectorPrintExecutionPolicy.printerEnabledBlockCode(remote)
    val printerConfigured = configurationBlock == null
    settingsStore.applyRemoteConfig(
        merchantPrintingEnabled = remote.merchantPrintingEnabled,
        executionEnabled = capabilityBlock == null,
        printerConfigured = printerConfigured,
        printerEnabled = printerConfigured && remote.boundPrinterEnabled,
        automaticPrintingEnabled = remote.automaticPrintingEnabled,
        pollIntervalMs = remote.pollIntervalMs,
        configRefreshIntervalMs = remote.configRefreshIntervalMs,
    )
    settingsStore.recordError(
        capabilityBlock
            ?: configurationBlock
            ?: printerEnabledBlock,
    )
    return AppliedConnectorRemoteConfig(
        remote = remote,
        settings = settingsStore.snapshot(),
        capabilityBlockCode = capabilityBlock,
        configurationBlockCode = configurationBlock ?: printerEnabledBlock,
        connectionBlockCode = connectionBlock,
    )
}
