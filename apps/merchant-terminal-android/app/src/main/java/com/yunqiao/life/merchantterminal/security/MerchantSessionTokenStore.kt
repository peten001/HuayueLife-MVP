package com.yunqiao.life.merchantterminal.security

import android.annotation.SuppressLint
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.json.JSONTokener
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores a remembered merchant/staff Web session encrypted by a non-exportable Android Keystore
 * key. A sessionStorage login stays process-only and therefore cannot survive a process restart.
 */
class MerchantSessionTokenStore(
    context: Context,
    private val keyAccess: MerchantSessionKeyAccess = AndroidMerchantSessionKeyAccess(),
) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun save(token: String, persistent: Boolean) = synchronized(SESSION_LOCK) {
        require(token.length in 24..MAX_TOKEN_LENGTH) { "Merchant session token length is invalid." }
        require(token.none { it.isWhitespace() || it.code < 0x20 }) {
            "Merchant session token contains invalid characters."
        }
        if (!persistent) {
            clearPersistent()
            processOnlyToken = token
            return@synchronized
        }
        processOnlyToken = null
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keyAccess.getOrCreate())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(KEY_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply()
    }

    fun read(): String? = synchronized(SESSION_LOCK) {
        processOnlyToken?.let { return@synchronized it }
        val iv = preferences.getString(KEY_IV, null)?.decodeBase64() ?: return null
        val ciphertext = preferences.getString(KEY_CIPHERTEXT, null)?.decodeBase64() ?: return null
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            val key = keyAccess.existing() ?: return null
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
                .takeIf { it.length in 24..MAX_TOKEN_LENGTH }
        }.getOrNull()
    }

    fun hasCredential(): Boolean = read() != null

    fun isPersistent(): Boolean = synchronized(SESSION_LOCK) {
        processOnlyToken == null && preferences.contains(KEY_CIPHERTEXT) && read() != null
    }

    fun clear() = synchronized(SESSION_LOCK) {
        processOnlyToken = null
        clearPersistent()
    }

    @SuppressLint("ApplySharedPref")
    private fun clearPersistent() {
        // Sign-out must remove ciphertext synchronously before the connector can be reconsidered.
        preferences.edit().clear().commit()
        keyAccess.delete()
    }

    private fun String.decodeBase64(): ByteArray? = runCatching {
        Base64.decode(this, Base64.NO_WRAP)
    }.getOrNull()

    private companion object {
        val SESSION_LOCK = Any()
        var processOnlyToken: String? = null
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val PREFERENCES_NAME = "merchant_session_token_encrypted"
        const val KEY_IV = "iv"
        const val KEY_CIPHERTEXT = "ciphertext"
        const val GCM_TAG_BITS = 128
        const val MAX_TOKEN_LENGTH = 4_096
    }
}

enum class MerchantWebSessionPersistence {
    PERSISTENT,
    PROCESS,
}

sealed class MerchantWebSessionSnapshot {
    data class Authenticated(
        val token: String,
        val persistence: MerchantWebSessionPersistence,
    ) : MerchantWebSessionSnapshot()

    data object SignedOut : MerchantWebSessionSnapshot()
    data object Invalid : MerchantWebSessionSnapshot()
}

/**
 * Pure, fail-closed routing for messages received from the WebView bridge.
 * Keeping the origin and frame checks here makes the native boundary testable
 * without a physical terminal or a real merchant credential.
 */
sealed class MerchantWebSessionMessageAction {
    data object OpenPrinterSettings : MerchantWebSessionMessageAction()
    data object SignedOut : MerchantWebSessionMessageAction()
    data class Synchronize(val snapshot: MerchantWebSessionSnapshot.Authenticated) : MerchantWebSessionMessageAction()
    data class OpenConnectorControl(val snapshot: MerchantWebSessionSnapshot.Authenticated) : MerchantWebSessionMessageAction()
    data object Ignore : MerchantWebSessionMessageAction()
}

