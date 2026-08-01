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
}

data class TerminalRuntimeSnapshot(
    val status: ConnectorRuntimeStatus = ConnectorRuntimeStatus.STOPPED,
    val merchantId: String? = null,
    val config: V2TerminalConfig? = null,
    val lastErrorCode: String? = null,
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
}
