package com.yunqiao.life.merchantterminal.storage

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "local_printer_bindings",
    indices = [
        Index(value = ["merchantId", "localBindingId"], unique = true),
        Index(value = ["merchantId", "terminalInstanceId", "endpointIdentity"]),
        Index(value = ["merchantId", "printerId"]),
        Index(value = ["merchantId", "deletedPending"]),
    ],
)
data class LocalPrinterBindingEntity(
    @PrimaryKey val storageKey: String,
    val merchantId: String,
    val terminalInstanceId: String,
    val localBindingId: String,
    val printerId: String?,
    val bindingVersion: Long,
    val transport: String,
    val displayName: String,
    val paperWidth: String,
    val transportConfigJson: String,
    val endpointIdentity: String,
    val localStatus: String,
    val syncStatus: String,
    val deletedPending: Boolean,
    val enabled: Boolean,
    val lastConnectedAt: Long?,
    val lastTestedAt: Long?,
    val lastStatusReportAt: Long?,
    val updatedAt: Long,
)

@Entity(
    tableName = "pending_binding_operations",
    indices = [
        Index(
            value = ["merchantId", "localBindingId", "operationType"],
            unique = true,
        ),
        Index(value = ["merchantId", "nextAttemptAt"]),
    ],
)
data class PendingBindingOperationEntity(
    @PrimaryKey val operationId: String,
    val merchantId: String,
    val terminalInstanceId: String,
    val localBindingId: String,
    val operationType: String,
    val expectedBindingVersion: Long,
    val attemptCount: Int,
    val nextAttemptAt: Long,
    val lastErrorCode: String?,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "pending_status_reports",
    indices = [
        Index(value = ["merchantId", "localBindingId"], unique = true),
        Index(value = ["merchantId", "nextAttemptAt"]),
    ],
)
data class PendingStatusReportEntity(
    @PrimaryKey val reportId: String,
    val merchantId: String,
    val localBindingId: String,
    val printerId: String,
    val bindingVersion: Long,
    val status: String,
    val source: String,
    val capabilitiesJson: String,
    val lastErrorCode: String?,
    val lastErrorMessage: String?,
    val attemptCount: Int,
    val nextAttemptAt: Long,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(
    tableName = "print_execution_ledger",
    indices = [
        Index(value = ["merchantId", "jobId", "attemptNo"], unique = true),
        Index(value = ["merchantId", "state"]),
        Index(value = ["merchantId", "localBindingId"]),
    ],
)
data class PrintExecutionLedgerEntity(
    @PrimaryKey val ledgerKey: String,
    val merchantId: String,
    val jobId: String,
    val attemptNo: Int,
    val localBindingId: String,
    val printerId: String,
    val bindingVersion: Long,
    val contentHash: String,
    val adapter: String,
    val leaseVersion: Long,
    val state: String,
    val plannedBytes: Int,
    val bytesWritten: Int,
    val ioAttempted: Boolean,
    val retryable: Boolean,
    val errorCode: String?,
    val serverReportedAt: Long?,
    val createdAt: Long,
    val updatedAt: Long,
)