/**
 * Contract between the trusted cashier document and the native connector session.
 *
 * The bridge accepts messages only from the configured trusted origin's main frame. The native
 * polling path remains available as a fallback for the same storage contract.
 */
object MerchantWebSessionContract {
    const val STORAGE_KEY = "yunqiao_cashier_access_token"
    const val SIGNAL_OBJECT_NAME = "YunQiaoMerchantSession"
    const val SIGN_OUT_MESSAGE = "SIGNED_OUT"
    const val OPEN_PRINTER_SETTINGS_MESSAGE = "OPEN_PRINTER_SETTINGS"
    const val SESSION_AUTHENTICATED_MESSAGE = "SESSION_AUTHENTICATED"
    const val OPEN_CONNECTOR_CONTROL_MESSAGE = "OPEN_CONNECTOR_CONTROL"

    private val merchantJwt =
        Regex("^[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}$")

    fun snapshotScript(): String =
        """(function(){try{""" +
            "var key='$STORAGE_KEY';" +
            "var local=window.localStorage.getItem(key);" +
            "if(local){return JSON.stringify({state:'AUTHENTICATED',persistence:'PERSISTENT',token:local});}" +
            "var session=window.sessionStorage.getItem(key);" +
            "if(session){return JSON.stringify({state:'AUTHENTICATED',persistence:'PROCESS',token:session});}" +
            "return JSON.stringify({state:'SIGNED_OUT'});" +
            "}catch(e){return JSON.stringify({state:'INVALID'});}})()"

    fun logoutObserverScript(): String =
        """(function(){""" +
            "if(window.top!==window||window.__yunqiaoMerchantSessionObserver){return;}" +
            "var bridge=window.$SIGNAL_OBJECT_NAME;" +
            "if(!bridge||typeof bridge.postMessage!=='function'){return;}" +
            "var key='$STORAGE_KEY';" +
            "var hasSession=function(){try{return !!(window.localStorage.getItem(key)||" +
            "window.sessionStorage.getItem(key));}catch(e){return false;}};" +
            "var previous=hasSession();" +
            "window.__yunqiaoMerchantSessionObserver=window.setInterval(function(){" +
            "var current=hasSession();" +
            "if(previous&&!current){bridge.postMessage('$SIGN_OUT_MESSAGE');}" +
            "previous=current;" +
            "},250);" +
            "})()"

    /** Adds the merchant-facing USB settings entry only inside the stable account-menu panel. */
    fun printerSettingsMenuObserverScript(): String =
        """(function(){""" +
            "if(window.top!==window||window.__yunqiaoPrinterSettingsMenuObserver){return;}" +
            "var bridge=window.$SIGNAL_OBJECT_NAME;if(!bridge||typeof bridge.postMessage!=='function'){return;}" +
            "var attach=function(){var panel=document.querySelector('[data-testid=\"employee-menu-popover\"]');" +
            "if(!panel||panel.querySelector('[data-yunqiao-printer-settings]')){return;}" +
            "var language=panel.querySelector('label select[aria-label]');if(!language){return;}" +
            "var button=document.createElement('button');button.type='button';" +
            "button.setAttribute('data-yunqiao-printer-settings','true');button.textContent='打印机与设备';" +
            "button.style.cssText='min-height:44px;width:100%;margin-top:8px;text-align:left;';" +
            "button.addEventListener('click',function(){bridge.postMessage('$OPEN_PRINTER_SETTINGS_MESSAGE');});" +
            "var row=language.parentElement;row.parentElement.insertBefore(button,row.nextSibling);};" +
            "new MutationObserver(attach).observe(document.documentElement,{childList:true,subtree:true});attach();" +
            "window.__yunqiaoPrinterSettingsMenuObserver=true;" +
            "})()"

