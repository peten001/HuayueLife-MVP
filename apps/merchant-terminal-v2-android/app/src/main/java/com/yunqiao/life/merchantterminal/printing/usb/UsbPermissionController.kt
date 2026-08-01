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
import androidx.core.content.ContextCompat

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
    private val onDeviceAttached: (deviceName: String?) -> Unit,
    private val onDeviceDetached: (deviceName: String?) -> Unit,
) {
    private val usbManager = activity.getSystemService(UsbManager::class.java)
    private var receiverRegistered = false
    private var pendingDeviceName: String? = null

    private val attachDetachReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val deviceName = intent.usbDevice()?.deviceName
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> onDeviceAttached(deviceName)
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    if (deviceName == pendingDeviceName) pendingDeviceName = null
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

    fun requestPermission(device: UsbDevice): Boolean {
        val manager = usbManager ?: return false
        if (manager.hasPermission(device)) {
            pendingDeviceName = null
            onPermissionResult(device.deviceName, true)
            return true
        }
        if (pendingDeviceName != null) return false

        pendingDeviceName = device.deviceName
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
        return runCatching { manager.requestPermission(device, pendingIntent) }
            .onFailure { pendingDeviceName = null }
            .isSuccess
    }

    /** Call from Activity.onNewIntent. Returns true when the intent was a permission result. */
    fun handlePermissionResult(intent: Intent?): Boolean {
        if (intent?.action != ACTION_USB_PERMISSION) return false
        val requestedName = intent.getStringExtra(EXTRA_REQUESTED_DEVICE_NAME)
        val device = intent.usbDevice()
        val deviceName = device?.deviceName ?: requestedName ?: pendingDeviceName
        if (deviceName == null || (pendingDeviceName != null && pendingDeviceName != deviceName)) {
            return true
        }

        val grantedByResult = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
        val granted = device?.let { usbManager?.hasPermission(it) == true } == true && grantedByResult
        pendingDeviceName = null
        onPermissionResult(deviceName, granted)
        return true
    }

    fun hasPendingRequest(): Boolean = pendingDeviceName != null

    fun reconcileAttachedDevices(deviceNames: Set<String>) {
        if (pendingDeviceName !in deviceNames) pendingDeviceName = null
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
