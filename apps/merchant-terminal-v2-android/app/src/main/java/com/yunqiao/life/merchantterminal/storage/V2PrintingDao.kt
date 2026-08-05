package com.yunqiao.life.merchantterminal.storage

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface V2PrintingDao {
    @Query(
        """
        SELECT * FROM local_printer_bindings
        WHERE merchantId = :merchantId AND deletedPending = 0
        ORDER BY updatedAt DESC, displayName ASC
        """,
    )
    fun observeActiveBindings(merchantId: String): Flow<List<LocalPrinterBindingEntity>>

    @Query(
        """
        SELECT * FROM local_printer_bindings
        WHERE merchantId = :merchantId AND deletedPending = 0
        ORDER BY updatedAt DESC, displayName ASC
        """,
    )
    suspend fun activeBindings(merchantId: String): List<LocalPrinterBindingEntity>

    @Query(
        """
        SELECT * FROM local_printer_bindings
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        LIMIT 1
        """,
    )
    suspend fun binding(
        merchantId: String,
        localBindingId: String,
    ): LocalPrinterBindingEntity?

    @Query(
        """
        SELECT * FROM local_printer_bindings
        WHERE merchantId = :merchantId
          AND terminalInstanceId = :terminalInstanceId
          AND endpointIdentity = :endpointIdentity
          AND deletedPending = 0
        LIMIT 1
        """,
    )
    suspend fun activeEndpointBinding(
        merchantId: String,
        terminalInstanceId: String,
        endpointIdentity: String,
    ): LocalPrinterBindingEntity?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertBinding(binding: LocalPrinterBindingEntity)

    @Query(
        """
        UPDATE local_printer_bindings SET
            printerId = :printerId,
            bindingVersion = :bindingVersion,
            syncStatus = :syncStatus,
            enabled = :enabled,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        """,
    )
    suspend fun markBindingSynced(
        merchantId: String,
        localBindingId: String,
        printerId: String,
        bindingVersion: Long,
        syncStatus: String,
        enabled: Boolean,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE local_printer_bindings SET
            enabled = :enabled,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId
          AND localBindingId = :localBindingId
          AND printerId = :printerId
          AND bindingVersion = :bindingVersion
          AND deletedPending = 0
        """,
    )
    suspend fun updateRemoteEnabled(
        merchantId: String,
        localBindingId: String,
        printerId: String,
        bindingVersion: Long,
        enabled: Boolean,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE local_printer_bindings SET
            displayName = :displayName,
            syncStatus = :syncStatus,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId
          AND localBindingId = :localBindingId
          AND deletedPending = 0
        """,
    )
    suspend fun updateDisplayNameForSync(
        merchantId: String,
        localBindingId: String,
        displayName: String,
        syncStatus: String,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE local_printer_bindings SET
            printerId = :printerId,
            bindingVersion = :bindingVersion,
            enabled = :enabled,
            syncStatus = :syncStatus,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        """,
    )
    suspend fun adoptBindingRouteForRetry(
        merchantId: String,
        localBindingId: String,
        printerId: String,
        bindingVersion: Long,
        enabled: Boolean,
        syncStatus: String,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE local_printer_bindings SET
            localStatus = :status,
            lastConnectedAt = CASE WHEN :connectedAt IS NULL THEN lastConnectedAt ELSE :connectedAt END,
            lastTestedAt = CASE WHEN :testedAt IS NULL THEN lastTestedAt ELSE :testedAt END,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        """,
    )
    suspend fun updatePhysicalStatus(
        merchantId: String,
        localBindingId: String,
        status: String,
        connectedAt: Long?,
        testedAt: Long?,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE local_printer_bindings SET
            deletedPending = 1,
            enabled = 0,
            syncStatus = :syncStatus,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        """,
    )
    suspend fun markDeletedPending(
        merchantId: String,
        localBindingId: String,
        syncStatus: String,
        updatedAt: Long,
    ): Int

    @Query(
        """
        DELETE FROM local_printer_bindings
        WHERE merchantId = :merchantId
          AND localBindingId = :localBindingId
          AND printerId = :printerId
          AND bindingVersion = :bindingVersion
          AND transport = :transport
        """,
    )
    suspend fun deleteArchivedBinding(
        merchantId: String,
        localBindingId: String,
        printerId: String,
        bindingVersion: Long,
        transport: String,
    ): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertBindingOperation(operation: PendingBindingOperationEntity)

    @Query(
        """
        SELECT * FROM pending_binding_operations
        WHERE merchantId = :merchantId AND nextAttemptAt <= :now
        ORDER BY createdAt ASC
        LIMIT :limit
        """,
    )
    suspend fun dueBindingOperations(
        merchantId: String,
        now: Long,
        limit: Int,
    ): List<PendingBindingOperationEntity>

    @Query("DELETE FROM pending_binding_operations WHERE operationId = :operationId")
    suspend fun deleteBindingOperation(operationId: String): Int

    @Query(
        """
        DELETE FROM pending_binding_operations
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        """,
    )
    suspend fun deleteBindingOperations(
        merchantId: String,
        localBindingId: String,
    ): Int

    @Query(
        """
        UPDATE pending_binding_operations SET
            attemptCount = attemptCount + 1,
            nextAttemptAt = :nextAttemptAt,
            lastErrorCode = :errorCode,
            updatedAt = :updatedAt
        WHERE operationId = :operationId
        """,
    )
    suspend fun rescheduleBindingOperation(
        operationId: String,
        nextAttemptAt: Long,
        errorCode: String,
        updatedAt: Long,
    ): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertStatusReport(report: PendingStatusReportEntity)

    @Query(
        """
        SELECT * FROM pending_status_reports
        WHERE merchantId = :merchantId AND nextAttemptAt <= :now
        ORDER BY createdAt ASC
        LIMIT :limit
        """,
    )
    suspend fun dueStatusReports(
        merchantId: String,
        now: Long,
        limit: Int,
    ): List<PendingStatusReportEntity>

    @Query(
        """
        SELECT * FROM pending_status_reports
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        LIMIT 1
        """,
    )
    suspend fun pendingStatusReport(
        merchantId: String,
        localBindingId: String,
    ): PendingStatusReportEntity?

    @Query("DELETE FROM pending_status_reports WHERE reportId = :reportId")
    suspend fun deleteStatusReport(reportId: String): Int

    @Query(
        """
        DELETE FROM pending_status_reports
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        """,
    )
    suspend fun deleteStatusReports(
        merchantId: String,
        localBindingId: String,
    ): Int

    @Query(
        """
        UPDATE pending_status_reports SET
            attemptCount = attemptCount + 1,
            nextAttemptAt = :nextAttemptAt,
            updatedAt = :updatedAt
        WHERE reportId = :reportId
        """,
    )
    suspend fun rescheduleStatusReport(
        reportId: String,
        nextAttemptAt: Long,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE local_printer_bindings SET
            lastStatusReportAt = :reportedAt,
            updatedAt = :reportedAt
        WHERE merchantId = :merchantId AND localBindingId = :localBindingId
        """,
    )
    suspend fun markStatusReported(
        merchantId: String,
        localBindingId: String,
        reportedAt: Long,
    ): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun reserveExecution(entry: PrintExecutionLedgerEntity): Long

    @Query(
        """
        SELECT * FROM print_execution_ledger
        WHERE merchantId = :merchantId AND jobId = :jobId AND attemptNo = :attemptNo
        LIMIT 1
        """,
    )
    suspend fun execution(
        merchantId: String,
        jobId: String,
        attemptNo: Int,
    ): PrintExecutionLedgerEntity?

    @Query(
        """
        SELECT * FROM print_execution_ledger
        WHERE merchantId = :merchantId AND jobId = :jobId
        ORDER BY attemptNo DESC
        LIMIT 1
        """,
    )
    suspend fun latestExecution(
        merchantId: String,
        jobId: String,
    ): PrintExecutionLedgerEntity?

    @Query(
        """
        SELECT COUNT(*) FROM print_execution_ledger
        WHERE merchantId = :merchantId
          AND localBindingId = :localBindingId
          AND state = 'PRINTING'
        """,
    )
    suspend fun activePrintingExecutionCount(
        merchantId: String,
        localBindingId: String,
    ): Int

    @Query(
        """
        UPDATE print_execution_ledger SET
            state = :state,
            leaseVersion = :leaseVersion,
            plannedBytes = :plannedBytes,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId
          AND jobId = :jobId
          AND attemptNo = :attemptNo
          AND state = 'CLAIMED'
          AND contentHash = :contentHash
        """,
    )
    suspend fun markPrinting(
        merchantId: String,
        jobId: String,
        attemptNo: Int,
        contentHash: String,
        leaseVersion: Long,
        plannedBytes: Int,
        state: String,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE print_execution_ledger SET
            state = :state,
            bytesWritten = :bytesWritten,
            ioAttempted = :ioAttempted,
            retryable = :retryable,
            errorCode = :errorCode,
            updatedAt = :updatedAt
        WHERE merchantId = :merchantId
          AND jobId = :jobId
          AND attemptNo = :attemptNo
          AND state = 'PRINTING'
        """,
    )
    suspend fun completeExecution(
        merchantId: String,
        jobId: String,
        attemptNo: Int,
        state: String,
        bytesWritten: Int,
        ioAttempted: Boolean,
        retryable: Boolean,
        errorCode: String?,
        updatedAt: Long,
    ): Int

    @Query(
        """
        UPDATE print_execution_ledger SET
            state = 'FAILED',
            retryable = 0,
            errorCode = :errorCode,
            updatedAt = :updatedAt
        WHERE ledgerKey = :ledgerKey AND state = 'CLAIMED'
        """,
    )
    suspend fun failPreflight(
        ledgerKey: String,
        errorCode: String,
        updatedAt: Long,
    ): Int

    @Query(
        """
        SELECT * FROM print_execution_ledger
        WHERE merchantId = :merchantId
          AND state IN ('SUCCEEDED', 'FAILED', 'UNCERTAIN')
          AND serverReportedAt IS NULL
        ORDER BY updatedAt ASC
        LIMIT :limit
        """,
    )
    suspend fun pendingExecutionReports(
        merchantId: String,
        limit: Int,
    ): List<PrintExecutionLedgerEntity>

    @Query(
        """
        UPDATE print_execution_ledger SET
            serverReportedAt = :reportedAt,
            updatedAt = :reportedAt
        WHERE ledgerKey = :ledgerKey AND serverReportedAt IS NULL
        """,
    )
    suspend fun markExecutionReported(ledgerKey: String, reportedAt: Long): Int

    @Query(
        """
        UPDATE print_execution_ledger SET
            state = 'UNCERTAIN',
            retryable = 0,
            errorCode = 'PROCESS_RESTART_DURING_PRINTING',
            updatedAt = :updatedAt
        WHERE state = 'PRINTING'
        """,
    )
    suspend fun recoverInterruptedExecutions(updatedAt: Long): Int
}
