package com.yunqiao.life.merchantterminal

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.yunqiao.life.merchantterminal.network.TerminalV2ApiClient
import com.yunqiao.life.merchantterminal.recovery.V2RecoveryScheduler
import com.yunqiao.life.merchantterminal.runtime.ConnectorRuntimeStatus
import com.yunqiao.life.merchantterminal.runtime.TerminalRuntime
import com.yunqiao.life.merchantterminal.security.TerminalCredential
import com.yunqiao.life.merchantterminal.security.TerminalIdentityStore
import com.yunqiao.life.merchantterminal.security.V2CredentialStore
import com.yunqiao.life.merchantterminal.service.V2PrinterService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class TerminalSessionController(
    context: Context,
    private val api: TerminalV2ApiClient,
    private val identityStore: TerminalIdentityStore,
    private val credentialStore: V2CredentialStore,
) {
    private val applicationContext = context.applicationContext
    private val bootstrapMutex = Mutex()

    suspend fun onMerchantAuthenticated(merchantJwt: String) = withContext(Dispatchers.IO) {
        TerminalRuntime.update(ConnectorRuntimeStatus.STARTING)
        refreshCredential(merchantJwt)
        ContextCompat.startForegroundService(
            applicationContext,
            Intent(applicationContext, V2PrinterService::class.java),
        )
        V2RecoveryScheduler.schedule(applicationContext, "merchant-authenticated")
    }

    /**
     * Re-bootstraps only the terminal bearer from the still-valid Web merchant session. The
     * terminal secret is retained and encrypted; no credential value is returned to Web code.
     */
    suspend fun refreshCredential(merchantJwt: String): TerminalCredential =
        withContext(Dispatchers.IO) {
            bootstrapMutex.withLock {
                val response = api.bootstrap(
                    merchantJwt = merchantJwt,
                    terminalInstanceId = identityStore.terminalInstanceId(),
                    terminalSecret = credentialStore.getOrCreateTerminalSecret(),
                    deviceModel = Build.MODEL.orEmpty().ifBlank { "Android" },
                )
                val credential = TerminalCredential(
                    merchantId = response.merchantId,
                    terminalId = response.terminalId,
                    authorizationScheme = response.authorizationScheme,
                    token = response.token,
                    tokenVersion = response.tokenVersion,
                    tokenExpiresAt = response.tokenExpiresAt,
                    heartbeatSeconds = response.heartbeatSeconds,
                    pollIntervalSeconds = response.pollIntervalSeconds,
                    configVersion = response.configVersion,
                )
                credentialStore.saveCredential(credential)
                TerminalRuntime.update(
                    ConnectorRuntimeStatus.STARTING,
                    merchantId = credential.merchantId,
                )
                credential
            }
        }

    suspend fun onMerchantSignedOut() = withContext(Dispatchers.IO) {
        V2RecoveryScheduler.cancel(applicationContext)
        applicationContext.stopService(Intent(applicationContext, V2PrinterService::class.java))
        credentialStore.clearBearerCredential()
        TerminalRuntime.update(
            ConnectorRuntimeStatus.SESSION_REQUIRED,
            merchantId = null,
            config = null,
        )
    }
}
