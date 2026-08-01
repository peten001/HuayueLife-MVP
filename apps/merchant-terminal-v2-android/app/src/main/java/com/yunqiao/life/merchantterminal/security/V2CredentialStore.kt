package com.yunqiao.life.merchantterminal.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class TerminalCredential(
    val merchantId: String,
    val terminalId: String,
    val authorizationScheme: String,
    val token: String,
    val tokenVersion: Long,
    val tokenExpiresAt: Long,
    val heartbeatSeconds: Long,
    val pollIntervalSeconds: Long,
    val configVersion: Long,
) {
    init {
        require(NUMERIC_ID.matches(merchantId))
        require(NUMERIC_ID.matches(terminalId))
        require(authorizationScheme == "Bearer")
        require(token.length in 24..4_096 && token.none(Char::isWhitespace))
        require(tokenVersion >= 1)
        require(tokenExpiresAt > 0)
        require(heartbeatSeconds in 5..300)
        require(pollIntervalSeconds in 2..120)
        require(configVersion >= 0)
    }

    fun isUsable(now: Long = System.currentTimeMillis()): Boolean =
        tokenExpiresAt - now > MINIMUM_TOKEN_LIFETIME_MS

    private companion object {
        val NUMERIC_ID = Regex("^[1-9][0-9]{0,18}$")
        const val MINIMUM_TOKEN_LIFETIME_MS = 30_000L
    }
}

class V2CredentialStore(
    context: Context,
    private val keyAccess: V2CredentialKeyAccess = AndroidV2CredentialKeyAccess(),
) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun getOrCreateTerminalSecret(): String = synchronized(lock) {
        decrypt(KEY_SECRET)?.takeIf(SECRET_FORMAT::matches)?.let { return@synchronized it }
        val bytes = ByteArray(32).also(SecureRandom()::nextBytes)
        val secret = Base64.encodeToString(
            bytes,
            Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE,
        )
        check(SECRET_FORMAT.matches(secret))
        encrypt(KEY_SECRET, secret)
        secret
    }

    fun saveCredential(value: TerminalCredential) = synchronized(lock) {
        val json = JSONObject()
            .put("merchantId", value.merchantId)
            .put("terminalId", value.terminalId)
            .put("authorizationScheme", value.authorizationScheme)
            .put("token", value.token)
            .put("tokenVersion", value.tokenVersion)
            .put("tokenExpiresAt", value.tokenExpiresAt)
            .put("heartbeatSeconds", value.heartbeatSeconds)
            .put("pollIntervalSeconds", value.pollIntervalSeconds)
            .put("configVersion", value.configVersion)
            .toString()
        encrypt(KEY_CREDENTIAL, json)
    }

    fun readCredential(): TerminalCredential? = synchronized(lock) {
        val json = decrypt(KEY_CREDENTIAL)?.takeIf { it.length <= MAX_CREDENTIAL_JSON }
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: return@synchronized null
        runCatching {
            TerminalCredential(
                merchantId = json.getString("merchantId"),
                terminalId = json.getString("terminalId"),
                authorizationScheme = json.getString("authorizationScheme"),
                token = json.getString("token"),
                tokenVersion = json.getLong("tokenVersion"),
                tokenExpiresAt = json.getLong("tokenExpiresAt"),
                heartbeatSeconds = json.getLong("heartbeatSeconds"),
                pollIntervalSeconds = json.getLong("pollIntervalSeconds"),
                configVersion = json.getLong("configVersion"),
            )
        }.getOrNull()
    }

    fun clearBearerCredential() = synchronized(lock) {
        preferences.edit()
            .remove(KEY_CREDENTIAL_IV)
            .remove(KEY_CREDENTIAL_CIPHERTEXT)
            .commit()
    }

    private fun encrypt(name: String, plaintext: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keyAccess.getOrCreate())
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(ivKey(name), Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(
                ciphertextKey(name),
                Base64.encodeToString(ciphertext, Base64.NO_WRAP),
            )
            .commit()
    }

    private fun decrypt(name: String): String? {
        val iv = preferences.getString(ivKey(name), null)?.decodeBase64() ?: return null
        val ciphertext = preferences.getString(ciphertextKey(name), null)?.decodeBase64()
            ?: return null
        return runCatching {
            val key = keyAccess.existing() ?: return null
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        }.getOrNull()
    }

    private fun String.decodeBase64(): ByteArray? =
        runCatching { Base64.decode(this, Base64.NO_WRAP) }.getOrNull()

    private fun ivKey(name: String) = "${name}_iv"

    private fun ciphertextKey(name: String) = "${name}_ciphertext"

    companion object {
        private val lock = Any()
        private val SECRET_FORMAT = Regex("^[A-Za-z0-9_-]{43}$")
        private const val PREFERENCES_NAME = "terminal_v2_credentials_encrypted"
        private const val KEY_SECRET = "terminal_secret"
        private const val KEY_CREDENTIAL = "terminal_bearer"
        private const val KEY_CREDENTIAL_IV = "terminal_bearer_iv"
        private const val KEY_CREDENTIAL_CIPHERTEXT = "terminal_bearer_ciphertext"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val MAX_CREDENTIAL_JSON = 8_192
    }
}

interface V2CredentialKeyAccess {
    fun getOrCreate(): SecretKey
    fun existing(): SecretKey?
}

private class AndroidV2CredentialKeyAccess : V2CredentialKeyAccess {
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

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "yunqiao_terminal_v2_credentials"
    }
}
