package com.yunqiao.life.merchantterminal.storage

import androidx.room.withTransaction
import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.PendingBindingOperationType
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.model.StatusSource
import com.yunqiao.life.merchantterminal.model.TransportConfigJson
import com.yunqiao.life.merchantterminal.network.V2LanRemoteBinding
import com.yunqiao.life.merchantterminal.network.V2RemotePrinter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import org.json.JSONObject
import java.util.UUID

class PrintingRepository(
    private val database: V2PrintingDatabase,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val dao = database.printingDao()

    fun observeActiveBindings(merchantId: String): Flow<List<LocalPrinterBinding>> {
        requireNumericId(merchantId)
        return dao.observeActiveBindings(merchantId).map { values -> values.map(::toDomain) }
    }

    suspend fun activeBindings(merchantId: String): List<LocalPrinterBinding> {
        requireNumericId(merchantId)
        return dao.activeBindings(merchantId).map(::toDomain)
    }

    suspend fun binding(merchantId: String, localBindingId: String): LocalPrinterBinding? {
        requireNumericId(merchantId)
        requireUuid(localBindingId)
        return dao.binding(merchantId, localBindingId)?.let(::toDomain)
    }

    suspend fun addLocalBinding(binding: LocalPrinterBinding) {
        require(binding.printerId == null && binding.bindingVersion == 0L)
        val now = clock()
        database.withTransaction {
            check(
                dao.activeEndpointBinding(
                    binding.merchantId,
                    binding.terminalInstanceId,
                    binding.transportConfig.endpointIdentity(),
                ) == null,
            ) { "This physical endpoint is already configured for the merchant terminal." }
            dao.insertBinding(binding.toEntity(now, BindingSyncStatus.PENDING_SYNC))
            dao.upsertBindingOperation(binding.syncOperation(now))
        }
    }

    suspend fun markSynced(
        merchantId: String,
        localBindingId: String,
        printerId: String,
        bindingVersion: Long,
        enabled: Boolean,
    ) {
        requireNumericId(merchantId)
        requireNumericId(printerId)
        requireUuid(localBindingId)
        require(bindingVersion > 0)
        val now = clock()
        database.withTransaction {
            check(
                dao.markBindingSynced(
                    merchantId = merchantId,
                    localBindingId = localBindingId,
                    printerId = printerId,
                    bindingVersion = bindingVersion,
                    syncStatus = BindingSyncStatus.SYNCED.name,
                    enabled = enabled,
                    updatedAt = now,
                ) == 1,
            )
            val synchronizedBinding = checkNotNull(dao.binding(merchantId, localBindingId))
            if (
                synchronizedBinding.lastTestedAt != null &&
                (
                    synchronizedBinding.lastStatusReportAt == null ||
                        synchronizedBinding.lastTestedAt > synchronizedBinding.lastStatusReportAt
                    )
            ) {
                dao.upsertStatusReport(
                    PendingStatusReportEntity(
                        reportId = "$merchantId:$localBindingId",
                        merchantId = merchantId,
                        localBindingId = localBindingId,
                        printerId = printerId,
                        bindingVersion = bindingVersion,
                        status = synchronizedBinding.localStatus,
                        source = StatusSource.LOCAL_TEST.name,
                        capabilitiesJson = JSONObject().toString(),
                        lastErrorCode = null,
                        lastErrorMessage = null,
                        attemptCount = 0,
                        nextAttemptAt = now,
                        createdAt = now,
                        updatedAt = now,
                    ),
                )
            }
            dao.deleteBindingOperation(
                operationId(merchantId, localBindingId, PendingBindingOperationType.SYNC),
            )
        }
    }

    suspend fun applyRemotePrinters(
        merchantId: String,
        printers: List<V2RemotePrinter>,
    ) {
        requireNumericId(merchantId)
        val now = clock()
        database.withTransaction {
            printers.forEach { remote ->
                dao.updateRemoteEnabled(
                    merchantId = merchantId,
                    localBindingId = remote.localBindingId,
                    printerId = remote.printerId,
                    bindingVersion = remote.bindingVersion,
                    enabled = remote.enabled,
                    updatedAt = now,
                )
            }
        }
    }

    suspend fun applyRemoteLanBindings(
        merchantId: String,
        bindings: List<V2LanRemoteBinding>,
    ) {
        requireNumericId(merchantId)
        val now = clock()
        database.withTransaction {
            bindings.forEach { remote ->
                dao.updateRemoteEnabled(
                    merchantId = merchantId,
                    localBindingId = remote.localBindingId,
                    printerId = remote.printerId,
                    bindingVersion = remote.bindingVersion,
                    enabled = remote.enabled,
                    updatedAt = now,
                )
            }
        }
    }

    suspend fun updateDisplayName(
        merchantId: String,
        localBindingId: String,
        displayName: String,
    ) {
        requireNumericId(merchantId)
        requireUuid(localBindingId)
        val normalized = displayName.trim()
        require(normalized.isNotEmpty() && normalized.length <= 160)
        val now = clock()
        database.withTransaction {
            val existing = dao.binding(merchantId, localBindingId)
                ?: error("Printer binding is unavailable.")
            if (existing.deletedPending || existing.displayName == normalized) return@withTransaction
            check(
                dao.updateDisplayNameForSync(
                    merchantId,
                    localBindingId,
                    normalized,
                    BindingSyncStatus.PENDING_SYNC.name,
                    now,
                ) == 1,
            )
            val updated = checkNotNull(dao.binding(merchantId, localBindingId)).let(::toDomain)
            dao.upsertBindingOperation(updated.syncOperation(now))
        }
    }

    suspend fun adoptConflictAndRetry(
        operation: PendingBindingOperationEntity,
        remote: V2RemotePrinter,
    ) {
        require(operation.merchantId.isNotBlank())
        require(remote.localBindingId == operation.localBindingId)
        val type = enumValueOf<PendingBindingOperationType>(operation.operationType)
        val now = clock()
        database.withTransaction {
            check(
                dao.adoptBindingRouteForRetry(
                    merchantId = operation.merchantId,
                    localBindingId = operation.localBindingId,
                    printerId = remote.printerId,
                    bindingVersion = remote.bindingVersion,
                    enabled = if (type == PendingBindingOperationType.ARCHIVE) {
                        false
                    } else {
                        remote.enabled
                    },
                    syncStatus = if (type == PendingBindingOperationType.ARCHIVE) {
                        BindingSyncStatus.PENDING_ARCHIVE.name
                    } else {
                        BindingSyncStatus.PENDING_SYNC.name
                    },
                    updatedAt = now,
                ) == 1,
            )
            dao.upsertBindingOperation(
                operation.copy(
                    expectedBindingVersion = remote.bindingVersion,
                    attemptCount = operation.attemptCount + 1,
                    nextAttemptAt = now + retryDelay(operation.attemptCount + 1),
                    lastErrorCode = "V2_BINDING_VERSION_CONFLICT",
                    updatedAt = now,
                ),
            )
        }
    }

    suspend fun requestArchive(merchantId: String, localBindingId: String) {
        requireNumericId(merchantId)
        requireUuid(localBindingId)
        val binding = dao.binding(merchantId, localBindingId) ?: return
        if (binding.deletedPending) return
        val now = clock()
        database.withTransaction {
            check(
                dao.markDeletedPending(
                    merchantId,
                    localBindingId,
                    BindingSyncStatus.PENDING_ARCHIVE.name,
                    now,
                ) == 1,
            )
            dao.deleteBindingOperation(
                operationId(merchantId, localBindingId, PendingBindingOperationType.SYNC),
            )
            if (binding.printerId != null && binding.bindingVersion > 0) {
                dao.upsertBindingOperation(
                    PendingBindingOperationEntity(
                        operationId = operationId(
                            merchantId,
                            localBindingId,
                            PendingBindingOperationType.ARCHIVE,
                        ),
                        merchantId = merchantId,
                        terminalInstanceId = binding.terminalInstanceId,
                        localBindingId = localBindingId,
                        operationType = PendingBindingOperationType.ARCHIVE.name,
                        expectedBindingVersion = binding.bindingVersion,
                        attemptCount = 0,
                        nextAttemptAt = now,
                        lastErrorCode = null,
                        createdAt = now,
                        updatedAt = now,
                    ),
                )
            }
        }
    }

    suspend fun markArchiveComplete(merchantId: String, localBindingId: String) {
        dao.deleteBindingOperation(
            operationId(merchantId, localBindingId, PendingBindingOperationType.ARCHIVE),
        )
    }

    suspend fun recordPhysicalStatus(
        binding: LocalPrinterBinding,
        status: PhysicalStatus,
        source: StatusSource,
        lastErrorCode: String? = null,
        lastErrorMessage: String? = null,
        capabilities: JSONObject = JSONObject(),
    ) {
        val now = clock()
        database.withTransaction {
            check(
                dao.updatePhysicalStatus(
                    binding.merchantId,
                    binding.localBindingId,
                    status.name,
                    now.takeIf { status == PhysicalStatus.CONNECTED },
                    now.takeIf { source == StatusSource.LOCAL_TEST },
                    now,
                ) == 1,
            )
            val printerId = binding.printerId
            if (printerId != null && binding.bindingVersion > 0 && !binding.deletedPending) {
                dao.upsertStatusReport(
                    PendingStatusReportEntity(
                        reportId = "${binding.merchantId}:${binding.localBindingId}",
                        merchantId = binding.merchantId,
                        localBindingId = binding.localBindingId,
                        printerId = printerId,
                        bindingVersion = binding.bindingVersion,
                        status = status.name,
                        source = source.name,
                        capabilitiesJson = capabilities.toString().take(16_384),
                        lastErrorCode = lastErrorCode?.take(80),
                        lastErrorMessage = lastErrorMessage?.replace(
                            Regex("[\\r\\n\\t]+"),
                            " ",
                        )?.take(240),
                        attemptCount = 0,
                        nextAttemptAt = now,
                        createdAt = now,
                        updatedAt = now,
                    ),
                )
            }
        }
    }

    suspend fun queueStatusProbe(binding: LocalPrinterBinding) {
        val printerId = binding.printerId ?: return
        if (binding.bindingVersion <= 0 || binding.deletedPending) return
        val now = clock()
        dao.upsertStatusReport(
            PendingStatusReportEntity(
                reportId = "${binding.merchantId}:${binding.localBindingId}",
                merchantId = binding.merchantId,
                localBindingId = binding.localBindingId,
                printerId = printerId,
                bindingVersion = binding.bindingVersion,
                status = binding.localStatus.name,
                source = StatusSource.PROBE.name,
                capabilitiesJson = JSONObject().toString(),
                lastErrorCode = null,
                lastErrorMessage = null,
                attemptCount = 0,
                nextAttemptAt = now,
                createdAt = now,
                updatedAt = now,
            ),
        )
    }

    suspend fun dueBindingOperations(
        merchantId: String,
        limit: Int = 20,
    ): List<PendingBindingOperationEntity> =
        dao.dueBindingOperations(merchantId, clock(), limit.coerceIn(1, 100))

    suspend fun dueStatusReports(
        merchantId: String,
        limit: Int = 20,
    ): List<PendingStatusReportEntity> =
        dao.dueStatusReports(merchantId, clock(), limit.coerceIn(1, 100))

    suspend fun hasPendingStatusReport(
        merchantId: String,
        localBindingId: String,
    ): Boolean = dao.pendingStatusReport(merchantId, localBindingId) != null

    suspend fun reschedule(operation: PendingBindingOperationEntity, errorCode: String) {
        val now = clock()
        dao.rescheduleBindingOperation(
            operationId = operation.operationId,
            nextAttemptAt = now + retryDelay(operation.attemptCount + 1),
            errorCode = errorCode.take(80),
            updatedAt = now,
        )
    }

    suspend fun reschedule(report: PendingStatusReportEntity) {
        val now = clock()
        dao.rescheduleStatusReport(
            reportId = report.reportId,
            nextAttemptAt = now + retryDelay(report.attemptCount + 1),
            updatedAt = now,
        )
    }

    suspend fun markStatusReported(report: PendingStatusReportEntity) {
        database.withTransaction {
            dao.markStatusReported(report.merchantId, report.localBindingId, clock())
            dao.deleteStatusReport(report.reportId)
        }
    }

    fun executionDao(): V2PrintingDao = dao

    private fun LocalPrinterBinding.syncOperation(now: Long) = PendingBindingOperationEntity(
        operationId = operationId(
            merchantId,
            localBindingId,
            PendingBindingOperationType.SYNC,
        ),
        merchantId = merchantId,
        terminalInstanceId = terminalInstanceId,
        localBindingId = localBindingId,
        operationType = PendingBindingOperationType.SYNC.name,
        expectedBindingVersion = bindingVersion,
        attemptCount = 0,
        nextAttemptAt = now,
        lastErrorCode = null,
        createdAt = now,
        updatedAt = now,
    )

    private fun LocalPrinterBinding.toEntity(
        now: Long,
        forcedSyncStatus: BindingSyncStatus,
    ) = LocalPrinterBindingEntity(
        storageKey = "$merchantId:$localBindingId",
        merchantId = merchantId,
        terminalInstanceId = terminalInstanceId,
        localBindingId = localBindingId,
        printerId = printerId,
        bindingVersion = bindingVersion,
        transport = transport.name,
        displayName = displayName,
        paperWidth = paperWidth.name,
        transportConfigJson = TransportConfigJson.encode(transportConfig),
        endpointIdentity = transportConfig.endpointIdentity(),
        localStatus = localStatus.name,
        syncStatus = forcedSyncStatus.name,
        deletedPending = deletedPending,
        enabled = enabled,
        lastConnectedAt = lastConnectedAt,
        lastTestedAt = lastTestedAt,
        lastStatusReportAt = lastStatusReportAt,
        updatedAt = now,
    )

    private fun toDomain(entity: LocalPrinterBindingEntity): LocalPrinterBinding {
        val transport = enumValueOf<PrinterTransport>(entity.transport)
        return LocalPrinterBinding(
            merchantId = entity.merchantId,
            terminalInstanceId = entity.terminalInstanceId,
            localBindingId = entity.localBindingId,
            printerId = entity.printerId,
            bindingVersion = entity.bindingVersion,
            transport = transport,
            displayName = entity.displayName,
            paperWidth = enumValueOf(entity.paperWidth),
            transportConfig = TransportConfigJson.decode(transport, entity.transportConfigJson),
            localStatus = enumValueOf(entity.localStatus),
            syncStatus = enumValueOf(entity.syncStatus),
            deletedPending = entity.deletedPending,
            enabled = entity.enabled,
            lastConnectedAt = entity.lastConnectedAt,
            lastTestedAt = entity.lastTestedAt,
            lastStatusReportAt = entity.lastStatusReportAt,
        )
    }

    private fun operationId(
        merchantId: String,
        localBindingId: String,
        type: PendingBindingOperationType,
    ) = "$merchantId:$localBindingId:${type.name}"

    private fun requireNumericId(value: String) {
        require(NUMERIC_ID.matches(value))
    }

    private fun requireUuid(value: String) {
        require(runCatching { UUID.fromString(value) }.isSuccess)
    }

    private fun retryDelay(attempt: Int): Long =
        (2_000L shl attempt.coerceIn(0, 5)).coerceAtMost(60_000L)

    private companion object {
        val NUMERIC_ID = Regex("^[1-9][0-9]{0,18}$")
    }
}
