package com.yunqiao.life.merchantterminal.runtime

import com.yunqiao.life.merchantterminal.network.V2TerminalConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ConnectorRuntimeStatus {
    STOPPED,
    STARTING,
    ONLINE,
    DEGRADED,
    SESSION_REQUIRED,
    RUNNING,
}

enum class UsbChannelState { NOT_CONFIGURED, CONNECTING, READY, OFFLINE, ERROR }
enum class LanChannelState { NOT_CONFIGURED, CONNECTING, READY, OFFLINE, ERROR }
enum class BluetoothChannelState { NOT_CONFIGURED, CONNECTING, READY_LOCAL, OFFLINE, ERROR, BACKEND_NOT_SUPPORTED }

data class TerminalRuntimeSnapshot(
    val status: ConnectorRuntimeStatus = ConnectorRuntimeStatus.STOPPED,
    val merchantId: String? = null,
    val config: V2TerminalConfig? = null,
    val lastErrorCode: String? = null,
    val usbChannel: UsbChannelState = UsbChannelState.NOT_CONFIGURED,
    val lanChannel: LanChannelState = LanChannelState.NOT_CONFIGURED,
    val bluetoothChannel: BluetoothChannelState = BluetoothChannelState.BACKEND_NOT_SUPPORTED,
    val updatedAt: Long = 0,
)

object TerminalRuntime {
    private val mutable = MutableStateFlow(TerminalRuntimeSnapshot())
    val state: StateFlow<TerminalRuntimeSnapshot> = mutable.asStateFlow()

    fun update(
        status: ConnectorRuntimeStatus,
        merchantId: String? = mutable.value.merchantId,
        config: V2TerminalConfig? = mutable.value.config,
        lastErrorCode: String? = null,
    ) {
        mutable.value = TerminalRuntimeSnapshot(
            status = status,
            merchantId = merchantId,
            config = config,
            lastErrorCode = lastErrorCode?.take(80),
            updatedAt = System.currentTimeMillis(),
        )
    }

    fun updateChannels(
        usb: UsbChannelState = mutable.value.usbChannel,
        lan: LanChannelState = mutable.value.lanChannel,
        bluetooth: BluetoothChannelState = mutable.value.bluetoothChannel,
    ) {
        mutable.value = mutable.value.copy(usbChannel = usb, lanChannel = lan, bluetoothChannel = bluetooth, updatedAt = System.currentTimeMillis())
    }
}
