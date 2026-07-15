package com.yunqiao.life.merchantterminal.printing.usb

/**
 * Process-wide ownership held from USB connect through disconnect. Per-adapter mutexes are not
 * sufficient because diagnostics and the foreground connector create different adapter instances.
 */
class UsbIoOwnershipGate {
    private var owner: Any? = null

    @Synchronized
    fun tryAcquire(ownerToken: Any): Boolean {
        if (owner === ownerToken) return true
        if (owner != null) return false
        owner = ownerToken
        return true
    }

    @Synchronized
    fun release(ownerToken: Any) {
        if (owner === ownerToken) owner = null
    }

    @Synchronized
    fun isBusy(): Boolean = owner != null
}

object ProcessUsbIoOwnership {
    val gate = UsbIoOwnershipGate()
}
