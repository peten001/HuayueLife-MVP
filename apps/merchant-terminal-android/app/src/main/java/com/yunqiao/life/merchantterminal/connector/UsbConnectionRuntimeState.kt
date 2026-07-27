package com.yunqiao.life.merchantterminal.connector

data class UsbConnectionRuntimeSnapshot(
    val connectionOpen: Boolean,
    val interfaceClaimed: Boolean,
)

/**
 * Process-local evidence for the currently active USB adapter call.
 *
 * The USB ownership gate remains the concurrency authority. This tracker only separates open/claim
 * evidence from the foreground service lifecycle so diagnostics never infer hardware ownership from
 * serviceActive.
 */
class UsbConnectionRuntimeTracker {
    private var owner: Any? = null
    private var connectionOpen = false
    private var interfaceClaimed = false

    @Synchronized
    fun markConnectionOpen(ownerToken: Any) {
        if (owner != null && owner !== ownerToken) return
        owner = ownerToken
        connectionOpen = true
        interfaceClaimed = false
    }

    @Synchronized
    fun markInterfaceClaimed(ownerToken: Any) {
        if (owner !== ownerToken || !connectionOpen) return
        interfaceClaimed = true
    }

    @Synchronized
    fun markClosed(ownerToken: Any) {
        if (owner !== ownerToken) return
        owner = null
        connectionOpen = false
        interfaceClaimed = false
    }

    @Synchronized
    fun snapshot(): UsbConnectionRuntimeSnapshot = UsbConnectionRuntimeSnapshot(
        connectionOpen = connectionOpen,
        interfaceClaimed = interfaceClaimed,
    )
}

object ProcessUsbConnectionRuntime {
    val tracker = UsbConnectionRuntimeTracker()
}
