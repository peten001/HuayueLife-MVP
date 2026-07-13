package com.yunqiao.life.merchantterminal.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

private val Context.terminalSettingsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "terminal_settings",
)

data class TerminalSettingsSnapshot(
    val keepScreenOn: Boolean = true,
    val lastSuccessfulLoadAtEpochMs: Long? = null,
    val lastLoadErrorAtEpochMs: Long? = null,
    val lastLoadErrorCode: String? = null,
    val lastLoadErrorDetail: String? = null,
    val lastAttemptedUrl: String? = null,
)

class TerminalSettings(context: Context) {
    private val dataStore = context.applicationContext.terminalSettingsDataStore

    val values: Flow<TerminalSettingsSnapshot> = dataStore.data
        .catch { throwable ->
            if (throwable is IOException) emit(androidx.datastore.preferences.core.emptyPreferences())
            else throw throwable
        }
        .map { preferences ->
            TerminalSettingsSnapshot(
                keepScreenOn = preferences[Keys.KEEP_SCREEN_ON] ?: true,
                lastSuccessfulLoadAtEpochMs = preferences[Keys.LAST_SUCCESS_AT],
                lastLoadErrorAtEpochMs = preferences[Keys.LAST_ERROR_AT],
                lastLoadErrorCode = preferences[Keys.LAST_ERROR_CODE],
                lastLoadErrorDetail = preferences[Keys.LAST_ERROR_DETAIL],
                lastAttemptedUrl = preferences[Keys.LAST_ATTEMPTED_URL],
            )
        }

    suspend fun setKeepScreenOn(enabled: Boolean) {
        dataStore.edit { it[Keys.KEEP_SCREEN_ON] = enabled }
    }

    suspend fun recordPageLoadStarted(url: String) {
        dataStore.edit { it[Keys.LAST_ATTEMPTED_URL] = url.take(MAX_VALUE_LENGTH) }
    }

    suspend fun recordPageLoadSuccess(url: String, timestampEpochMs: Long = System.currentTimeMillis()) {
        dataStore.edit { preferences ->
            preferences[Keys.LAST_SUCCESS_AT] = timestampEpochMs
            preferences[Keys.LAST_ATTEMPTED_URL] = url.take(MAX_VALUE_LENGTH)
            preferences.remove(Keys.LAST_ERROR_AT)
            preferences.remove(Keys.LAST_ERROR_CODE)
            preferences.remove(Keys.LAST_ERROR_DETAIL)
        }
    }

    suspend fun recordPageLoadError(
        code: String,
        detail: String?,
        url: String?,
        timestampEpochMs: Long = System.currentTimeMillis(),
    ) {
        dataStore.edit { preferences ->
            preferences[Keys.LAST_ERROR_AT] = timestampEpochMs
            preferences[Keys.LAST_ERROR_CODE] = code.take(MAX_VALUE_LENGTH)
            detail?.takeIf(String::isNotBlank)?.let {
                preferences[Keys.LAST_ERROR_DETAIL] = it.take(MAX_VALUE_LENGTH)
            } ?: preferences.remove(Keys.LAST_ERROR_DETAIL)
            url?.takeIf(String::isNotBlank)?.let {
                preferences[Keys.LAST_ATTEMPTED_URL] = it.take(MAX_VALUE_LENGTH)
            }
        }
    }

    private object Keys {
        val KEEP_SCREEN_ON = booleanPreferencesKey("keep_screen_on")
        val LAST_SUCCESS_AT = longPreferencesKey("last_success_at_epoch_ms")
        val LAST_ERROR_AT = longPreferencesKey("last_error_at_epoch_ms")
        val LAST_ERROR_CODE = stringPreferencesKey("last_error_code")
        val LAST_ERROR_DETAIL = stringPreferencesKey("last_error_detail")
        val LAST_ATTEMPTED_URL = stringPreferencesKey("last_attempted_url")
    }

    private companion object {
        const val MAX_VALUE_LENGTH = 512
    }
}
