package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.model.PrintExecutionState
import com.yunqiao.life.merchantterminal.network.ClaimedV2PrintJob
import com.yunqiao.life.merchantterminal.storage.PrintExecutionLedgerEntity
import com.yunqiao.life.merchantterminal.storage.V2PrintingDao

sealed interface LedgerRegistration {
    data class Ready(val entry: PrintExecutionLedgerEntity) : LedgerRegistration
    data class DuplicateBlocked(val entry: PrintExecutionLedgerEntity) : LedgerRegistration
    data class RequiresOperator(val entry: PrintExecutionLedgerEntity) : LedgerRegistration
}

class PrintExecutionLedger(
    private val dao: V2PrintingDao,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun register(job: ClaimedV2PrintJob): LedgerRegistration {
        val latest = dao.latestExecution(job.merchantId, job.id)
        if (latest != null) {
            require(latest.contentHash == job.contentHash) {
                "Content hash changed for a locally known job."
            }
            when (latest.state) {
                PrintExecutionState.SUCCEEDED.name ->
                    return LedgerRegistration.DuplicateBlocked(latest)
                PrintExecutionState.PRINTING.name,
                PrintExecutionState.UNCERTAIN.name,
                -> return LedgerRegistration.RequiresOperator(latest)
                PrintExecutionState.CLAIMED.name -> {
                    if (latest.attemptNo == job.expectedAttemptNo) {
                        return LedgerRegistration.Ready(latest)
                    }
                }
                PrintExecutionState.FAILED.name -> {
                    if (latest.attemptNo >= job.expectedAttemptNo) {
                        return LedgerRegistration.DuplicateBlocked(latest)
                    }
                }
            }
        }
        val now = clock()
        val entry = PrintExecutionLedgerEntity(
            ledgerKey = "${job.merchantId}:${job.id}:${job.expectedAttemptNo}",
            merchantId = job.merchantId,
            jobId = job.id,
            attemptNo = job.expectedAttemptNo,
            localBindingId = job.route.localBindingId,
            printerId = job.route.printerId,
            bindingVersion = job.route.bindingVersion,
            contentHash = job.contentHash,
            adapter = job.adapter,
            leaseVersion = job.leaseVersion,
            state = PrintExecutionState.CLAIMED.name,
            plannedBytes = 0,
            bytesWritten = 0,
            ioAttempted = false,
            retryable = false,
            errorCode = null,
            serverReportedAt = null,
            createdAt = now,
            updatedAt = now,
        )
        val inserted = dao.reserveExecution(entry)
        if (inserted == -1L) {
            val raced = requireNotNull(
                dao.execution(job.merchantId, job.id, job.expectedAttemptNo),
            )
            return if (
                raced.state == PrintExecutionState.SUCCEEDED.name
            ) {
                LedgerRegistration.DuplicateBlocked(raced)
            } else {
                LedgerRegistration.RequiresOperator(raced)
            }
        }
        return LedgerRegistration.Ready(entry)
    }

    suspend fun markPrinting(
        entry: PrintExecutionLedgerEntity,
        leaseVersion: Long,
        plannedBytes: Int,
    ): PrintExecutionLedgerEntity {
        require(plannedBytes > 0)
        check(
            dao.markPrinting(
                merchantId = entry.merchantId,
                jobId = entry.jobId,
                attemptNo = entry.attemptNo,
                contentHash = entry.contentHash,
                leaseVersion = leaseVersion,
                plannedBytes = plannedBytes,
                state = PrintExecutionState.PRINTING.name,
                updatedAt = clock(),
            ) == 1,
        )
        return entry.copy(
            state = PrintExecutionState.PRINTING.name,
            leaseVersion = leaseVersion,
            plannedBytes = plannedBytes,
            updatedAt = clock(),
        )
    }

    suspend fun complete(
        entry: PrintExecutionLedgerEntity,
        state: PrintExecutionState,
        bytesWritten: Int,
        ioAttempted: Boolean,
        retryable: Boolean,
        errorCode: String?,
    ): PrintExecutionLedgerEntity {
        require(state in TERMINAL_STATES)
        require(bytesWritten in 0..entry.plannedBytes)
        require(state != PrintExecutionState.UNCERTAIN || !retryable)
        val now = clock()
        check(
            dao.completeExecution(
                merchantId = entry.merchantId,
                jobId = entry.jobId,
                attemptNo = entry.attemptNo,
                state = state.name,
                bytesWritten = bytesWritten,
                ioAttempted = ioAttempted,
                retryable = retryable,
                errorCode = errorCode?.take(80),
                updatedAt = now,
            ) == 1,
        )
        return entry.copy(
            state = state.name,
            bytesWritten = bytesWritten,
            ioAttempted = ioAttempted,
            retryable = retryable,
            errorCode = errorCode?.take(80),
            updatedAt = now,
        )
    }

    suspend fun pendingReports(
        merchantId: String,
        limit: Int = 20,
    ): List<PrintExecutionLedgerEntity> =
        dao.pendingExecutionReports(merchantId, limit.coerceIn(1, 100))

    suspend fun markReported(entry: PrintExecutionLedgerEntity) {
        dao.markExecutionReported(entry.ledgerKey, clock())
    }

    suspend fun recoverInterrupted(): Int = dao.recoverInterruptedExecutions(clock())

    private companion object {
        val TERMINAL_STATES = setOf(
            PrintExecutionState.SUCCEEDED,
            PrintExecutionState.FAILED,
            PrintExecutionState.UNCERTAIN,
        )
    }
}
