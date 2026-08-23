package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.PrintExecutionState
import com.yunqiao.life.merchantterminal.network.ClaimedV2PrintJob
import com.yunqiao.life.merchantterminal.network.TerminalV2ApiClient
import com.yunqiao.life.merchantterminal.network.V2ApiException
import com.yunqiao.life.merchantterminal.network.V2RouteIdentity
import com.yunqiao.life.merchantterminal.network.V2StartPrintingResponse
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.LocalTransportExecutor
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.document.PrintDocumentV2Parser
import com.yunqiao.life.merchantterminal.printing.document.PrintDocumentV2Renderer
import com.yunqiao.life.merchantterminal.printing.receipt.ProductionReceiptRenderConfig
import com.yunqiao.life.merchantterminal.printing.receipt.ReceiptDocumentParser
import com.yunqiao.life.merchantterminal.printing.receipt.ReceiptDocumentRenderer
import com.yunqiao.life.merchantterminal.runtime.StartupTrace
import com.yunqiao.life.merchantterminal.storage.PrintExecutionLedgerEntity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

enum class JobExecutionResult {
    SUCCEEDED,
    FAILED,
    UNCERTAIN,
    DUPLICATE_BLOCKED,
    REQUIRES_OPERATOR,
    REPORT_PENDING,
    LEASE_PENDING,
}

