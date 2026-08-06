package com.yunqiao.life.merchantterminal.printing.usb

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

enum class UsbPermissionRequestResult {
    ALREADY_GRANTED,
    REQUEST_STARTED,
    REQUEST_ALREADY_PENDING,
    REQUEST_FAILED,
}

data class UsbPermissionRequestOutcome(
    val result: UsbPermissionRequestResult,
    val pendingDeviceName: String? = null,
)

fun interface UsbPermissionTimeoutCancellation {
    fun cancel()
}

fun interface UsbPermissionTimeoutScheduler {
    fun schedule(delayMs: Long, action: () -> Unit): UsbPermissionTimeoutCancellation
}

internal const val USB_PERMISSION_TIMEOUT_MS = 15_000L

internal class AndroidUsbPermissionTimeoutScheduler : UsbPermissionTimeoutScheduler {
    private val handler = Handler(Looper.getMainLooper())

    override fun schedule(
        delayMs: Long,
        action: () -> Unit,
    ): UsbPermissionTimeoutCancellation {
        val runnable = Runnable(action)
        handler.postDelayed(runnable, delayMs)
        return UsbPermissionTimeoutCancellation { handler.removeCallbacks(runnable) }
    }
}

internal fun requestUsbPermission(
    manager: UsbManager?,
    device: UsbDevice,
    pendingIntent: PendingIntent,
    tracker: UsbPermissionRequestTracker,
): UsbPermissionRequestOutcome {
    if (manager == null) {
        return UsbPermissionRequestOutcome(UsbPermissionRequestResult.REQUEST_FAILED)
    }
    return tracker.begin(
        deviceName = device.deviceName,
        alreadyGranted = manager.hasPermission(device),
    ) {
        runCatching { manager.requestPermission(device, pendingIntent) }.isSuccess
    }
}

internal class UsbPermissionRequestTracker(
    private val onPermissionResult: (deviceName: String, granted: Boolean) -> Unit,
    private val onPermissionTimeout: (deviceName: String) -> Unit,
    private val timeoutScheduler: UsbPermissionTimeoutScheduler,
) {
    @Volatile
    var pendingDeviceName: String? = null
        private set
    private var timeoutCancellation: UsbPermissionTimeoutCancellation? = null

    @Synchronized
    fun begin(
        deviceName: String,
        alreadyGranted: Boolean,
        startRequest: () -> Boolean,
    ): UsbPermissionRequestOutcome {
        if (alreadyGranted) {
            clearPending()
            onPermissionResult(deviceName, true)
            return UsbPermissionRequestOutcome(UsbPermissionRequestResult.ALREADY_GRANTED)
        }
        pendingDeviceName?.let { pending ->
            return UsbPermissionRequestOutcome(
                UsbPermissionRequestResult.REQUEST_ALREADY_PENDING,
                pending,
            )
        }
        pendingDeviceName = deviceName
        val started = runCatching(startRequest).getOrDefault(false)
        if (!started) {
            clearPending()
            return UsbPermissionRequestOutcome(UsbPermissionRequestResult.REQUEST_FAILED)
        }
        timeoutCancellation = timeoutScheduler.schedule(USB_PERMISSION_TIMEOUT_MS) {
            completeTimeout(deviceName)
        }
        return UsbPermissionRequestOutcome(
            UsbPermissionRequestResult.REQUEST_STARTED,
            deviceName,
        )
    }

    @Synchronized
    fun complete(deviceName: String, granted: Boolean): Boolean {
        if (pendingDeviceName != null && pendingDeviceName != deviceName) return false
        clearPending()
        onPermissionResult(deviceName, granted)
        return true
    }

    @Synchronized
    fun onDetached(deviceName: String?) {
        if (deviceName != null && pendingDeviceName == deviceName) clearPending()
    }

    @Synchronized
    fun reconcileAttachedDevices(deviceNames: Set<String>) {
        if (pendingDeviceName !in deviceNames) clearPending()
    }

    @Synchronized
    fun clear() {
        clearPending()
    }

    @Synchronized
    private fun completeTimeout(deviceName: String) {
        if (pendingDeviceName != deviceName) return
        clearPending()
        onPermissionTimeout(deviceName)
    }

    private fun clearPending() {
        timeoutCancellation?.cancel()
        timeoutCancellation = null
        pendingDeviceName = null
    }
}

/**
 * Activity-scoped USB permission and attach/detach coordinator.
 *
 * The permission result uses an explicit Activity PendingIntent, so no exported custom broadcast
 * receiver is needed. USB attach/detach broadcasts only trigger a fresh scan; their payload is
 * never trusted as permission or as a selected printer identity.
 */
