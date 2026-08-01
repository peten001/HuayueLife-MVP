package com.yunqiao.life.merchantterminal.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.TerminalApplication
import com.yunqiao.life.merchantterminal.jobs.PrintExecutionLedger
import com.yunqiao.life.merchantterminal.jobs.JobBindingExecutionPolicy
import com.yunqiao.life.merchantterminal.jobs.V2PrintJobExecutor
import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.PendingBindingOperationType
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.StatusSource
import com.yunqiao.life.merchantterminal.network.TerminalV2ApiClient
import com.yunqiao.life.merchantterminal.network.V2ApiException
import com.yunqiao.life.merchantterminal.network.V2RouteIdentity
import com.yunqiao.life.merchantterminal.printing.LocalTransportExecutor
import com.yunqiao.life.merchantterminal.recovery.V2RecoveryScheduler
import com.yunqiao.life.merchantterminal.recovery.BootstrapRecoveryDisposition
import com.yunqiao.life.merchantterminal.recovery.BootstrapRecoveryPolicy
import com.yunqiao.life.merchantterminal.runtime.ConnectorRuntimeStatus
import com.yunqiao.life.merchantterminal.runtime.TerminalRuntime
import com.yunqiao.life.merchantterminal.security.TerminalCredential
import com.yunqiao.life.merchantterminal.security.CredentialRefreshGate
import com.yunqiao.life.merchantterminal.storage.PendingBindingOperationEntity
import com.yunqiao.life.merchantterminal.storage.PendingStatusReportEntity
import com.yunqiao.life.merchantterminal.storage.PrintingRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class V2PrinterService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var connectorJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, notification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (connectorJob?.isActive != true) {
            connectorJob = scope.launch { runConnector() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        connectorJob?.cancel()
        scope.cancel()
        TerminalRuntime.update(ConnectorRuntimeStatus.STOPPED)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private suspend fun runConnector() {
        val application = applicationContext as TerminalApplication
        val graph = application.graph
        val repository = graph.printingRepository
        val ledger = PrintExecutionLedger(repository.executionDao())
        val executor = V2PrintJobExecutor(
            api = graph.api,
            ledger = ledger,
            transportExecutor = LocalTransportExecutor(application),
            terminalBearer = { graph.credentialStore.readCredential()?.token },
        )
        executor.recoverInterrupted()
        var heartbeatSequence = 0L
        var lastHeartbeatAt = 0L
        var lastConfigVersion = 0L
        var networkBackoffMs = 2_000L
        val credentialRefreshGate = CredentialRefreshGate()
        while (scope.isActive) {
            val merchantJwt = graph.merchantSessionTokenStore.read()
            if (merchantJwt == null) {
                TerminalRuntime.update(ConnectorRuntimeStatus.SESSION_REQUIRED)
                stopSelf()
                return
            }
            var credential = graph.credentialStore.readCredential()
                ?.takeIf(TerminalCredential::isUsable)
            if (credential == null) {
                when (
                    val refresh = refreshCredentialOnce(
                        graph,
                        merchantJwt,
                        credentialRefreshGate,
                    )
                ) {
                    is CredentialRefreshResult.Success -> credential = refresh.credential
                    is CredentialRefreshResult.RetryWhenNetworkAvailable -> {
                        TerminalRuntime.update(
                            ConnectorRuntimeStatus.DEGRADED,
                            lastErrorCode = refresh.errorCode,
                        )
                        V2RecoveryScheduler.scheduleCredentialRecovery(applicationContext)
                        stopSelf()
                        return
                    }
                    CredentialRefreshResult.MerchantSessionRequired -> {
                        TerminalRuntime.update(ConnectorRuntimeStatus.SESSION_REQUIRED)
                        stopSelf()
                        return
                    }
                    CredentialRefreshResult.Exhausted -> {
                        TerminalRuntime.update(
                            ConnectorRuntimeStatus.DEGRADED,
                            lastErrorCode = "TERMINAL_CREDENTIAL_REFRESH_EXHAUSTED",
                        )
                        stopSelf()
                        return
                    }
                }
            }
            try {
                val now = System.currentTimeMillis()
                if (now - lastHeartbeatAt >= credential.heartbeatSeconds * 1_000L) {
                    graph.api.heartbeat(
                        terminalBearer = credential.token,
                        heartbeatSequence = heartbeatSequence++,
                        appliedConfigVersion = lastConfigVersion,
                    )
                    lastHeartbeatAt = now
                }
                val config = graph.api.config(credential.token)
                check(config.merchantId == credential.merchantId)
                check(config.terminalId == credential.terminalId)
                credentialRefreshGate.markHealthy()
                lastConfigVersion = config.configVersion
                repository.applyRemotePrinters(config.merchantId, config.printers)
                processBindingOperations(graph.api, repository, credential)
                processStatusReports(graph.api, repository, credential)
                probeBindings(repository, credential)
                processStatusReports(graph.api, repository, credential)
                executor.recoverPendingReports(credential.merchantId)
                TerminalRuntime.update(
                    ConnectorRuntimeStatus.ONLINE,
                    merchantId = credential.merchantId,
                    config = config,
                )
                if (config.canClaimJobs) {
                    executeOneJob(graph.api, repository, executor, credential, config.automaticCreationEnabled)
                }
                networkBackoffMs = 2_000L
                delay(config.pollIntervalSeconds * 1_000L)
            } catch (error: V2ApiException) {
                if (error.credentialInvalid) {
                    when (val refreshed = refreshCredentialOnce(
                        graph,
                        merchantJwt,
                        credentialRefreshGate,
                    )) {
                        is CredentialRefreshResult.Success -> {
                            heartbeatSequence = 0L
                            lastHeartbeatAt = 0L
                            lastConfigVersion = refreshed.credential.configVersion
                            networkBackoffMs = 2_000L
                            continue
                        }
                        is CredentialRefreshResult.RetryWhenNetworkAvailable -> {
                            TerminalRuntime.update(
                                ConnectorRuntimeStatus.DEGRADED,
                                merchantId = credential.merchantId,
                                lastErrorCode = refreshed.errorCode,
                            )
                            V2RecoveryScheduler.scheduleCredentialRecovery(applicationContext)
                            stopSelf()
                            return
                        }
                        CredentialRefreshResult.MerchantSessionRequired -> {
                            graph.credentialStore.clearBearerCredential()
                            TerminalRuntime.update(
                                ConnectorRuntimeStatus.SESSION_REQUIRED,
                                merchantId = credential.merchantId,
                                lastErrorCode = error.errorCode,
                            )
                            stopSelf()
                            return
                        }
                        CredentialRefreshResult.Exhausted -> {
                            TerminalRuntime.update(
                                ConnectorRuntimeStatus.DEGRADED,
                                merchantId = credential.merchantId,
                                lastErrorCode = "TERMINAL_CREDENTIAL_REFRESH_EXHAUSTED",
                            )
                            stopSelf()
                            return
                        }
                    }
                }
                TerminalRuntime.update(
                    ConnectorRuntimeStatus.DEGRADED,
                    merchantId = credential.merchantId,
                    lastErrorCode = error.errorCode,
                )
                delay(networkBackoffMs)
                networkBackoffMs = (networkBackoffMs * 2).coerceAtMost(60_000L)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                TerminalRuntime.update(
                    ConnectorRuntimeStatus.DEGRADED,
                    merchantId = credential.merchantId,
                    lastErrorCode = error.javaClass.simpleName.take(80),
                )
                delay(networkBackoffMs)
                networkBackoffMs = (networkBackoffMs * 2).coerceAtMost(60_000L)
            }
        }
    }

    private suspend fun refreshCredentialOnce(
        graph: com.yunqiao.life.merchantterminal.TerminalGraph,
        merchantJwt: String,
        gate: CredentialRefreshGate,
    ): CredentialRefreshResult {
        if (!gate.tryBegin()) return CredentialRefreshResult.Exhausted
        graph.credentialStore.clearBearerCredential()
        return try {
            CredentialRefreshResult.Success(
                graph.sessionController.refreshCredential(merchantJwt),
            )
        } catch (error: Throwable) {
            when (BootstrapRecoveryPolicy.classify(error)) {
                BootstrapRecoveryDisposition.MERCHANT_SESSION_REQUIRED ->
                    CredentialRefreshResult.MerchantSessionRequired
                BootstrapRecoveryDisposition.RETRY_WHEN_NETWORK_AVAILABLE ->
                    CredentialRefreshResult.RetryWhenNetworkAvailable(
                        (error as? V2ApiException)?.errorCode
                            ?: error.javaClass.simpleName.take(80),
                    )
            }
        }
    }

    private suspend fun processBindingOperations(
        api: TerminalV2ApiClient,
        repository: PrintingRepository,
        credential: TerminalCredential,
    ) {
        repository.dueBindingOperations(credential.merchantId).forEach { operation ->
            val binding = repository.binding(operation.merchantId, operation.localBindingId)
            if (binding == null) {
                repository.markArchiveComplete(operation.merchantId, operation.localBindingId)
                return@forEach
            }
            try {
                when (enumValueOf<PendingBindingOperationType>(operation.operationType)) {
                    PendingBindingOperationType.SYNC -> {
                        if (binding.deletedPending) return@forEach
                        val synced = api.syncBinding(credential.token, binding)
                        repository.markSynced(
                            binding.merchantId,
                            binding.localBindingId,
                            synced.printerId,
                            synced.bindingVersion,
                            synced.enabled,
                        )
                    }
                    PendingBindingOperationType.ARCHIVE -> {
                        val route = V2RouteIdentity.from(binding)
                        api.archiveBinding(credential.token, route)
                        repository.markArchiveComplete(
                            binding.merchantId,
                            binding.localBindingId,
                        )
                    }
                }
            } catch (error: V2ApiException) {
                if (error.bindingConflict) {
                    adoptConflict(api, repository, credential, operation)
                } else {
                    repository.reschedule(operation, error.errorCode)
                }
            }
        }
    }

    private suspend fun adoptConflict(
        api: TerminalV2ApiClient,
        repository: PrintingRepository,
        credential: TerminalCredential,
        operation: PendingBindingOperationEntity,
    ) {
        val remote = api.config(credential.token).printers.firstOrNull {
            it.localBindingId == operation.localBindingId
        }
        if (remote == null) {
            repository.reschedule(operation, "V2_BINDING_VERSION_CONFLICT")
            return
        }
        repository.adoptConflictAndRetry(operation, remote)
    }

    private suspend fun probeBindings(
        repository: PrintingRepository,
        credential: TerminalCredential,
    ) {
        val transport = LocalTransportExecutor(applicationContext)
        val probeCutoff = System.currentTimeMillis() - PHYSICAL_PROBE_INTERVAL_MS
        repository.activeBindings(credential.merchantId)
            .filter {
                it.printerId != null &&
                    it.bindingVersion > 0 &&
                    !it.deletedPending &&
                    (it.lastStatusReportAt == null || it.lastStatusReportAt < probeCutoff)
            }
            .forEach { binding ->
                if (
                    repository.hasPendingStatusReport(
                        binding.merchantId,
                        binding.localBindingId,
                    )
                ) return@forEach
                val connected = transport.probe(binding).isSuccess
                repository.recordPhysicalStatus(
                    binding,
                    if (connected) PhysicalStatus.CONNECTED else PhysicalStatus.DISCONNECTED,
                    StatusSource.PROBE,
                    lastErrorCode = if (connected) null else "PRINTER_OFFLINE",
                )
            }
    }

    private suspend fun processStatusReports(
        api: TerminalV2ApiClient,
        repository: PrintingRepository,
        credential: TerminalCredential,
    ) {
        repository.dueStatusReports(credential.merchantId).forEach { report ->
            try {
                api.reportStatus(
                    terminalBearer = credential.token,
                    route = V2RouteIdentity(
                        report.printerId,
                        report.localBindingId,
                        report.bindingVersion,
                    ),
                    status = report.status,
                    source = report.source,
                    capabilities = runCatching {
                        JSONObject(report.capabilitiesJson)
                    }.getOrDefault(JSONObject()),
                    lastErrorCode = report.lastErrorCode,
                    lastErrorMessage = report.lastErrorMessage,
                )
                repository.markStatusReported(report)
            } catch (error: V2ApiException) {
                repository.reschedule(report)
            }
        }
    }

    private suspend fun executeOneJob(
        api: TerminalV2ApiClient,
        repository: PrintingRepository,
        executor: V2PrintJobExecutor,
        credential: TerminalCredential,
        allowAutomatic: Boolean,
    ) {
        val bindings = repository.activeBindings(credential.merchantId)
            .filter {
                it.localStatus == PhysicalStatus.CONNECTED &&
                    it.printerId != null &&
                    it.bindingVersion > 0 &&
                    it.syncStatus == BindingSyncStatus.SYNCED &&
                    !it.deletedPending
            }
        if (bindings.isEmpty()) return
        val routes = bindings.map(V2RouteIdentity::from)
        val active = api.activeJob(credential.token)
        val job = active ?: api.claim(
            credential.token,
            allowAutomatic = allowAutomatic,
            routes = routes,
        ) ?: return
        val binding = bindings.firstOrNull {
            it.localBindingId == job.route.localBindingId &&
                it.printerId == job.route.printerId &&
                it.bindingVersion == job.route.bindingVersion
        } ?: return
        if (!JobBindingExecutionPolicy.canExecute(job.source, binding.enabled)) return
        executor.execute(job, binding)
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    getString(R.string.service_channel_name),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    setShowBadge(false)
                    enableVibration(false)
                    setSound(null, null)
                },
            )
        }
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(getString(R.string.service_notification_title))
            .setContentText(getString(R.string.service_notification_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    companion object {
        private const val NOTIFICATION_CHANNEL_ID = "terminal_v2_local_printing"
        private const val NOTIFICATION_ID = 20_040
        private const val PHYSICAL_PROBE_INTERVAL_MS = 30_000L
    }

    private sealed interface CredentialRefreshResult {
        data class Success(val credential: TerminalCredential) : CredentialRefreshResult
        data class RetryWhenNetworkAvailable(val errorCode: String) : CredentialRefreshResult
        data object MerchantSessionRequired : CredentialRefreshResult
        data object Exhausted : CredentialRefreshResult
    }
}
