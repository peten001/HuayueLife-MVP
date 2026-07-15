package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.data.local.ClaimRegistration
import com.yunqiao.life.merchantterminal.data.local.LocalJobStatus
import com.yunqiao.life.merchantterminal.data.local.LocalPrintJobEntity
import com.yunqiao.life.merchantterminal.data.local.LocalPrintLedger
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.receipt.ProductionReceiptRenderConfig
import com.yunqiao.life.merchantterminal.printing.receipt.ReceiptDocumentParser
import com.yunqiao.life.merchantterminal.printing.receipt.ReceiptDocumentRenderer
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.UsbEscPosAdapter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

class UsbPrintJobExecutor(
    private val context: Context,
    private val api: ConnectorApiClient,
    private val ledger: LocalPrintLedger,
    private val inspector: UsbDeviceInspector = UsbDeviceInspector(context),
    private val adapterFactory: () -> UsbEscPosAdapter = {
        UsbEscPosAdapter(context.applicationContext, inspector)
    },
) {
    @Volatile private var activeAdapter: UsbEscPosAdapter? = null

    suspend fun execute(job: ClaimedPrintJob, settings: ConnectorSettingsSnapshot): String {
        val binding = settings.usbBinding ?: return "USB_BINDING_MISSING"
        if (binding.printerId == null || binding.printerId != job.printerId) {
            return "PRINTER_BINDING_MISMATCH"
        }
        return when (val registration = ledger.registerClaim(job)) {
            is ClaimRegistration.AlreadySucceeded -> {
                if (registration.job.status == LocalJobStatus.PRINTED_PENDING_REPORT) {
                    reportPending(registration.job)
                }
                "DUPLICATE_PRINT_BLOCKED"
            }
            is ClaimRegistration.RequiresOperator -> {
                if (registration.job.status == LocalJobStatus.UNCERTAIN_PENDING_REPORT) {
                    reportPending(registration.job)
                }
                "UNCERTAIN_REQUIRES_OPERATOR"
            }
            is ClaimRegistration.Ready -> executeReady(job, registration.job, settings)
        }
    }

    suspend fun reportPending(job: LocalPrintJobEntity): Boolean = withContext(Dispatchers.IO) {
        val attemptNo = job.attemptNo ?: return@withContext false
        try {
            when (job.status) {
                LocalJobStatus.PRINTED_PENDING_REPORT -> api.succeeded(
                    jobId = job.serverJobId,
                    attemptNo = attemptNo,
                    leaseVersion = job.leaseVersion,
                    bytesWritten = job.bytesWritten,
                    contentHash = job.contentHash,
                )
                LocalJobStatus.FAILED_PENDING_REPORT,
                LocalJobStatus.UNCERTAIN_PENDING_REPORT -> api.failed(
                    jobId = job.serverJobId,
                    attemptNo = attemptNo,
                    leaseVersion = job.leaseVersion,
                    retryable = job.retryable,
                    errorCode = ServerPrintErrorMapper.map(job.errorCode),
                    errorMessage = job.errorCode,
                    bytesWritten = job.bytesWritten,
                    uncertain = job.status == LocalJobStatus.UNCERTAIN_PENDING_REPORT,
                    contentHash = job.contentHash,
                )
                else -> return@withContext false
            }
            ledger.markReported(job)
            true
        } catch (error: ConnectorApiException) {
            if (PendingReportPolicy.requiresOperator(error.errorCode)) {
                ledger.markReportRejected(job, error.errorCode)
                false
            } else {
                if (
                    error.invalidTerminalCredential ||
                    error.errorCode in setOf(
                        "TERMINAL_DISABLED",
                        "PRINTING_TASK_CENTER_DISABLED",
                        "PRINTING_EXECUTION_DISABLED",
                    )
                ) throw error
                false
            }
        }
    }

    suspend fun recoverAfterProcessRestart(): Int {
        recoverLocalInterrupted()
        return recoverPendingReports()
    }

    suspend fun recoverLocalInterrupted(): Int = ledger.recoverInterrupted().size

    suspend fun recoverPendingReports(): Int {
        return ledger.pendingReports().count { reportPending(it) }
    }

    fun onDeviceDetached(deviceName: String?) {
        activeAdapter?.notifyDeviceDetached(deviceName)
    }

    fun stopActiveIo() {
        activeAdapter?.closeConnectionImmediately()
    }

    private suspend fun executeReady(
        serverJob: ClaimedPrintJob,
        localJob: LocalPrintJobEntity,
        settings: ConnectorSettingsSnapshot,
    ): String = withContext(Dispatchers.IO) {
        val binding = requireNotNull(settings.usbBinding)
        val start = try {
            api.startPrinting(serverJob, networkInfo = "android-connected")
        } catch (error: ConnectorApiException) {
            return@withContext error.errorCode
        }
        var printingJob = ledger.markPrinting(
            localJob.copy(
                leaseVersion = start.leaseVersion,
                leaseExpiresAt = start.leaseExpiresAt,
            ),
            start.attemptNo,
        )
        try {
            val resolution = UsbBindingResolver.resolve(binding, inspector.scan())
            if (resolution !is UsbBindingResolution.Ready) {
                val localCode = (resolution as UsbBindingResolution.Unavailable).errorCode
                val usbCode = when (localCode) {
                    "USB_DEVICE_NOT_FOUND" -> UsbPrintErrorCode.USB_DEVICE_NOT_FOUND
                    "USB_PERMISSION_REQUIRED" -> UsbPrintErrorCode.USB_PERMISSION_REQUIRED
                    else -> UsbPrintErrorCode.USB_INTERFACE_NOT_FOUND
                }
                val disposition = PrintOutcomePolicy.classify(usbCode, 0)
                printingJob = ledger.markUsbFailed(
                    printingJob,
                    localCode,
                    0,
                    disposition.retryable,
                    disposition.uncertain,
                )
                reportPending(printingJob)
                return@withContext localCode
            }
            val bytes = try {
                renderControlledSnapshot(serverJob, settings)
            } catch (error: Throwable) {
                val localCode = if (
                    error is com.yunqiao.life.merchantterminal.printing.UsbPrinterException
                ) {
                    error.code.name
                } else {
                    "BITMAP_RENDER_FAILED"
                }
                printingJob = ledger.markUsbFailed(
                    printingJob,
                    localCode,
                    0,
                    retryable = false,
                    uncertain = false,
                )
                reportPending(printingJob)
                return@withContext localCode
            }
            // Rendering happens before the final lease extension and before any USB I/O. This gives
            // a normal receipt the full server-supported lease window without claiming stale work.
            try {
                val extended = api.extendLease(
                    jobId = printingJob.serverJobId,
                    leaseVersion = printingJob.leaseVersion,
                    leaseMs = PRINT_LEASE_MS,
                )
                printingJob = ledger.updateLease(
                    printingJob,
                    leaseVersion = extended.leaseVersion,
                    leaseExpiresAt = extended.leaseExpiresAt,
                )
            } catch (error: ConnectorApiException) {
                printingJob = ledger.markUsbFailed(
                    printingJob,
                    "LEASE_EXTEND_FAILED",
                    0,
                    retryable = true,
                    uncertain = false,
                )
                reportPending(printingJob)
                return@withContext error.errorCode
            }
            val adapter = adapterFactory()
            activeAdapter = adapter
            val connected = adapter.connect(resolution.config)
            if (connected.isFailure) {
                val code = (connected.exceptionOrNull() as? com.yunqiao.life.merchantterminal.printing.UsbPrinterException)
                    ?.code ?: UsbPrintErrorCode.USB_OPEN_FAILED
                val disposition = PrintOutcomePolicy.classify(code, 0)
                printingJob = ledger.markUsbFailed(
                    printingJob,
                    code.name,
                    0,
                    disposition.retryable,
                    disposition.uncertain,
                )
                reportPending(printingJob)
                return@withContext code.name
            }
            when (val result = adapter.print(PrintableDocument(bytes, "server-receipt-v1"))) {
                is PrintResult.Success -> {
                    printingJob = ledger.markUsbComplete(printingJob, result.writtenBytes)
                    if (!reportPending(printingJob)) "PRINTED_REPORT_PENDING" else "SUCCEEDED"
                }
                is PrintResult.Failure -> {
                    val disposition = PrintOutcomePolicy.classify(
                        result.code,
                        result.writtenBytes,
                        result.ioAttempted,
                    )
                    printingJob = ledger.markUsbFailed(
                        printingJob,
                        result.code.name,
                        result.writtenBytes,
                        disposition.retryable,
                        disposition.uncertain,
                    )
                    reportPending(printingJob)
                    if (disposition.uncertain) "UNCERTAIN" else result.code.name
                }
            }
        } catch (throwable: Throwable) {
            if (printingJob.status in LocalJobStatus.pendingReport) {
                // Physical outcome is already durably recorded. In particular, a 401/409 report
                // failure must reach the service gate handler and must never call finish twice.
                if (throwable is ConnectorApiException) throw throwable
                return@withContext "PRINT_REPORT_PENDING"
            }
            if (printingJob.status != LocalJobStatus.PRINTING) throw throwable
            // Once marked PRINTING, an unexpected exception is conservative: no blind retry.
            printingJob = ledger.markUsbFailed(
                printingJob,
                "PRINT_EXECUTION_EXCEPTION",
                printingJob.bytesWritten,
                retryable = false,
                uncertain = true,
            )
            reportPending(printingJob)
            "UNCERTAIN"
        } finally {
            withContext(NonCancellable) {
                activeAdapter?.disconnect()
                activeAdapter = null
            }
        }
    }

    private fun renderControlledSnapshot(
        job: ClaimedPrintJob,
        settings: ConnectorSettingsSnapshot,
    ): ByteArray {
        val binding = requireNotNull(settings.usbBinding)
        val receipt = ReceiptDocumentParser.parse(job.receiptSnapshotJson)
        require(receipt.receiptType.name == job.receiptType) { "Receipt type mismatch." }
        val bitmap = ReceiptDocumentRenderer.render(
            receipt,
            ProductionReceiptRenderConfig(
                paperWidth = binding.paperWidth,
                customDots = binding.customDots,
                jobId = job.id,
                contentHash = job.contentHash,
                printedAtEpochMs = System.currentTimeMillis(),
            ),
        )
        return try {
            EscPosRasterEncoder.encodeBitmap(bitmap, binding.threshold, binding.cutMode)
        } finally {
            bitmap.recycle()
        }
    }

    private companion object { const val PRINT_LEASE_MS = 120_000L }
}