    fun sessionSyncObserverScript(): String =
        """(function(){try{var bridge=window.$SIGNAL_OBJECT_NAME;if(window.top!==window||!bridge||typeof bridge.postMessage!=='function'){return;}""" +
            "var key='$STORAGE_KEY';var token=window.localStorage.getItem(key);var persistence='PERSISTENT';" +
            "if(!token){token=window.sessionStorage.getItem(key);persistence='PROCESS';}" +
            "if(!token||token.length<24||token.length>4096||!/^[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}$/.test(token)){return;}" +
            "bridge.postMessage(JSON.stringify({type:'$SESSION_AUTHENTICATED_MESSAGE',persistence:persistence,token:token}));}catch(e){}})()"

    fun decodeSessionMessage(value: String): MerchantWebSessionSnapshot? {
        val json = runCatching { JSONObject(value) }.getOrNull() ?: return null
        if (json.optString("type") !in setOf(SESSION_AUTHENTICATED_MESSAGE, OPEN_CONNECTOR_CONTROL_MESSAGE)) return null
        return decodeSnapshot(JSONObject.quote(JSONObject()
            .put("state", "AUTHENTICATED")
            .put("persistence", json.optString("persistence"))
            .put("token", json.optString("token")).toString()))
    }

    fun routeWebMessage(
        isTrustedOrigin: Boolean,
        isMainFrame: Boolean,
        isStringMessage: Boolean,
        value: String?,
    ): MerchantWebSessionMessageAction {
        if (!isTrustedOrigin || !isMainFrame || !isStringMessage || value == null) {
            return MerchantWebSessionMessageAction.Ignore
        }
        return when (value) {
            OPEN_PRINTER_SETTINGS_MESSAGE -> MerchantWebSessionMessageAction.OpenPrinterSettings
            SIGN_OUT_MESSAGE -> MerchantWebSessionMessageAction.SignedOut
            else -> {
                val json = runCatching { JSONObject(value) }.getOrNull()
                    ?: return MerchantWebSessionMessageAction.Ignore
                val type = json.optString("type")
                val snapshot = decodeSessionMessage(value) as? MerchantWebSessionSnapshot.Authenticated
                    ?: return MerchantWebSessionMessageAction.Ignore
                when (type) {
                    SESSION_AUTHENTICATED_MESSAGE -> MerchantWebSessionMessageAction.Synchronize(snapshot)
                    OPEN_CONNECTOR_CONTROL_MESSAGE -> MerchantWebSessionMessageAction.OpenConnectorControl(snapshot)
                    else -> MerchantWebSessionMessageAction.Ignore
                }
            }
        }
    }

    fun decodeSnapshot(value: String?): MerchantWebSessionSnapshot {
        val payload = runCatching {
            JSONTokener(value ?: return MerchantWebSessionSnapshot.Invalid).nextValue() as? String
        }.getOrNull() ?: return MerchantWebSessionSnapshot.Invalid
        val json = runCatching { JSONObject(payload) }.getOrNull()
            ?: return MerchantWebSessionSnapshot.Invalid
        return when (json.optString("state")) {
            "SIGNED_OUT" -> MerchantWebSessionSnapshot.SignedOut
            "AUTHENTICATED" -> {
                val token = json.optString("token")
                val persistence = when (json.optString("persistence")) {
                    "PERSISTENT" -> MerchantWebSessionPersistence.PERSISTENT
                    "PROCESS" -> MerchantWebSessionPersistence.PROCESS
                    else -> return MerchantWebSessionSnapshot.Invalid
                }
                if (token.length !in MIN_TOKEN_LENGTH..MAX_TOKEN_LENGTH) {
                    MerchantWebSessionSnapshot.Invalid
                } else if (!merchantJwt.matches(token)) MerchantWebSessionSnapshot.Invalid
                else MerchantWebSessionSnapshot.Authenticated(token, persistence)
            }
            else -> MerchantWebSessionSnapshot.Invalid
        }
    }

    private const val MIN_TOKEN_LENGTH = 24
    private const val MAX_TOKEN_LENGTH = 4_096
}

/** Owns fail-closed sign-out work until the application process ends, not an Activity lifecycle. */
object MerchantSessionProcessScope {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    fun launch(block: suspend () -> Unit): Job = scope.launch { block() }
}

