package com.yunqiao.life.merchantterminal.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update

@Dao
interface LocalPrintingDao {
    @Query("SELECT * FROM local_print_jobs WHERE serverJobId = :serverJobId LIMIT 1")
    suspend fun job(serverJobId: String): LocalPrintJobEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertJob(job: LocalPrintJobEntity): Long

    @Update
    suspend fun updateJob(job: LocalPrintJobEntity)

    @Query("SELECT * FROM local_print_jobs WHERE status IN (:statuses) ORDER BY claimedAt ASC")
    suspend fun jobsWithStatuses(statuses: List<String>): List<LocalPrintJobEntity>

    @Query("SELECT COUNT(*) FROM local_print_jobs WHERE status = :status")
    suspend fun countByStatus(status: String): Int

    @Query("SELECT * FROM local_print_jobs ORDER BY claimedAt DESC LIMIT :limit")
    suspend fun recentJobs(limit: Int = 20): List<LocalPrintJobEntity>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAttempt(attempt: LocalPrintAttemptEntity): Long

    @Query("SELECT * FROM local_print_attempts WHERE serverJobId = :serverJobId ORDER BY attemptNo DESC LIMIT 1")
    suspend fun latestAttempt(serverJobId: String): LocalPrintAttemptEntity?

    @Update
    suspend fun updateAttempt(attempt: LocalPrintAttemptEntity)

    @Transaction
    suspend fun markPrintingAtomically(
        job: LocalPrintJobEntity,
        attempt: LocalPrintAttemptEntity,
    ): LocalPrintJobEntity {
        insertAttempt(attempt)
        updateJob(job)
        return job
    }

    @Transaction
    suspend fun finishPrintingAtomically(
        job: LocalPrintJobEntity,
        attemptResult: String,
        attemptErrorCode: String?,
        bytesWritten: Int,
    ): LocalPrintJobEntity {
        latestAttempt(job.serverJobId)?.let { attempt ->
            updateAttempt(
                attempt.copy(
                    finishedAt = job.finishedAt,
                    result = attemptResult,
                    errorCode = attemptErrorCode,
                    bytesWritten = bytesWritten,
                ),
            )
        }
        updateJob(job)
        return job
    }

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun savePrinterBinding(binding: PrinterBindingEntity)

    @Query("SELECT * FROM printer_binding WHERE singletonId = 1 LIMIT 1")
    suspend fun printerBinding(): PrinterBindingEntity?

    @Query("DELETE FROM printer_binding")
    suspend fun clearPrinterBinding()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveTerminalState(state: TerminalStateEntity)

    @Query("SELECT * FROM terminal_state WHERE terminalId = :terminalId LIMIT 1")
    suspend fun terminalState(terminalId: String): TerminalStateEntity?

    @Query(
        """
        SELECT serverJobId FROM local_print_jobs
        WHERE status IN (:statuses)
        ORDER BY claimedAt ASC
        LIMIT :limit
        """,
    )
    suspend fun activeJobIds(statuses: List<String>, limit: Int): List<String>

    @Query(
        """
        SELECT DISTINCT jobs.* FROM local_print_jobs AS jobs
        LEFT JOIN local_print_attempts AS attempts
          ON attempts.serverJobId = jobs.serverJobId
        WHERE jobs.status = 'PRINTING'
           OR (jobs.status = 'CLAIMED' AND attempts.result = 'PRINTING')
        ORDER BY jobs.claimedAt ASC
        """,
    )
    suspend fun interruptedPrintingJobs(): List<LocalPrintJobEntity>

    @Query(
        """
        DELETE FROM local_print_jobs
        WHERE status IN ('SUCCEEDED', 'FAILED')
          AND finishedAt IS NOT NULL
          AND finishedAt < :cutoff
        """,
    )
    suspend fun deleteReportedJobsOlderThan(cutoff: Long): Int

    @Query(
        """
        SELECT serverJobId FROM local_print_jobs
        WHERE status IN ('SUCCEEDED', 'FAILED')
        ORDER BY finishedAt DESC, claimedAt DESC
        LIMIT -1 OFFSET :keepMostRecent
        """,
    )
    suspend fun reportedJobIdsBeyondLimit(keepMostRecent: Int): List<String>

    @Query("DELETE FROM local_print_jobs WHERE serverJobId IN (:serverJobIds)")
    suspend fun deleteJobsByIds(serverJobIds: List<String>): Int

    @Transaction
    suspend fun pruneReportedHistory(cutoff: Long, keepMostRecent: Int) {
        require(keepMostRecent >= 0)
        deleteReportedJobsOlderThan(cutoff)
        val overflow = reportedJobIdsBeyondLimit(keepMostRecent)
        if (overflow.isNotEmpty()) deleteJobsByIds(overflow)
    }

    @Transaction
    suspend fun recoverInterruptedPrinting(now: Long): List<LocalPrintJobEntity> {
        // The CLAIMED + PRINTING-attempt branch recovers databases created by an older build whose
        // two writes were not transactional. New transitions use markPrintingAtomically().
        val interrupted = interruptedPrintingJobs()
        interrupted.forEach { job ->
            updateJob(
                job.copy(
                    status = LocalJobStatus.UNCERTAIN_PENDING_REPORT,
                    finishedAt = now,
                    errorCode = "PROCESS_INTERRUPTED_DURING_USB_IO",
                    uncertain = true,
                ),
            )
            latestAttempt(job.serverJobId)?.let { attempt ->
                updateAttempt(
                    attempt.copy(
                        finishedAt = now,
                        result = "UNCERTAIN",
                        errorCode = "PROCESS_INTERRUPTED_DURING_USB_IO",
                    ),
                )
            }
        }
        return interrupted
    }
}
