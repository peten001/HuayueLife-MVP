package com.yunqiao.life.merchantterminal.connector

import android.content.Context
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.data.local.LocalConnectorDataWiper
import com.yunqiao.life.merchantterminal.security.TerminalCredentialStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Idempotent removal of the independent terminal identity and all merchant-scoped local data. */
object TerminalIdentityReset {
    suspend fun clear(context: Context) = withContext(NonCancellable + Dispatchers.IO) {
        val app = context.applicationContext
        ConnectorServiceStarter.stop(app)
        ConnectorRecoveryScheduler.disable(app)
        // stopService() does not synchronously await an in-flight USB coroutine. Wait for the
        // shared execution/recovery lock so Room evidence and the snapshot key are not deleted
        // while a physical write is being classified or reported.
        ConnectorExecutionGate.exclusive {
            TerminalCredentialStore(app).clear()
            val settings = ConnectorSettings(app)
            settings.clearPairing()
            LocalConnectorDataWiper.clearIdentityBoundData(app)
            ConnectorStartGate.update(app, settings.snapshot(), false)
        }
    }
}
