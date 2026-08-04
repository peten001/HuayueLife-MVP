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
import com.yunqiao.life.merchantterminal.jobs.LanReadinessCoordinator
import com.yunqiao.life.merchantterminal.jobs.LanReadinessProbe
import com.yunqiao.life.merchantterminal.jobs.LanReadinessRecorder
import com.yunqiao.life.merchantterminal.jobs.PrintExecutionLedger
import com.yunqiao.life.merchantterminal.jobs.PrintChannelAdapter
import com.yunqiao.life.merchantterminal.jobs.PrintJobOrchestrator
import com.yunqiao.life.merchantterminal.jobs.SinglePrintOrchestratorGate
import com.yunqiao.life.merchantterminal.jobs.TerminalLanJobApiAdapter
import com.yunqiao.life.merchantterminal.jobs.TerminalUsbJobApiAdapter
import com.yunqiao.life.merchantterminal.jobs.V2PrintJobExecutor
import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PendingBindingOperationType
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.model.StatusSource
import com.yunqiao.life.merchantterminal.network.TerminalV2ApiClient
import com.yunqiao.life.merchantterminal.network.V2ApiException
import com.yunqiao.life.merchantterminal.network.V2RouteIdentity
import com.yunqiao.life.merchantterminal.printing.LocalTransportExecutor
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import com.yunqiao.life.merchantterminal.printing.usb.UsbConnectorEvidenceResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.recovery.V2RecoveryScheduler
import com.yunqiao.life.merchantterminal.recovery.BootstrapRecoveryDisposition
import com.yunqiao.life.merchantterminal.recovery.BootstrapRecoveryPolicy
import com.yunqiao.life.merchantterminal.runtime.ConnectorRuntimeStatus
import com.yunqiao.life.merchantterminal.runtime.UsbChannelState
import com.yunqiao.life.merchantterminal.runtime.LanChannelState
import com.yunqiao.life.merchantterminal.runtime.ConnectorSessionGate
import com.yunqiao.life.merchantterminal.runtime.StartupTrace
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
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

