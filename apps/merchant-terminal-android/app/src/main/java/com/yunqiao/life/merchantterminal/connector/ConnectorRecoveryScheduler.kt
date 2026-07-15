package com.yunqiao.life.merchantterminal.connector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.yunqiao.life.merchantterminal.data.local.LocalJobStatus
import com.yunqiao.life.merchantterminal.data.local.LocalPrintLedger
import com.yunqiao.life.merchantterminal.data.local.LocalPrintingDatabase
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.security.TerminalCredentialStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

object ConnectorRecoveryScheduler {
    private val networkConstraint = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun enable(context: Context) {
        WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
            PERIODIC_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<ConnectorRecoveryWorker>(15, TimeUnit.MINUTES)
                .setConstraints(networkConstraint)
                .build(),
        )
        enqueueNetworkRecovery(context)
    }

    fun disable(context: Context) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(PERIODIC_NAME)
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(ONE_TIME_NAME)
    }

    fun enqueueNetworkRecovery(context: Context) {
        if (!ConnectorStartGate.mayAttemptStart(context)) return
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            ONE_TIME_NAME,
            ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ConnectorRecoveryWorker>()
                .setConstraints(networkConstraint)
                .build(),
        )
    }

    private const val PERIODIC_NAME = "merchant-terminal-connector-health"
    private const val ONE_TIME_NAME = "merchant-terminal-connector-network-recovery"
}

class ConnectorRecoveryWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        if (!ConnectorStartGate.mayAttemptStart(applicationContext)) return Result.success()
        val credentials = TerminalCredentialStore(applicationContext)
        if (!credentials.hasCredential() || !ConnectorApiConfig.isConfigured) return Result.success()
        val dao = LocalPrintingDatabase.get(applicationContext).printingDao()
        val api = ConnectorApiClient(credentials::read)
        val executor = UsbPrintJobExecutor(
            applicationContext,
            api,
            LocalPrintLedger(dao),
        )
        var recoveryPerformed = false
        try {
            recoveryPerformed = ConnectorExecutionGate.exclusive {
                if (
                    ConnectorRuntimeState.serviceActive ||
                    !ConnectorStartGate.mayAttemptStart(applicationContext) ||
                    !credentials.hasCredential()
                ) {
                    false
                } else {
                    executor.recoverAfterProcessRestart()
                    true
                }
            }
        } catch (error: ConnectorApiException) {
            if (error.invalidTerminalCredential) {
                TerminalIdentityReset.clear(applicationContext)
                return Result.success()
            }
            ConnectorSettings(applicationContext).recordError(error.errorCode)
            if (
                error.errorCode in setOf(
                    "TERMINAL_DISABLED",
                    "PRINTING_TASK_CENTER_DISABLED",
                    "PRINTING_EXECUTION_DISABLED",
                )
            ) return Result.success()
            return if (runAttemptCount < MAX_ONE_TIME_RETRIES) Result.retry() else Result.failure()
        }
        if (!recoveryPerformed) return Result.success()
        val pendingReports = dao.jobsWithStatuses(
            listOf(
                LocalJobStatus.PRINTED_PENDING_REPORT,
                LocalJobStatus.FAILED_PENDING_REPORT,
                LocalJobStatus.UNCERTAIN_PENDING_REPORT,
            ),
        )
        if (!ConnectorRuntimeState.serviceActive) {
            // WorkManager is not an Android 12+ foreground-service-start exemption. It may upload
            // pending reports, but never performs USB I/O or silently attempts a blocked FGS start.
            ConnectorAttentionNotifier.showServiceRestartRequired(applicationContext)
        }
        // Bound one-time retries; periodic work remains the long-term safety net.
        return if (pendingReports.isNotEmpty() && runAttemptCount < MAX_ONE_TIME_RETRIES) {
            Result.retry()
        } else {
            Result.success()
        }
    }

    private companion object { const val MAX_ONE_TIME_RETRIES = 2 }
}

class ConnectorBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in SUPPORTED_ACTIONS || !ConnectorStartGate.mayAttemptStart(context)) return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                ConnectorRecoveryScheduler.enable(context)
                handleRecoveryStart(context, ConnectorServiceStarter.startIfEligible(context))
            } finally {
                pending.finish()
            }
        }
    }

    private companion object {
        val SUPPORTED_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
        )
    }
}

class ConnectorUsbAttachReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != android.hardware.usb.UsbManager.ACTION_USB_DEVICE_ATTACHED ||
            !ConnectorStartGate.mayAttemptStart(context)
        ) return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                ConnectorRecoveryScheduler.enqueueNetworkRecovery(context)
                handleRecoveryStart(context, ConnectorServiceStarter.startIfEligible(context))
            } finally {
                pending.finish()
            }
        }
    }
}

private suspend fun handleRecoveryStart(context: Context, result: ConnectorStartResult) {
    when (result) {
        ConnectorStartResult.STARTED -> ConnectorAttentionNotifier.clear(context)
        ConnectorStartResult.USB_UNAVAILABLE ->
            ConnectorAttentionNotifier.showUsbIssueIfNeeded(context)
        ConnectorStartResult.START_BLOCKED ->
            ConnectorAttentionNotifier.showServiceRestartRequired(context)
        ConnectorStartResult.NOT_CONFIGURED,
        ConnectorStartResult.NOT_ELIGIBLE -> Unit
    }
}