class UsbPermissionController(
    private val activity: Activity,
    private val onPermissionResult: (deviceName: String, granted: Boolean) -> Unit,
    private val onPermissionTimeout: (deviceName: String) -> Unit,
    private val onDeviceAttached: (deviceName: String?) -> Unit,
    private val onDeviceDetached: (deviceName: String?) -> Unit,
    timeoutScheduler: UsbPermissionTimeoutScheduler = AndroidUsbPermissionTimeoutScheduler(),
) {
    private val usbManager = activity.getSystemService(UsbManager::class.java)
    private var receiverRegistered = false
    private val requestTracker = UsbPermissionRequestTracker(
        onPermissionResult = onPermissionResult,
        onPermissionTimeout = onPermissionTimeout,
        timeoutScheduler = timeoutScheduler,
    )

    private val attachDetachReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val deviceName = intent.usbDevice()?.deviceName
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> onDeviceAttached(deviceName)
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    requestTracker.onDetached(deviceName)
                    onDeviceDetached(deviceName)
                }
            }
        }
    }

    fun register() {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        ContextCompat.registerReceiver(
            activity,
            attachDetachReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED,
        )
        receiverRegistered = true
    }

    fun unregister() {
        if (!receiverRegistered) return
        runCatching { activity.unregisterReceiver(attachDetachReceiver) }
        receiverRegistered = false
    }

    fun requestPermission(device: UsbDevice): UsbPermissionRequestOutcome {
        val permissionIntent = Intent(activity, activity::class.java).apply {
            action = ACTION_USB_PERMISSION
            setPackage(activity.packageName)
            putExtra(EXTRA_REQUESTED_DEVICE_NAME, device.deviceName)
        }
        val pendingIntent = PendingIntent.getActivity(
            activity,
            USB_PERMISSION_REQUEST_CODE,
            permissionIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        return requestUsbPermission(usbManager, device, pendingIntent, requestTracker)
    }

    /** Call from Activity.onNewIntent. Returns true when the intent was a permission result. */
    fun handlePermissionResult(intent: Intent?): Boolean {
        if (intent?.action != ACTION_USB_PERMISSION) return false
        val requestedName = intent.getStringExtra(EXTRA_REQUESTED_DEVICE_NAME)
        val device = intent.usbDevice()
        val deviceName = device?.deviceName ?: requestedName ?: requestTracker.pendingDeviceName
            ?: return true

        val grantedByResult = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
        val granted = device?.let { usbManager?.hasPermission(it) == true } == true && grantedByResult
        requestTracker.complete(deviceName, granted)
        return true
    }

    fun hasPendingRequest(): Boolean = requestTracker.pendingDeviceName != null

    fun pendingDeviceName(): String? = requestTracker.pendingDeviceName

    fun reconcileAttachedDevices(deviceNames: Set<String>) {
        requestTracker.reconcileAttachedDevices(deviceNames)
    }

    fun clear() {
        requestTracker.clear()
    }

    @Suppress("DEPRECATION")
    private fun Intent.usbDevice(): UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
    } else {
        getParcelableExtra(UsbManager.EXTRA_DEVICE)
    }

    companion object {
        const val ACTION_USB_PERMISSION =
            "com.yunqiao.life.merchantterminal.action.USB_PERMISSION_RESULT"
        private const val EXTRA_REQUESTED_DEVICE_NAME = "requested_usb_device_name"
        private const val USB_PERMISSION_REQUEST_CODE = 4_821
    }
}

data class UsbAttachmentState(
    val connectedDeviceNames: Set<String> = emptySet(),
    val selectedDeviceName: String? = null,
    val selectedDeviceDetached: Boolean = false,
) {
    fun onScan(deviceNames: Set<String>): UsbAttachmentState = copy(
        connectedDeviceNames = deviceNames,
        selectedDeviceDetached = selectedDeviceName != null && selectedDeviceName !in deviceNames,
    )

    fun onSelected(deviceName: String?): UsbAttachmentState = copy(
        selectedDeviceName = deviceName,
        selectedDeviceDetached = deviceName != null && deviceName !in connectedDeviceNames,
    )

    fun onDetached(deviceName: String?): UsbAttachmentState {
        if (deviceName == null) return this
        return copy(
            connectedDeviceNames = connectedDeviceNames - deviceName,
            selectedDeviceDetached = selectedDeviceDetached || selectedDeviceName == deviceName,
        )
    }
}
