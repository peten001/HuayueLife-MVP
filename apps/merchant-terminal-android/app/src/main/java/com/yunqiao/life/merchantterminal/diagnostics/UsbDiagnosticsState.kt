package com.yunqiao.life.merchantterminal.diagnostics

import com.yunqiao.life.merchantterminal.connector.UsbConnectionRuntimeSnapshot

enum class UsbPermissionState {
    UNVERIFIED,
    WAITING_PERMISSION,
    GRANTED,
}

data class UsbDiagnosticsStatus(
    val serviceActive: Boolean,
    val usbOwnershipActive: Boolean,
    val connectionOpen: Boolean,
    val interfaceClaimed: Boolean,
    val permissionState: UsbPermissionState,
)

data class UsbDiagnosticsControls(
    val requestPermissionEnabled: Boolean,
    val localUsbActionEnabled: Boolean,
    val selectionEnabled: Boolean,
    val refreshEnabled: Boolean,
)

object UsbDiagnosticsStateModel {
    fun status(
        serviceActive: Boolean,
        usbOwnershipActive: Boolean,
        connection: UsbConnectionRuntimeSnapshot,
        devicePresent: Boolean,
        hasPermission: Boolean,
    ): UsbDiagnosticsStatus = UsbDiagnosticsStatus(
        serviceActive = serviceActive,
        usbOwnershipActive = usbOwnershipActive,
        connectionOpen = connection.connectionOpen,
        interfaceClaimed = connection.interfaceClaimed,
        permissionState = when {
            !devicePresent -> UsbPermissionState.UNVERIFIED
            hasPermission -> UsbPermissionState.GRANTED
            else -> UsbPermissionState.WAITING_PERMISSION
        },
    )

    fun controls(
        status: UsbDiagnosticsStatus,
        usbHostSupported: Boolean,
        devicePresent: Boolean,
        endpointAvailable: Boolean,
        actionBusy: Boolean,
        permissionRequestPending: Boolean,
    ): UsbDiagnosticsControls {
        val localUsbActionEnabled = usbHostSupported &&
            devicePresent &&
            status.permissionState == UsbPermissionState.GRANTED &&
            endpointAvailable &&
            !actionBusy &&
            !status.usbOwnershipActive
        return UsbDiagnosticsControls(
            requestPermissionEnabled = devicePresent &&
                status.permissionState != UsbPermissionState.GRANTED &&
                !actionBusy &&
                !permissionRequestPending,
            localUsbActionEnabled = localUsbActionEnabled,
            selectionEnabled = !actionBusy && !status.usbOwnershipActive,
            refreshEnabled = !actionBusy,
        )
    }
}