class V2PrinterService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var connectorJob: Job? = null
    private val orchestratorGate = SinglePrintOrchestratorGate()
    private val wakeSignals = Channel<Unit>(Channel.CONFLATED)
    private val forceLanReadiness = AtomicBoolean(true)

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, notification())
        StartupTrace.event("CONNECTOR_SERVICE_STARTED")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!ConnectorSessionGate.isAllowed()) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        forceLanReadiness.set(true)
        wakeSignals.trySend(Unit)
        if (connectorJob?.isActive != true && orchestratorGate.tryStart()) {
            connectorJob = scope.launch {
                StartupTrace.event("PRINT_ORCHESTRATOR_STARTED")
                try {
                    runConnector()
                } finally {
                    StartupTrace.event("PRINT_ORCHESTRATOR_STOPPED")
                    orchestratorGate.stopped()
                }
            }
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
        val transportExecutor = LocalTransportExecutor(application)
        val usbDeviceInspector = UsbDeviceInspector(application)
        val executor = V2PrintJobExecutor(
            api = graph.api,
            ledger = ledger,
            transportExecutor = transportExecutor,
            terminalBearer = { graph.credentialStore.readCredential()?.token },
        )
        val orchestrator = PrintJobOrchestrator()
        val usbJobApi = TerminalUsbJobApiAdapter(graph.api, executor)
        val lanJobApi = TerminalLanJobApiAdapter(graph.api, executor)
        val lanReadiness = LanReadinessCoordinator(
            probe = LanReadinessProbe(transportExecutor::probe),
            recorder = LanReadinessRecorder { binding, status, errorCode ->
                repository.recordPhysicalStatus(
                    binding = binding,
                    status = status,
                    source = StatusSource.PROBE,
                    lastErrorCode = errorCode,
                )
            },
        )
        executor.recoverInterrupted()
        var heartbeatSequence = 0L
        var lastHeartbeatAt = 0L
        var lastUsbStatusRefreshAt = 0L
        var lastConfigVersion = 0L
        var networkBackoffMs = 2_000L
        val credentialRefreshGate = CredentialRefreshGate()
        try {
            while (scope.isActive && ConnectorSessionGate.isAllowed()) {
            val merchantJwt = graph.merchantSessionTokenStore.read()
            var credential = graph.credentialStore.readCredential()
                ?.takeIf(TerminalCredential::isUsable)
                ?.also { StartupTrace.event("TERMINAL_CREDENTIAL_RESTORED") }
            if (credential == null) {
                if (merchantJwt == null) {
                    TerminalRuntime.update(ConnectorRuntimeStatus.SESSION_REQUIRED)
                    stopSelf()
                    return
                }
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
                    StartupTrace.event("HEARTBEAT_START")
                    graph.api.heartbeat(
                        terminalBearer = credential.token,
                        heartbeatSequence = heartbeatSequence++,
                        appliedConfigVersion = lastConfigVersion,
                    )
                    StartupTrace.event("HEARTBEAT_SUCCESS")
                    lastHeartbeatAt = now
                    TerminalRuntime.update(ConnectorRuntimeStatus.RUNNING, merchantId = credential.merchantId)
                    // LAN has its own production contract and must not wait for USB config.
                    processBindingOperations(graph.api, repository, credential)
                    lastUsbStatusRefreshAt = queueUsbStatusReportsIfDue(
                        repository,
                        credential,
                        lastUsbStatusRefreshAt,
                    )
                    processStatusReports(
                        graph.api,
                        repository,
                        credential,
                        usbDeviceInspector,
                        transportExecutor,
                    )
                }
                StartupTrace.event("USB_CONFIG_START")
                val config = graph.api.config(credential.token).copy(merchantId = credential.merchantId)
                check(config.terminalId == credential.terminalId)
                StartupTrace.event("CONFIG_SUCCESS")
                TerminalRuntime.updateChannels(usb = UsbChannelState.READY)
                StartupTrace.event("LAN_CONFIG_START")
                runCatching { graph.api.lanConfig(credential.token) }
                    .onSuccess { TerminalRuntime.updateChannels(lan = if (it.terminalEnabled && it.lanPrintingEnabled) LanChannelState.READY else LanChannelState.NOT_CONFIGURED) }
                    .onFailure { TerminalRuntime.updateChannels(lan = LanChannelState.ERROR) }
                credentialRefreshGate.markHealthy()
                lastConfigVersion = config.configVersion
                repository.applyRemotePrinters(config.merchantId, config.printers)
                val lanBindings = eligibleBindings(
                    repository,
                    credential,
                    com.yunqiao.life.merchantterminal.model.PrinterTransport.LAN,
                    requireConnected = false,
                )
                lanReadiness.refreshDue(
                    lanBindings,
                    force = forceLanReadiness.getAndSet(false),
                )
                lastUsbStatusRefreshAt = queueUsbStatusReportsIfDue(
                    repository,
                    credential,
                    lastUsbStatusRefreshAt,
                )
                processStatusReports(
                    graph.api,
                    repository,
                    credential,
                    usbDeviceInspector,
                    transportExecutor,
                )
                TerminalRuntime.update(
                    ConnectorRuntimeStatus.RUNNING,
                    merchantId = credential.merchantId,
                    config = config,
                )
                StartupTrace.event("CONNECTOR_RUNNING")
                val readyLanBindings = eligibleBindings(
                    repository,
                    credential,
                    com.yunqiao.life.merchantterminal.model.PrinterTransport.LAN,
                )
                val readyUsbBindings = eligibleBindings(
                    repository,
                    credential,
                    com.yunqiao.life.merchantterminal.model.PrinterTransport.USB,
                )
                orchestrator.reconcileRoutes(
                    listOf(lanJobApi to readyLanBindings, usbJobApi to readyUsbBindings),
                )
                if (config.canClaimJobs) {
                    executor.recoverPendingReports(credential.merchantId)
                    pollChannel(
                        orchestrator,
                        lanJobApi,
                        readyLanBindings,
                        credential,
                        config.automaticCreationEnabled,
                    )
                    pollChannel(
                        orchestrator,
                        usbJobApi,
                        readyUsbBindings,
                        credential,
                        config.automaticCreationEnabled,
                    )
                }
                networkBackoffMs = 2_000L
                awaitWakeOrTimeout(
                    minOf(
                        config.pollIntervalSeconds * 1_000L,
                        LanReadinessCoordinator.LAN_READINESS_INTERVAL_MS,
                    ),
                )
            } catch (error: V2ApiException) {
                if (error.errorCode == "NETWORK_IO_ERROR") StartupTrace.event("HEARTBEAT_FAILED")
                else StartupTrace.event("CONFIG_FAILED")
                StartupTrace.event("CONNECTOR_RECONNECTING")
                if (error.credentialInvalid) {
                    if (merchantJwt == null) {
                        graph.credentialStore.clearBearerCredential()
                        TerminalRuntime.update(ConnectorRuntimeStatus.SESSION_REQUIRED)
                        stopSelf()
                        return
                    }
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
                TerminalRuntime.updateChannels(usb = UsbChannelState.ERROR)
                TerminalRuntime.update(
                    if (lastHeartbeatAt > 0) ConnectorRuntimeStatus.RUNNING else ConnectorRuntimeStatus.DEGRADED,
                    merchantId = credential.merchantId,
                    lastErrorCode = error.errorCode,
                )
                awaitWakeOrTimeout(networkBackoffMs)
                networkBackoffMs = (networkBackoffMs * 2).coerceAtMost(60_000L)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                StartupTrace.event("CONFIG_FAILED")
                StartupTrace.event("CONNECTOR_RECONNECTING")
                TerminalRuntime.updateChannels(usb = UsbChannelState.ERROR)
                TerminalRuntime.update(
                    if (lastHeartbeatAt > 0) ConnectorRuntimeStatus.RUNNING else ConnectorRuntimeStatus.DEGRADED,
                    merchantId = credential.merchantId,
                    lastErrorCode = error.javaClass.simpleName.take(80),
                )
                awaitWakeOrTimeout(networkBackoffMs)
                networkBackoffMs = (networkBackoffMs * 2).coerceAtMost(60_000L)
            }
            }
        } finally {
            orchestrator.stop()
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
                val operationType = enumValueOf<PendingBindingOperationType>(operation.operationType)
                val supported = binding.transport == PrinterTransport.LAN ||
                    (binding.transport == PrinterTransport.USB &&
                        operationType == PendingBindingOperationType.SYNC)
                if (!supported) return@forEach
                when (operationType) {
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

    private suspend fun queueUsbStatusReportsIfDue(
        repository: PrintingRepository,
        credential: TerminalCredential,
        lastRefreshAt: Long,
    ): Long {
        val now = System.currentTimeMillis()
        if (now - lastRefreshAt < USB_STATUS_REFRESH_INTERVAL_MS) return lastRefreshAt
        eligibleBindings(
            repository,
            credential,
            PrinterTransport.USB,
            requireConnected = false,
        ).forEach { repository.queueStatusProbe(it) }
        return now
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

    private suspend fun eligibleBindings(
        repository: PrintingRepository,
        credential: TerminalCredential,
        transport: com.yunqiao.life.merchantterminal.model.PrinterTransport,
        requireConnected: Boolean = true,
    ) = repository.activeBindings(credential.merchantId)
            .filter {
                it.transport == transport &&
                    (!requireConnected || it.localStatus == PhysicalStatus.CONNECTED) &&
                it.printerId != null &&
                    it.bindingVersion > 0 &&
                    it.syncStatus == BindingSyncStatus.SYNCED &&
                    !it.deletedPending
            }

    private suspend fun processStatusReports(
        api: TerminalV2ApiClient,
        repository: PrintingRepository,
        credential: TerminalCredential,
        usbDeviceInspector: UsbDeviceInspector,
        transportExecutor: LocalTransportExecutor,
    ) {
        repository.dueStatusReports(credential.merchantId).forEach { report ->
            val binding = repository.binding(report.merchantId, report.localBindingId)
                ?: return@forEach
            if (binding.transport !in setOf(PrinterTransport.USB, PrinterTransport.LAN)) {
                return@forEach
            }
            val usbObservation = if (binding.transport == PrinterTransport.USB) {
                observeUsbStatus(binding, usbDeviceInspector, transportExecutor).also {
                    repository.recordPhysicalStatus(
                        binding = binding,
                        status = it.status,
                        source = StatusSource.PROBE,
                        lastErrorCode = it.errorCode,
                        lastErrorMessage = it.errorMessage,
                        capabilities = it.capabilities,
                    )
                }
            } else {
                null
            }
            try {
                api.reportStatus(
                    terminalBearer = credential.token,
                    route = V2RouteIdentity(
                        report.printerId,
                        report.localBindingId,
                        report.bindingVersion,
                        transport = binding.transport.name,
                    ),
                    status = usbObservation?.status?.name ?: report.status,
                    capabilities = usbObservation?.capabilities ?: runCatching {
                        JSONObject(report.capabilitiesJson)
                    }.getOrDefault(JSONObject()),
                    lastErrorCode = usbObservation?.errorCode ?: report.lastErrorCode,
                    lastErrorMessage = usbObservation?.errorMessage ?: report.lastErrorMessage,
                )
                repository.markStatusReported(report)
                StartupTrace.event(
                    "${binding.transport.name}_STATUS_REPORT_SUCCESS printerId=${report.printerId} bindingVersion=${report.bindingVersion}",
                )
            } catch (error: V2ApiException) {
                repository.reschedule(report)
                StartupTrace.event(
                    "${binding.transport.name}_STATUS_REPORT_FAILED printerId=${report.printerId} bindingVersion=${report.bindingVersion} httpStatus=${error.statusCode} errorType=${error.errorCode}",
                )
            }
        }
    }

    private suspend fun observeUsbStatus(
        binding: com.yunqiao.life.merchantterminal.model.LocalPrinterBinding,
        usbDeviceInspector: UsbDeviceInspector,
        transportExecutor: LocalTransportExecutor,
    ): UsbStatusObservation {
        val config = binding.transportConfig as LocalTransportConfig.Usb
        val devices = try {
            withContext(Dispatchers.IO) { usbDeviceInspector.scan() }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            val errorCode = "USB_DEVICE_SCAN_FAILED_${error.javaClass.simpleName.uppercase()}"
                .take(80)
            return UsbStatusObservation(
                status = PhysicalStatus.ERROR,
                errorCode = errorCode,
                errorMessage = error.javaClass.simpleName.take(160),
                capabilities = JSONObject().put("usbInspectionErrorCode", errorCode),
            )
        }
        val inspection = UsbConnectorEvidenceResolver.inspect(config, devices)
        if (!inspection.canProbe) {
            return UsbStatusObservation(
                status = inspection.status,
                errorCode = inspection.errorCode,
                errorMessage = inspection.errorCode,
                capabilities = inspection.evidence.toJson(),
            )
        }
        val probe = transportExecutor.probe(binding)
        val probeError = probe.exceptionOrNull()
        val connected = probe.isSuccess
        val errorCode = if (connected) null else probeError.usbProbeErrorCode()
        return UsbStatusObservation(
            status = if (connected) PhysicalStatus.CONNECTED else PhysicalStatus.ERROR,
            errorCode = errorCode,
            errorMessage = probeError?.javaClass?.simpleName,
            capabilities = inspection.evidence.withExecutionReady(connected).toJson(),
        )
    }

    private suspend fun pollChannel(
        orchestrator: PrintJobOrchestrator,
        adapter: PrintChannelAdapter,
        bindings: List<com.yunqiao.life.merchantterminal.model.LocalPrinterBinding>,
        credential: TerminalCredential,
        allowAutomatic: Boolean,
    ) {
        if (bindings.isEmpty()) return
        try {
            orchestrator.poll(
                adapter = adapter,
                terminalBearer = credential.token,
                bindings = bindings,
                allowAutomatic = allowAutomatic,
            )
        } catch (error: V2ApiException) {
            if (error.credentialInvalid) throw error
            StartupTrace.event(
                "PRINT_EXECUTE_RESULT channel=${adapter.channel} printerId=${bindings.first().printerId} bindingVersion=${bindings.first().bindingVersion} outcome=${error.errorCode}",
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            StartupTrace.event(
                "PRINT_EXECUTE_RESULT channel=${adapter.channel} printerId=${bindings.first().printerId} bindingVersion=${bindings.first().bindingVersion} outcome=${error.javaClass.simpleName.take(80)}",
            )
        }
    }

    private suspend fun awaitWakeOrTimeout(timeoutMs: Long) {
        withTimeoutOrNull(timeoutMs.coerceAtLeast(1L)) {
            wakeSignals.receive()
        }
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
        private const val USB_STATUS_REFRESH_INTERVAL_MS = 45_000L
    }

    private data class UsbStatusObservation(
        val status: PhysicalStatus,
        val errorCode: String?,
        val errorMessage: String?,
        val capabilities: JSONObject,
    )

    private sealed interface CredentialRefreshResult {
        data class Success(val credential: TerminalCredential) : CredentialRefreshResult
        data class RetryWhenNetworkAvailable(val errorCode: String) : CredentialRefreshResult
        data object MerchantSessionRequired : CredentialRefreshResult
        data object Exhausted : CredentialRefreshResult
    }
}

private fun Throwable?.usbProbeErrorCode(): String = when (this) {
    is UsbPrinterException -> code.name
    else -> this?.message
        ?.takeIf { it.matches(Regex("^[A-Z0-9_]{3,80}$")) }
        ?.take(80)
        ?: this?.javaClass?.simpleName
            ?.uppercase()
            ?.let { "USB_PROBE_FAILED_$it" }
            ?.take(80)
        ?: "USB_PROBE_FAILED"
}
