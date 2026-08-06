package com.yunqiao.life.merchantterminal.printing.usb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import com.yunqiao.life.merchantterminal.recovery.V2RecoveryScheduler
import com.yunqiao.life.merchantterminal.runtime.StartupTrace

class UsbPermissionRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ACTION_USB_UNLOCK_PERMISSION) return
        UsbUnlockPermissionRequestCoordinator.handleResult(context, intent)
    }

    companion object {
        const val ACTION_USB_UNLOCK_PERMISSION =
            "com.yunqiao.life.merchantterminal.action.USB_UNLOCK_PERMISSION_RESULT"
        internal const val EXTRA_REQUESTED_DEVICE_NAME = "requested_usb_device_name"
    }
}

internal object UsbUnlockPermissionRequestCoordinator {
    @Volatile
    private var state: RequestState? = null

    fun requestPermission(
        context: Context,
        device: UsbDevice,
    ): UsbPermissionRequestOutcome {
        val applicationContext = context.applicationContext
        val manager = applicationContext.getSystemService(UsbManager::class.java)
        val permissionIntent = Intent(
            applicationContext,
            UsbPermissionRecoveryReceiver::class.java,
        ).apply {
            action = UsbPermissionRecoveryReceiver.ACTION_USB_UNLOCK_PERMISSION
            setPackage(applicationContext.packageName)
            putExtra(UsbPermissionRecoveryReceiver.EXTRA_REQUESTED_DEVICE_NAME, device.deviceName)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            applicationContext,
            USB_UNLOCK_PERMISSION_REQUEST_CODE,
            permissionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        return requestUsbPermission(
            manager = manager,
            device = device,
            pendingIntent = pendingIntent,
            tracker = state(applicationContext).tracker,
        )
    }

    fun pendingDeviceName(): String? = state?.tracker?.pendingDeviceName

    fun handleResult(context: Context, intent: Intent) {
        val applicationContext = context.applicationContext
        val manager = applicationContext.getSystemService(UsbManager::class.java)
        val requestedName = intent.getStringExtra(
            UsbPermissionRecoveryReceiver.EXTRA_REQUESTED_DEVICE_NAME,
        )
        val resultDevice = intent.usbDevice()
            ?: requestedName?.let { manager?.deviceList?.get(it) }
        val deviceName = resultDevice?.deviceName
            ?: requestedName
            ?: state?.tracker?.pendingDeviceName
        if (deviceName == null) {
            StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_FAILED")
            return
        }
        val granted = UsbPermissionRecoveryResultPolicy.isGranted(
            resultFlag = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false),
            devicePresent = resultDevice != null,
            managerHasPermission = resultDevice != null && manager?.hasPermission(resultDevice) == true,
        )
        if (!state(applicationContext).tracker.complete(deviceName, granted)) {
            StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_FAILED")
        }
    }

    @Synchronized
    private fun state(context: Context): RequestState {
        state?.let { return it }
        val created = RequestState(
            tracker = UsbPermissionRequestTracker(
                onPermissionResult = { _, granted ->
                    if (granted) {
                        StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_GRANTED")
                        V2RecoveryScheduler.scheduleUsbPermissionRecovery(
                            context,
                            "permission-granted",
                        )
                    } else {
                        StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_DENIED")
                    }
                },
                onPermissionTimeout = {
                    StartupTrace.event("USB_UNLOCK_RECOVERY_PERMISSION_TIMEOUT")
                },
                timeoutScheduler = AndroidUsbPermissionTimeoutScheduler(),
            ),
        )
        state = created
        return created
    }

    private data class RequestState(
        val tracker: UsbPermissionRequestTracker,
    )

    private const val USB_UNLOCK_PERMISSION_REQUEST_CODE = 4_822
}

internal object UsbPermissionRecoveryResultPolicy {
    fun isGranted(
        resultFlag: Boolean,
        devicePresent: Boolean,
        managerHasPermission: Boolean,
    ): Boolean = resultFlag && devicePresent && managerHasPermission
}

@Suppress("DEPRECATION")
private fun Intent.usbDevice(): UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
} else {
    getParcelableExtra(UsbManager.EXTRA_DEVICE)
}
