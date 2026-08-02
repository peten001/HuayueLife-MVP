package com.yunqiao.life.merchantterminal

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.yunqiao.life.merchantterminal.network.TerminalV2ApiClient
import com.yunqiao.life.merchantterminal.recovery.V2RecoveryScheduler
import com.yunqiao.life.merchantterminal.runtime.ConnectorRuntimeStatus
import com.yunqiao.life.merchantterminal.runtime.ConnectorSessionGate
import com.yunqiao.life.merchantterminal.runtime.StartupTrace
import com.yunqiao.life.merchantterminal.runtime.TerminalRuntime
import com.yunqiao.life.merchantterminal.security.TerminalCredential
import com.yunqiao.life.merchantterminal.security.TerminalIdentityStore
import com.yunqiao.life.merchantterminal.security.MerchantSessionStopReason
import com.yunqiao.life.merchantterminal.security.V2CredentialStore
import com.yunqiao.life.merchantterminal.service.V2PrinterService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicLong

class TerminalSessionController(
    context: Context,
    private val api: TerminalV2ApiClient,
    private val identityStore: TerminalIdentityStore,
    private val credentialStore: V2CredentialStore,
) {
    private val applicationContext = context.applicationContext
    private val bootstrapMutex = Mutex()
    private val sessionMutex = Mutex()
    private val sessionEpoch = AtomicLong(0)

    suspend fun onMerchantAuthenticated(merchantJwt: String) = withContext(Dispatchers.IO) {
        sessionMutex.withLock {
            ConnectorSessionGate.allow()
            TerminalRuntime.update(ConnectorRuntimeStatus.STARTING)
            val merchantId = api.merchantIdFromMerchantJwt(merchantJwt)
            val credential = credentialStore.readCredential()?.takeIf(TerminalCredential::isUsable)
            if (credential == null || credential.merchantId != merchantId) {
                refreshCredential(merchantJwt)
            } else {
                StartupTrace.event("TERMINAL_CREDENTIAL_RESTORED")
            }
            requestConnectorServiceStart()
            V2RecoveryScheduler.schedule(applicationContext, "merchant-authenticated")
        }
    }

    fun requestConnectorServiceStart() {
        StartupTrace.event("CONNECTOR_SERVICE_START_REQUESTED")
        ContextCompat.startForegroundService(
            applicationContext,
            Intent(applicationContext, V2PrinterService::class.java),
        )
    }

    /**
     * Re-bootstraps only the terminal bearer from the still-valid Web merchant session. The
     * terminal secret is retained and encrypted; no credential value is returned to Web code.
     */
    suspend fun refreshCredential(merchantJwt: String): TerminalCredential =
        withContext(Dispatchers.IO) {
            bootstrapMutex.withLock {
                val bootstrapEpoch = sessionEpoch.get()
                try {
                    StartupTrace.event("BOOTSTRAP_START")
                    val response = api.bootstrap(
                        merchantJwt = merchantJwt,
                        terminalInstanceId = identityStore.terminalInstanceId(),
                        terminalSecret = credentialStore.getOrCreateTerminalSecret(),
                        deviceModel = Build.MODEL.orEmpty().ifBlank { "Android" },
                    )
                    val credential = TerminalCredential(
                        merchantId = response.merchantId,
                        terminalId = response.terminalId,
                        authorizationScheme = "Terminal",
                        token = response.terminalBearer,
                        tokenVersion = response.tokenVersion,
                        tokenExpiresAt = response.tokenExpiresAt,
                        heartbeatSeconds = DEFAULT_HEARTBEAT_SECONDS,
                        pollIntervalSeconds = DEFAULT_POLL_SECONDS,
                        configVersion = 0,
                    )
                    StartupTrace.event("BOOTSTRAP_SUCCESS")
                    check(bootstrapEpoch == sessionEpoch.get()) {
                        "Merchant session changed while terminal bootstrap was in flight."
                    }
                    credentialStore.saveCredential(credential)
                    StartupTrace.event("TERMINAL_CREDENTIAL_SAVED")
                    TerminalRuntime.update(
                        ConnectorRuntimeStatus.STARTING,
                        merchantId = credential.merchantId,
                    )
                    credential
                } catch (error: Throwable) {
                    StartupTrace.event("BOOTSTRAP_FAILED")
                    throw error
                }
            }
        }

    suspend fun onMerchantSignedOut(
        reason: MerchantSessionStopReason = MerchantSessionStopReason.SIGNED_OUT,
    ) = withContext(Dispatchers.IO) {
        sessionMutex.withLock {
            sessionEpoch.incrementAndGet()
            StartupTrace.event("connector_stop_reason=$reason")
            StartupTrace.event("CONNECTOR_STOPPED_ON_SIGN_OUT")
            // Do not stop a service directly while Android is still waiting for its first
            // startForeground call; V2PrinterService observes this gate and self-stops safely.
            ConnectorSessionGate.revoke()
            V2RecoveryScheduler.cancel(applicationContext)
            credentialStore.clearBearerCredential()
            TerminalRuntime.update(
                ConnectorRuntimeStatus.SESSION_REQUIRED,
                merchantId = null,
                config = null,
            )
        }
    }

    private companion object {
        const val DEFAULT_HEARTBEAT_SECONDS = 20L
        const val DEFAULT_POLL_SECONDS = 5L
    }
}
