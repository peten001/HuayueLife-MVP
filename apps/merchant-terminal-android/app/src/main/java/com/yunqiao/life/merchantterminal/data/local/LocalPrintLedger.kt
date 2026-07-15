package com.yunqiao.life.merchantterminal.data.local

import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.connector.ClaimedPrintJob
import com.yunqiao.life.merchantterminal.security.ReceiptSnapshotCipher
import com.yunqiao.life.merchantterminal.security.SnapshotCipher

sealed interface ClaimRegistration {
    data class Ready(val job: LocalPrintJobEntity) : ClaimRegistration
    data class AlreadySucceeded(val job: LocalPrintJobEntity) : ClaimRegistration
    data class RequiresOperator(val job: LocalPrintJobEntity) : ClaimRegistration
}

class LocalPrintLedger(
    private val dao: LocalPrintingDao,
    private val cipher: SnapshotCipher = ReceiptSnapshotCipher(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    suspend fun registerClaim(job: ClaimedPrintJob): ClaimRegistration {
        val existing = dao.job(job.id)
        if (existing != null) {
            require(existing.contentHash == job.contentHash) {
                "Server job content hash changed for an existing local job."
            }
            return when (existing.status) {
                LocalJobStatus.SUCCEEDED, LocalJobStatus.PRINTED_PENDING_REPORT ->
                    ClaimRegistration.AlreadySucceeded(existing)
                LocalJobStatus.UNCERTAIN, LocalJobStatus.UNCERTAIN_PENDING_REPORT,
                LocalJobStatus.PRINTING -> ClaimRegistration.RequiresOperator(existing)
                else -> ClaimRegistration.Ready(
                    existing.copy(
                        leaseVersion = job.leaseVersion,
                        leaseExpiresAt = job.leaseExpiresAt,
                        status = LocalJobStatus.CLAIMED,
                        errorCode = null,
                        retryCount = existing.retryCount + 1,
                    ).also { dao.updateJob(it) },
                )
            }
        }
        val entity = LocalPrintJobEntity(
            serverJobId = job.id,
            printerId = job.printerId,
            receiptType = job.receiptType,
            contentHash = job.contentHash,
            receiptSnapshotEncrypted = cipher.encrypt(job.receiptSnapshotJson),
            leaseVersion = job.leaseVersion,
            leaseExpiresAt = job.leaseExpiresAt,
            status = LocalJobStatus.CLAIMED,
            claimedAt = now(),
        )
        check(dao.insertJob(entity) != -1L) { "Local print job insert raced." }
        return ClaimRegistration.Ready(entity)
    }

    suspend fun markPrinting(job: LocalPrintJobEntity, attemptNo: Int): LocalPrintJobEntity {
        require(job.status == LocalJobStatus.CLAIMED)
        val timestamp = now()
        val printingJob = job.copy(
            status = LocalJobStatus.PRINTING,
            startedAt = timestamp,
            attemptNo = attemptNo,
        )
        return dao.markPrintingAtomically(
            job = printingJob,
            attempt = LocalPrintAttemptEntity(
                serverJobId = job.serverJobId,
                attemptNo = attemptNo,
                startedAt = timestamp,
                appVersion = BuildConfig.VERSION_NAME,
            ),
        )
    }

    suspend fun updateLease(
        job: LocalPrintJobEntity,
        leaseVersion: Long,
        leaseExpiresAt: Long,
    ): LocalPrintJobEntity {
        require(job.status == LocalJobStatus.PRINTING)
        require(leaseVersion > job.leaseVersion)
        // The server clock is authoritative; an Android terminal clock may temporarily be skewed.
        require(leaseExpiresAt > 0)
        return job.copy(
            leaseVersion = leaseVersion,
            leaseExpiresAt = leaseExpiresAt,
        ).also { dao.updateJob(it) }
    }

    suspend fun markUsbComplete(job: LocalPrintJobEntity, bytesWritten: Int): LocalPrintJobEntity =
        finish(
            job = job,
            jobStatus = LocalJobStatus.PRINTED_PENDING_REPORT,
            attemptResult = "SUCCEEDED",
            errorCode = null,
            bytesWritten = bytesWritten,
            retryable = false,
            uncertain = false,
        )

    suspend fun markUsbFailed(
        job: LocalPrintJobEntity,
        errorCode: String,
        bytesWritten: Int,
        retryable: Boolean,
        uncertain: Boolean,
    ): LocalPrintJobEntity = finish(
        job = job,
        jobStatus = if (uncertain) {
            LocalJobStatus.UNCERTAIN_PENDING_REPORT
        } else {
            LocalJobStatus.FAILED_PENDING_REPORT
        },
        attemptResult = if (uncertain) "UNCERTAIN" else "FAILED",
        errorCode = errorCode,
        bytesWritten = bytesWritten,
        retryable = retryable,
        uncertain = uncertain,
    )

    suspend fun markReported(job: LocalPrintJobEntity): LocalPrintJobEntity {
        val status = when (job.status) {
            LocalJobStatus.PRINTED_PENDING_REPORT -> LocalJobStatus.SUCCEEDED
            LocalJobStatus.FAILED_PENDING_REPORT -> LocalJobStatus.FAILED
            LocalJobStatus.UNCERTAIN_PENDING_REPORT -> LocalJobStatus.UNCERTAIN
            else -> return job
        }
        val reported = job.copy(status = status).also { dao.updateJob(it) }
        dao.pruneReportedHistory(
            cutoff = now() - REPORTED_HISTORY_RETENTION_MS,
            keepMostRecent = MAX_REPORTED_HISTORY_ROWS,
        )
        return reported
    }

    /** A definitive server rejection is never retried or converted into another physical print. */
    suspend fun markReportRejected(
        job: LocalPrintJobEntity,
        serverErrorCode: String,
    ): LocalPrintJobEntity = job.copy(
        status = LocalJobStatus.UNCERTAIN,
        errorCode = "REPORT_REJECTED_${serverErrorCode.take(80)}",
        retryable = false,
        uncertain = true,
        finishedAt = job.finishedAt ?: now(),
    ).also { dao.updateJob(it) }

    suspend fun recoverInterrupted(): List<LocalPrintJobEntity> = dao.recoverInterruptedPrinting(now())

    suspend fun pendingReports(): List<LocalPrintJobEntity> = dao.jobsWithStatuses(
        listOf(
            LocalJobStatus.PRINTED_PENDING_REPORT,
            LocalJobStatus.FAILED_PENDING_REPORT,
            LocalJobStatus.UNCERTAIN_PENDING_REPORT,
        ),
    )

    fun decryptSnapshot(job: LocalPrintJobEntity): String = cipher.decrypt(job.receiptSnapshotEncrypted)

    private suspend fun finish(
        job: LocalPrintJobEntity,
        jobStatus: String,
        attemptResult: String,
        errorCode: String?,
        bytesWritten: Int,
        retryable: Boolean = false,
        uncertain: Boolean,
    ): LocalPrintJobEntity {
        require(job.status == LocalJobStatus.PRINTING)
        val timestamp = now()
        val finishedJob = job.copy(
            status = jobStatus,
            finishedAt = timestamp,
            errorCode = errorCode,
            bytesWritten = bytesWritten,
            retryable = retryable,
            uncertain = uncertain,
        )
        return dao.finishPrintingAtomically(
            job = finishedJob,
            attemptResult = attemptResult,
            attemptErrorCode = errorCode,
            bytesWritten = bytesWritten,
        )
    }

    private companion object {
        const val MAX_REPORTED_HISTORY_ROWS = 500
        const val REPORTED_HISTORY_RETENTION_MS = 14L * 24 * 60 * 60 * 1_000
    }
}
