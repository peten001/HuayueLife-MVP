package com.yunqiao.life.merchantterminal.runtime

import android.util.Log

/**
 * Deliberately credential-free startup trace for field diagnosis.  Event names
 * are stable so logcat can identify the startup boundary without exposing a
 * merchant JWT, terminal credential, secret, or password.
 */
object StartupTrace {
    private const val TAG = "YQ_V2_STARTUP"

    fun event(name: String) {
        write(name)
    }

    fun api(
        endpoint: String,
        status: Int,
        code: String?,
        requestId: String?,
        authenticationScheme: String,
    ) {
        val safeCode = code?.replace(Regex("[^A-Za-z0-9_.-]"), "_")?.take(80) ?: "NONE"
        val safeRequestId = requestId?.replace(Regex("[^A-Za-z0-9_.-]"), "_")?.take(128) ?: "NONE"
        write("API endpoint=$endpoint status=$status code=$safeCode requestId=$safeRequestId auth=$authenticationScheme")
    }

    // android.util.Log is an unmocked stub in plain JVM unit tests.
    private fun write(message: String) {
        runCatching { Log.i(TAG, message) }
    }
}
