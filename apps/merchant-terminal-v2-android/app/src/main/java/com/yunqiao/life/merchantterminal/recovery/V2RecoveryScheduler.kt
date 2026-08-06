package com.yunqiao.life.merchantterminal.recovery

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.yunqiao.life.merchantterminal.TerminalApplication
import com.yunqiao.life.merchantterminal.runtime.ConnectorRuntimeStatus
import com.yunqiao.life.merchantterminal.runtime.StartupTrace
import com.yunqiao.life.merchantterminal.runtime.TerminalRuntime
import com.yunqiao.life.merchantterminal.service.V2PrinterService
import java.util.concurrent.TimeUnit

object V2RecoveryScheduler {
    const val UNIQUE_WORK_NAME = "yunqiao-terminal-v2-connector-recovery"
    const val CREDENTIAL_RECOVERY_WORK_NAME =
        "yunqiao-terminal-v2-credential-recovery"
    const val USB_PERMISSION_RECOVERY_WORK_NAME =
        "yunqiao-usb-permission-recovery"

    fun schedule(context: Context, reason: String) {
        enqueue(context, UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP)
    }

    fun scheduleCredentialRecovery(context: Context) {
        enqueue(context, CREDENTIAL_RECOVERY_WORK_NAME, ExistingWorkPolicy.REPLACE)
    }

    fun scheduleUsbPermissionRecovery(context: Context, reason: String) {
        val request = OneTimeWorkRequestBuilder<UsbUnlockPermissionRecoveryWorker>()
            .setInitialDelay(250, TimeUnit.MILLISECONDS)
            .addTag(USB_PERMISSION_RECOVERY_WORK_NAME)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            USB_PERMISSION_RECOVERY_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
        val safeReason = reason.replace(Regex("[^A-Za-z0-9_.-]"), "_").take(80)
        StartupTrace.event("USB_UNLOCK_RECOVERY_SCHEDULED reason=$safeReason")
    }

    private fun enqueue(
        context: Context,
        workName: String,
        policy: ExistingWorkPolicy,
    ) {
        val request = OneTimeWorkRequestBuilder<V2ConnectorRecoveryWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setInitialDelay(250, TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag(workName)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            workName,
            policy,
            request,
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context.applicationContext).cancelUniqueWork(UNIQUE_WORK_NAME)
        WorkManager.getInstance(context.applicationContext)
            .cancelUniqueWork(CREDENTIAL_RECOVERY_WORK_NAME)
        WorkManager.getInstance(context.applicationContext)
            .cancelUniqueWork(USB_PERMISSION_RECOVERY_WORK_NAME)
    }
}

class V2ConnectorRecoveryWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val application = applicationContext as? TerminalApplication ?: return Result.failure()
        return try {
            val credential = application.graph.credentialStore.readCredential()
                ?.takeIf { it.isUsable() }
            if (credential == null) {
                val merchantJwt = application.graph.merchantSessionTokenStore.read()
                    ?: return Result.success()
                application.graph.sessionController.refreshCredential(merchantJwt)
            }
            application.graph.sessionController.requestConnectorServiceStart()
            Result.success()
        } catch (error: Throwable) {
            when (BootstrapRecoveryPolicy.classify(error)) {
                BootstrapRecoveryDisposition.MERCHANT_SESSION_REQUIRED -> {
                    application.graph.credentialStore.clearBearerCredential()
                    TerminalRuntime.update(ConnectorRuntimeStatus.SESSION_REQUIRED)
                    Result.failure()
                }
                BootstrapRecoveryDisposition.RETRY_WHEN_NETWORK_AVAILABLE -> {
                    TerminalRuntime.update(
                        ConnectorRuntimeStatus.DEGRADED,
                        lastErrorCode = (error as? com.yunqiao.life.merchantterminal.network.V2ApiException)
                            ?.errorCode
                            ?: error.javaClass.simpleName.take(80),
                    )
                    Result.retry()
                }
            }
        }
    }
}

internal data class TerminalRecoverySchedulePlan(
    val connectorRecovery: Boolean,
    val usbPermissionRecovery: Boolean,
)

internal object TerminalRecoveryActionPolicy {
    fun plan(action: String?): TerminalRecoverySchedulePlan = when (action) {
        Intent.ACTION_BOOT_COMPLETED,
        Intent.ACTION_LOCKED_BOOT_COMPLETED,
        -> TerminalRecoverySchedulePlan(
            connectorRecovery = true,
            usbPermissionRecovery = true,
        )
        Intent.ACTION_USER_UNLOCKED -> TerminalRecoverySchedulePlan(
            connectorRecovery = false,
            usbPermissionRecovery = true,
        )
        else -> TerminalRecoverySchedulePlan(
            connectorRecovery = true,
            usbPermissionRecovery = false,
        )
    }
}

class TerminalRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action
        val plan = TerminalRecoveryActionPolicy.plan(action)
        if (plan.connectorRecovery) {
            V2RecoveryScheduler.schedule(context, action.orEmpty().take(80))
        }
        if (plan.usbPermissionRecovery) {
            V2RecoveryScheduler.scheduleUsbPermissionRecovery(
                context,
                action.orEmpty().take(80),
            )
        }
    }
}
