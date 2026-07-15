package com.yunqiao.life.merchantterminal.data.local

import android.content.Context
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.security.ReceiptSnapshotCipher

/**
 * Removes all merchant/terminal-scoped local printing material during unpair or reassignment.
 * WebView cookies and merchant web login state are intentionally outside this boundary.
 */
object LocalConnectorDataWiper {
    suspend fun clearIdentityBoundData(context: Context) {
        val app = context.applicationContext
        LocalPrintingDatabase.get(app).clearAllTables()
        ReceiptSnapshotCipher.clearKey()
        ConnectorSettings(app).clearUsbBinding()
    }
}
