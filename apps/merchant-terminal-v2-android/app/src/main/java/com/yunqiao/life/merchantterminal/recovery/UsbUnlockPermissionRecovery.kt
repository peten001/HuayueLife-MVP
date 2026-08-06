package com.yunqiao.life.merchantterminal.recovery

import android.content.Context
import android.os.UserManager
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.yunqiao.life.merchantterminal.TerminalApplication
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceDescriptor
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.UsbPermissionRequestResult
import com.yunqiao.life.merchantterminal.printing.usb.UsbUnlockPermissionRequestCoordinator
import com.yunqiao.life.merchantterminal.printing.usb.V2UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.V2UsbBindingResolver
import com.yunqiao.life.merchantterminal.runtime.StartupTrace

internal sealed interface UsbUnlockRecoveryDecision {
    data class PermissionAlreadyGranted(val deviceName: String) : UsbUnlockRecoveryDecision
    data class RequestPermission(val deviceName: String) : UsbUnlockRecoveryDecision
    data class PermissionRequestPending(val deviceName: String) : UsbUnlockRecoveryDecision
    data class Skip(val errorCode: String) : UsbUnlockRecoveryDecision
}

internal object UsbUnlockPermissionRecoveryPlanner {
    fun decide(
        config: LocalTransportConfig.Usb,
        devices: List<UsbDeviceDescriptor>,
        pendingDeviceName: String?,
    ): UsbUnlockRecoveryDecision {
        val permissionNeutralDevices = devices.map { it.copy(hasPermission = true) }
        val matched = when (
            val resolution = V2UsbBindingResolver.resolve(config, permissionNeutralDevices)
        ) {
            is V2UsbBindingResolution.Ready -> resolution.device
            is V2UsbBindingResolution.Unavailable -> {
                return UsbUnlockRecoveryDecision.Skip(resolution.errorCode)
            }
        }
        val liveDevice = devices.firstOrNull { it.deviceName == matched.deviceName }
            ?: return UsbUnlockRecoveryDecision.Skip("USB_DEVICE_NOT_FOUND")
        if (liveDevice.hasPermission) {
            return UsbUnlockRecoveryDecision.PermissionAlreadyGranted(liveDevice.deviceName)
        }
        if (pendingDeviceName != null) {
            return UsbUnlockRecoveryDecision.PermissionRequestPending(pendingDeviceName)
        }
        return UsbUnlockRecoveryDecision.RequestPermission(liveDevice.deviceName)
    }
}

internal object UsbUnlockRecoveryGate {
    fun canReadCredentialProtectedData(userUnlocked: Boolean): Boolean = userUnlocked

    fun hasActiveUsbBinding(activeUsbBindingCount: Int): Boolean = activeUsbBindingCount > 0
}

class UsbUnlockPermissionRecoveryWorker(
    context: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val userManager = applicationContext.getSystemService(UserManager::class.java)
        if (
            !UsbUnlockRecoveryGate.canReadCredentialProtectedData(
                userManager?.isUserUnlocked == true,
            )
        ) {
            StartupTrace.event("USB_UNLOCK_RECOVERY_SKIPPED_USER_LOCKED")
            return Result.success()
        }
        val application = applicationContext as? TerminalApplication ?: return Result.failure()
        val credential = application.graph.credentialStore.readCredential()
            ?.takeIf { it.isUsable() }
        if (credential == null) {
            StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_FAILED code=CREDENTIAL_UNAVAILABLE")
            return Result.success()
        }
        val usbBindings = application.graph.printingRepository
            .activeBindings(credential.merchantId)
            .filter { it.transport == PrinterTransport.USB }
        if (!UsbUnlockRecoveryGate.hasActiveUsbBinding(usbBindings.size)) {
            StartupTrace.event("USB_UNLOCK_RECOVERY_NO_ACTIVE_BINDING")
            return Result.success()
        }

        val inspector = UsbDeviceInspector(applicationContext)
        var connectorRecoveryRequired = false
        for (binding in usbBindings) {
            val config = binding.transportConfig as LocalTransportConfig.Usb
            val decision = UsbUnlockPermissionRecoveryPlanner.decide(
                config = config,
                devices = inspector.scan(),
                pendingDeviceName = UsbUnlockPermissionRequestCoordinator.pendingDeviceName(),
            )
            when (decision) {
                is UsbUnlockRecoveryDecision.PermissionAlreadyGranted -> {
                    StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_ALREADY_GRANTED")
                    connectorRecoveryRequired = true
                }
                is UsbUnlockRecoveryDecision.PermissionRequestPending -> {
                    StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_REQUEST_PENDING")
                    rescheduleConnectorIfRequired(connectorRecoveryRequired)
                    return Result.success()
                }
                is UsbUnlockRecoveryDecision.RequestPermission -> {
                    val device = inspector.findDevice(decision.deviceName)
                    if (device == null) {
                        StartupTrace.event("USB_UNLOCK_RECOVERY_DEVICE_NOT_FOUND")
                        continue
                    }
                    when (
                        UsbUnlockPermissionRequestCoordinator.requestPermission(
                            applicationContext,
                            device,
                        ).result
                    ) {
                        UsbPermissionRequestResult.ALREADY_GRANTED -> {
                            StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_ALREADY_GRANTED")
                            connectorRecoveryRequired = true
                        }
                        UsbPermissionRequestResult.REQUEST_STARTED -> {
                            StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_REQUESTED")
                            rescheduleConnectorIfRequired(connectorRecoveryRequired)
                            return Result.success()
                        }
                        UsbPermissionRequestResult.REQUEST_ALREADY_PENDING -> {
                            StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_REQUEST_PENDING")
                            rescheduleConnectorIfRequired(connectorRecoveryRequired)
                            return Result.success()
                        }
                        UsbPermissionRequestResult.REQUEST_FAILED -> {
                            StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_FAILED")
                            rescheduleConnectorIfRequired(connectorRecoveryRequired)
                            return Result.success()
                        }
                    }
                }
                is UsbUnlockRecoveryDecision.Skip -> {
                    when (decision.errorCode) {
                        "USB_DEVICE_NOT_FOUND" -> {
                            StartupTrace.event("USB_UNLOCK_RECOVERY_DEVICE_NOT_FOUND")
                        }
                        "USB_DEVICE_AMBIGUOUS" -> {
                            StartupTrace.event("USB_UNLOCK_RECOVERY_AMBIGUOUS")
                        }
                        else -> {
                            StartupTrace.event(
                                "USB_UNLOCK_RECOVERY_PERMISSION_FAILED code=${decision.errorCode}",
                            )
                        }
                    }
                }
            }
        }
        rescheduleConnectorIfRequired(connectorRecoveryRequired)
        return Result.success()
    }

    private fun rescheduleConnectorIfRequired(required: Boolean) {
        if (!required) return
        V2RecoveryScheduler.schedule(applicationContext, "usb-permission-ready")
        StartupTrace.event("USB_UNLOCK_RECOVERY_CONNECTOR_RESCHEDULED")
    }
}
