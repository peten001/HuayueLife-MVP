package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Non-secret boot hint. The service always rechecks DataStore, Keystore and USB permission. */
object ConnectorStartGate {
    private const val NAME = "connector_start_gate"
    private const val KEY_MAY_START = "may_start"

    fun update(context: Context, settings: ConnectorSettingsSnapshot, hasCredential: Boolean) {
        val mayStart = hasCredential && settings.connectorEnabled &&
            settings.usbBinding != null && ConnectorApiConfig.isConfigured
        context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_MAY_START, mayStart).apply()
    }

    fun mayAttemptStart(context: Context): Boolean = context.applicationContext
        .getSharedPreferences(NAME, Context.MODE_PRIVATE)
        .getBoolean(KEY_MAY_START, false)
}

/** Process-local guard preventing WorkManager from classifying an in-flight service write as a crash. */
object ConnectorRuntimeState {
    @Volatile var serviceActive: Boolean = false
        private set

    fun serviceStarted() {
        serviceActive = true
    }

    fun serviceStopped() {
        serviceActive = false
    }
}

/**
 * Serializes service execution and process-death recovery. The Worker rechecks serviceActive while
 * holding this lock, closing the check-then-recover race with a newly started foreground service.
 */
object ConnectorExecutionGate {
    private val mutex = Mutex()

    suspend fun <T> exclusive(block: suspend () -> T): T = mutex.withLock { block() }
}
