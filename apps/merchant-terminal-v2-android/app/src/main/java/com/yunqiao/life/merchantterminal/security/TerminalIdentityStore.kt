package com.yunqiao.life.merchantterminal.security

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.util.UUID

private val Context.terminalV2DataStore by preferencesDataStore(name = "terminal_v2_settings")

class TerminalIdentityStore(context: Context) {
    private val dataStore = context.applicationContext.terminalV2DataStore

    suspend fun terminalInstanceId(): String {
        val existing = dataStore.data.first()[TERMINAL_INSTANCE_ID]
        if (existing != null && runCatching { UUID.fromString(existing) }.isSuccess) return existing
        val created = UUID.randomUUID().toString()
        dataStore.edit { values ->
            if (values[TERMINAL_INSTANCE_ID] == null) values[TERMINAL_INSTANCE_ID] = created
        }
        return dataStore.data.first()[TERMINAL_INSTANCE_ID] ?: created
    }

    suspend fun setUiPreference(key: Preferences.Key<String>, value: String) {
        require(key != TERMINAL_INSTANCE_ID) { "Terminal identity is managed internally." }
        dataStore.edit { it[key] = value.take(256) }
    }

    companion object {
        val TERMINAL_INSTANCE_ID = stringPreferencesKey("terminal_instance_id")
        val LAST_SELECTED_PAPER_WIDTH = stringPreferencesKey("last_selected_paper_width")
    }
}
