package com.yunqiao.life.merchantterminal.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

object LocalJobStatus {
    const val CLAIMED = "CLAIMED"
    const val PRINTING = "PRINTING"
    const val PRINTED_PENDING_REPORT = "PRINTED_PENDING_REPORT"
    const val SUCCEEDED = "SUCCEEDED"
    const val FAILED_PENDING_REPORT = "FAILED_PENDING_REPORT"
    const val FAILED = "FAILED"
    const val UNCERTAIN_PENDING_REPORT = "UNCERTAIN_PENDING_REPORT"
    const val UNCERTAIN = "UNCERTAIN"

    val terminal = setOf(SUCCEEDED, FAILED, UNCERTAIN)
    val pendingReport = setOf(
        PRINTED_PENDING_REPORT,
        FAILED_PENDING_REPORT,
        UNCERTAIN_PENDING_REPORT,
    )
    val blocksAutomaticPrint = setOf(
        PRINTING,
        PRINTED_PENDING_REPORT,
        SUCCEEDED,
        UNCERTAIN_PENDING_REPORT,
        UNCERTAIN,
    )
}

@Entity(
    tableName = "local_print_jobs",
    indices = [
        Index(value = ["status"]),
        Index(value = ["leaseExpiresAt"]),
        Index(value = ["contentHash"]),
    ],
)
data class LocalPrintJobEntity(
    @PrimaryKey val serverJobId: String,
    val printerId: String,
    val receiptType: String,
    val contentHash: String,
    /** AES-GCM envelope; canonical customer snapshot is never stored as plaintext. */
    val receiptSnapshotEncrypted: String,
    val leaseVersion: Long,
    val leaseExpiresAt: Long,
    val status: String,
    val claimedAt: Long,
    val startedAt: Long? = null,
    val finishedAt: Long? = null,
    val bytesWritten: Int = 0,
    val errorCode: String? = null,
    val retryCount: Int = 0,
    val retryable: Boolean = false,
    val uncertain: Boolean = false,
    val attemptNo: Int? = null,
)

@Entity(
    tableName = "local_print_attempts",
    foreignKeys = [
        ForeignKey(
            entity = LocalPrintJobEntity::class,
            parentColumns = ["serverJobId"],
            childColumns = ["serverJobId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["serverJobId", "attemptNo"], unique = true),
        Index(value = ["result"]),
    ],
)
data class LocalPrintAttemptEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val serverJobId: String,
    val attemptNo: Int,
    val startedAt: Long,
    val finishedAt: Long? = null,
    val result: String = "PRINTING",
    val errorCode: String? = null,
    val bytesWritten: Int = 0,
    val appVersion: String,
)

@Entity(tableName = "printer_binding")
data class PrinterBindingEntity(
    @PrimaryKey val singletonId: Int = SINGLETON_ID,
    val printerId: String?,
    val vendorId: Int,
    val productId: Int,
    val deviceNameHash: String,
    val interfaceIndex: Int,
    val interfaceId: Int,
    val alternateSetting: Int,
    val endpointAddress: Int,
    val paperWidth: String,
    val printDots: Int,
    val threshold: Int,
    val cutMode: String,
    val updatedAt: Long,
) {
    companion object { const val SINGLETON_ID = 1 }
}

@Entity(tableName = "terminal_state")
data class TerminalStateEntity(
    @PrimaryKey val terminalId: String,
    val lastHeartbeatAt: Long? = null,
    val lastConfigAt: Long? = null,
    val lastClaimAt: Long? = null,
    val lastErrorCode: String? = null,
    val updatedAt: Long,
)
