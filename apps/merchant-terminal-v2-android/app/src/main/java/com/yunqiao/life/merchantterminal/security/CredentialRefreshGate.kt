package com.yunqiao.life.merchantterminal.security

/**
 * Allows one terminal-credential bootstrap after an invalid/expired bearer. A successful
 * authenticated config fetch opens the gate for a future, independently observed expiry.
 */
class CredentialRefreshGate {
    private var attemptedSinceHealthy = false

    @Synchronized
    fun tryBegin(): Boolean {
        if (attemptedSinceHealthy) return false
        attemptedSinceHealthy = true
        return true
    }

    @Synchronized
    fun markHealthy() {
        attemptedSinceHealthy = false
    }
}