enum class MerchantSessionApplyResult {
    APPLIED,
    FAILED_CLOSED,
    IGNORED_STALE,
}

/** Serializes asynchronous WebView observations and rejects callbacks superseded by newer ones. */
class MerchantSessionCoordinator(
    private val tokenStore: MerchantSessionTokenStore,
    private val startConnector: suspend () -> Unit,
    private val shutdown: suspend () -> Unit,
) {
    private val generation = AtomicLong(0)
    private val applyMutex = Mutex()
    private var signedOutApplied = false
    private var lastAuthenticatedSession: AuthenticatedSession? = null

    fun beginObservation(): Long = generation.incrementAndGet()

    suspend fun applyObservation(
        sequence: Long,
        snapshot: MerchantWebSessionSnapshot,
    ): MerchantSessionApplyResult = applyMutex.withLock {
        if (sequence != generation.get()) return@withLock MerchantSessionApplyResult.IGNORED_STALE
        when (snapshot) {
            is MerchantWebSessionSnapshot.Authenticated -> {
                val session = AuthenticatedSession(snapshot.token, snapshot.persistence)
                if (lastAuthenticatedSession == session) {
                    return@withLock MerchantSessionApplyResult.APPLIED
                }
                lastAuthenticatedSession = session
                signedOutApplied = false
                val persistent = snapshot.persistence == MerchantWebSessionPersistence.PERSISTENT
                try {
                    if (tokenStore.read() != snapshot.token || tokenStore.isPersistent() != persistent) {
                        tokenStore.save(snapshot.token, persistent)
                    }
                    // A fixed sign-out signal may arrive while encryption is completing.
                    if (sequence != generation.get()) {
                        lastAuthenticatedSession = null
                        return@withLock MerchantSessionApplyResult.IGNORED_STALE
                    }
                    startConnector()
                    // Starting the service suspends for settings/USB checks. A newer sign-out must
                    // win even when it arrived after the pre-start generation check.
                    if (sequence != generation.get()) {
                        lastAuthenticatedSession = null
                        withContext(NonCancellable) { shutdown() }
                        signedOutApplied = true
                        return@withLock MerchantSessionApplyResult.IGNORED_STALE
                    }
                } catch (error: Throwable) {
                    if (error is CancellationException) throw error
                    withContext(NonCancellable) { shutdown() }
                    signedOutApplied = true
                    return@withLock MerchantSessionApplyResult.FAILED_CLOSED
                }
            }
            MerchantWebSessionSnapshot.Invalid,
            MerchantWebSessionSnapshot.SignedOut,
            -> {
                lastAuthenticatedSession = null
                if (!signedOutApplied || tokenStore.hasCredential()) {
                    shutdown()
                    signedOutApplied = true
                }
            }
        }
        MerchantSessionApplyResult.APPLIED
    }

    private data class AuthenticatedSession(
        val token: String,
        val persistence: MerchantWebSessionPersistence,
    )
}

interface MerchantSessionKeyAccess {
    fun getOrCreate(): SecretKey
    fun existing(): SecretKey?
    fun delete()
}

private class AndroidMerchantSessionKeyAccess : MerchantSessionKeyAccess {
    override fun getOrCreate(): SecretKey = existing() ?: KeyGenerator
        .getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        .apply {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setUserAuthenticationRequired(false)
                    .build(),
            )
        }
        .generateKey()

    override fun existing(): SecretKey? = KeyStore
        .getInstance(ANDROID_KEYSTORE)
        .apply { load(null) }
        .getKey(KEY_ALIAS, null) as? SecretKey

    override fun delete() {
        runCatching {
            KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }.deleteEntry(KEY_ALIAS)
        }
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "yunqiao_merchant_session_token_v1"
    }
}

object SecretRedactor {
    fun safeError(value: String?): String? = value
        ?.replace(Regex("(?i)(bearer)\\s+[A-Za-z0-9._~+/-]{8,}"), "$1 [REDACTED]")
        ?.replace(Regex("[\\r\\n\\t]+"), " ")
        ?.take(240)
}