class V2PrintJobExecutor(
    private val api: TerminalV2ApiClient,
    private val ledger: PrintExecutionLedger,
    private val transportExecutor: LocalTransportExecutor,
    private val terminalBearer: () -> String?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    suspend fun execute(
        job: ClaimedV2PrintJob,
        binding: LocalPrinterBinding,
    ): JobExecutionResult = withContext(Dispatchers.IO) {
        validateRoute(job, binding)
        when (val registration = ledger.register(job)) {
            is LedgerRegistration.DuplicateBlocked -> {
                reportPending(registration.entry)
                return@withContext JobExecutionResult.DUPLICATE_BLOCKED
            }
            is LedgerRegistration.RequiresOperator -> {
                reportPending(registration.entry)
                return@withContext JobExecutionResult.REQUIRES_OPERATOR
            }
            is LedgerRegistration.Ready -> executeReady(job, binding, registration.entry)
        }
    }

    suspend fun recoverPendingReports(merchantId: String): Int =
        ledger.pendingReports(merchantId).count { reportPending(it) }

    suspend fun recoverInterrupted(): Int = ledger.recoverInterrupted()

    private suspend fun executeReady(
        job: ClaimedV2PrintJob,
        binding: LocalPrinterBinding,
        claimedEntry: PrintExecutionLedgerEntity,
    ): JobExecutionResult {
        val bytes = try {
            render(job, binding)
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            return failControlledPreflight(job, claimedEntry, error)
        }
        val token = terminalBearer() ?: return JobExecutionResult.LEASE_PENDING
        val lease = try {
            api.extendLease(
                terminalBearer = token,
                jobId = job.id,
                route = job.route,
                leaseVersion = job.leaseVersion,
                leaseMs = PRINT_LEASE_MS,
            )
        } catch (_: V2ApiException) {
            return JobExecutionResult.LEASE_PENDING
        }
        val started = try {
            log(job, "PRINT_MARK_PRINTING phase=start")
            beginServerAttempt(token, job, lease.leaseVersion)
        } catch (_: V2ApiException) {
            return JobExecutionResult.LEASE_PENDING
        }
        log(job, "PRINT_MARK_PRINTING phase=success attemptNo=${started.attemptNo}")
        if (started.attemptNo != claimedEntry.attemptNo) {
            return JobExecutionResult.REQUIRES_OPERATOR
        }
        var printing = ledger.markPrinting(
            claimedEntry,
            leaseVersion = started.leaseVersion,
            plannedBytes = bytes.size,
        )
        return try {
            log(job, "PRINT_EXECUTE_START attemptNo=${started.attemptNo}")
            val result = transportExecutor.printOnce(
                binding,
                PrintableDocument(bytes, "server-print-document"),
            )
            when (result) {
                is PrintResult.Success -> {
                    log(
                        job,
                        "PRINT_EXECUTE_RESULT attemptNo=${started.attemptNo} bytesWritten=${result.writtenBytes} outcome=SUCCEEDED",
                    )
                    printing = ledger.complete(
                        printing,
                        PrintExecutionState.SUCCEEDED,
                        result.writtenBytes,
                        ioAttempted = true,
                        retryable = false,
                        errorCode = null,
                    )
                    if (reportPending(printing)) {
                        log(job, "PRINT_RESULT_REPORTED attemptNo=${started.attemptNo} outcome=SUCCEEDED")
                        JobExecutionResult.SUCCEEDED
                    } else {
                        JobExecutionResult.REPORT_PENDING
                    }
                }
                is PrintResult.Failure -> {
                    val disposition = PrintOutcomePolicy.classify(
                        result.code,
                        result.writtenBytes,
                        result.ioAttempted,
                    )
                    printing = ledger.complete(
                        printing,
                        if (disposition.uncertain) {
                            PrintExecutionState.UNCERTAIN
                        } else {
                            PrintExecutionState.FAILED
                        },
                        result.writtenBytes,
                        result.ioAttempted,
                        disposition.retryable,
                        result.code.name,
                    )
                    val outcome = if (disposition.uncertain) "UNCERTAIN" else "FAILED"
                    log(
                        job,
                        "PRINT_EXECUTE_RESULT attemptNo=${started.attemptNo} bytesWritten=${result.writtenBytes} outcome=$outcome",
                    )
                    val reported = reportPending(printing)
                    if (disposition.uncertain) {
                        if (reported) {
                            log(job, "PRINT_RESULT_REPORTED attemptNo=${started.attemptNo} outcome=UNCERTAIN")
                        }
                        JobExecutionResult.UNCERTAIN
                    } else {
                        if (reported) {
                            log(job, "PRINT_RESULT_REPORTED attemptNo=${started.attemptNo} outcome=FAILED")
                        }
                        JobExecutionResult.FAILED
                    }
                }
            }
        } catch (error: Throwable) {
            withContext(NonCancellable) {
                printing = ledger.complete(
                    printing,
                    PrintExecutionState.UNCERTAIN,
                    bytesWritten = printing.bytesWritten,
                    ioAttempted = true,
                    retryable = false,
                    errorCode = "PRINT_EXECUTION_EXCEPTION",
                )
                if (reportPending(printing)) {
                    log(job, "PRINT_RESULT_REPORTED attemptNo=${started.attemptNo} outcome=UNCERTAIN")
                }
                log(
                    job,
                    "PRINT_EXECUTE_RESULT attemptNo=${started.attemptNo} bytesWritten=${printing.bytesWritten} outcome=UNCERTAIN",
                )
            }
            if (error is CancellationException) throw error
            JobExecutionResult.UNCERTAIN
        }
    }

    private suspend fun failControlledPreflight(
        job: ClaimedV2PrintJob,
        claimedEntry: PrintExecutionLedgerEntity,
        error: Throwable,
    ): JobExecutionResult {
        val token = terminalBearer() ?: return JobExecutionResult.LEASE_PENDING
        val start = runCatching {
            log(job, "PRINT_MARK_PRINTING phase=start")
            beginServerAttempt(token, job, job.leaseVersion)
        }.getOrElse { return JobExecutionResult.LEASE_PENDING }
        log(job, "PRINT_MARK_PRINTING phase=success attemptNo=${start.attemptNo}")
        if (start.attemptNo != claimedEntry.attemptNo) {
            return JobExecutionResult.REQUIRES_OPERATOR
        }
        val placeholder = ledger.markPrinting(
            claimedEntry,
            leaseVersion = start.leaseVersion,
            plannedBytes = 1,
        )
        val localCode = when (error) {
            is com.yunqiao.life.merchantterminal.printing.receipt.ReceiptSchemaException ->
                error.code
            is com.yunqiao.life.merchantterminal.printing.UsbPrinterException ->
                error.code.name
            else -> "RECEIPT_SCHEMA_INVALID"
        }
        val failed = ledger.complete(
            placeholder,
            PrintExecutionState.FAILED,
            bytesWritten = 0,
            ioAttempted = false,
            retryable = false,
            errorCode = localCode,
        )
        if (reportPending(failed)) {
            log(job, "PRINT_RESULT_REPORTED attemptNo=${start.attemptNo} bytesWritten=0 outcome=FAILED")
        }
        return JobExecutionResult.FAILED
    }

    private fun beginServerAttempt(
        token: String,
        job: ClaimedV2PrintJob,
        leaseVersion: Long,
    ): V2StartPrintingResponse =
        if (job.status == "PRINTING" && job.currentAttemptNo != null) {
            V2StartPrintingResponse(
                attemptNo = job.currentAttemptNo,
                leaseVersion = leaseVersion,
                leaseExpiresAt = job.leaseExpiresAt,
            )
        } else {
            api.markPrinting(token, job, leaseVersion)
        }

    private suspend fun reportPending(entry: PrintExecutionLedgerEntity): Boolean {
        if (entry.serverReportedAt != null) return true
        if (
            entry.state !in setOf(
                PrintExecutionState.SUCCEEDED.name,
                PrintExecutionState.FAILED.name,
                PrintExecutionState.UNCERTAIN.name,
            )
        ) {
            return false
        }
        val token = terminalBearer() ?: return false
        val route = V2RouteIdentity(
            entry.printerId,
            entry.localBindingId,
            entry.bindingVersion,
            transport = if (entry.adapter == "ANDROID_LAN_ESCPOS") "LAN" else "UNKNOWN",
        )
        return try {
            if (entry.state == PrintExecutionState.SUCCEEDED.name) {
                api.succeeded(
                    terminalBearer = token,
                    jobId = entry.jobId,
                    route = route,
                    adapter = entry.adapter,
                    contentHash = entry.contentHash,
                    attemptNo = entry.attemptNo,
                    leaseVersion = entry.leaseVersion,
                    bytesWritten = entry.bytesWritten,
                    actualPayloadSha256 = entry.renderedPayloadSha256,
                )
            } else {
                val uncertain = entry.state == PrintExecutionState.UNCERTAIN.name
                api.failed(
                    terminalBearer = token,
                    jobId = entry.jobId,
                    route = route,
                    contentHash = entry.contentHash,
                    attemptNo = entry.attemptNo,
                    leaseVersion = entry.leaseVersion,
                    retryable = entry.retryable && !uncertain,
                    errorCode = ServerPrintErrorMapper.map(entry.errorCode.orEmpty()),
                    errorMessage = entry.errorCode ?: "Local print failure",
                    bytesWritten = entry.bytesWritten,
                    uncertain = uncertain,
                    actualPayloadSha256 = entry.renderedPayloadSha256,
                )
            }
            ledger.markReported(entry)
            true
        } catch (error: V2ApiException) {
            if (error.credentialInvalid) throw error
            false
        }
    }

    private fun render(
        job: ClaimedV2PrintJob,
        binding: LocalPrinterBinding,
    ): ByteArray {
        CanonicalServerPayload.forJob(job, binding.paperWidth.defaultDots)?.let { return it }
        if (PrintDocumentV2Parser.schemaVersion(job.receiptSnapshotJson) in 2..3) {
            return PrintDocumentV2Renderer.renderBytes(
                PrintDocumentV2Parser.parse(job.receiptSnapshotJson),
                binding.paperWidth,
            )
        }
        val receipt = ReceiptDocumentParser.parse(job.receiptSnapshotJson)
        require(receipt.receiptType.name == job.receiptType)
        val bitmap = ReceiptDocumentRenderer.render(
            receipt,
            ProductionReceiptRenderConfig(
                paperWidth = binding.paperWidth,
                customDots = null,
                jobId = job.id,
                contentHash = job.contentHash,
                printedAtEpochMs = clock(),
            ),
        )
        return try {
            EscPosRasterEncoder.encodeBitmap(bitmap, threshold = 160, cutMode = CutMode.HALF)
        } finally {
            bitmap.recycle()
        }
    }

    private fun validateRoute(job: ClaimedV2PrintJob, binding: LocalPrinterBinding) {
        require(job.merchantId == binding.merchantId)
        require(job.printerId == binding.printerId)
        require(job.route.localBindingId == binding.localBindingId)
        require(job.route.bindingVersion == binding.bindingVersion)
        require(!binding.deletedPending)
        require(binding.syncStatus == BindingSyncStatus.SYNCED)
        require(
            JobBindingExecutionPolicy.canExecuteClaimed(
                job.source,
                binding.enabled,
                binding.transport.name,
            ),
        )
    }

    private fun log(job: ClaimedV2PrintJob, message: String) {
        StartupTrace.event(
            "$message channel=${job.route.transport} jobId=${job.id} printerId=${job.printerId} bindingVersion=${job.route.bindingVersion}",
        )
    }

    private companion object {
        const val PRINT_LEASE_MS = 120_000L
    }
}
