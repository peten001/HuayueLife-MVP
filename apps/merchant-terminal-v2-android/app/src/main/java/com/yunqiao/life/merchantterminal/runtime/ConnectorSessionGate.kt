package com.yunqiao.life.merchantterminal.runtime

import java.util.concurrent.atomic.AtomicBoolean

/** Prevents a sign-out from racing a pending Android foreground-service start. */
object ConnectorSessionGate {
    private val active = AtomicBoolean(true)

    fun allow() = active.set(true)
    fun revoke() = active.set(false)
    fun isAllowed(): Boolean = active.get()
}
