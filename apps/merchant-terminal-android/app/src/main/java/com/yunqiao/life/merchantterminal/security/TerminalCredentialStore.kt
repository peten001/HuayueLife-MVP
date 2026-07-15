package com.yunqiao.life.merchantterminal.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Stores the shared merchant/staff web session token encrypted by a non-exportable Android
 * Keystore AES key so the native USB connector can call the same merchant APIs as the WebView.
 */
class MerchantSessionTokenStore(
    context: Context,
    private val keyAccess: MerchantSessionKeyAccess = AndroidMerchantSessionKeyAccess(),
) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    @Synchronized
    fun save(token: String) {
        require(token.length in 24..MAX_TOKEN_LENGTH) { "Merchant session token length is invalid." }
        require(token.none { it.isWhitespace() || it.code < 0x20 }) {
            "Merchant session token contains invalid characters."
        }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keyAccess.getOrCreate())
        val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString(KEY_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(KEY_CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply()
    }

    @Synchronized
    fun read(): String? {
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

    @Synchronized
    fun clear() {
        preferences.edit().clear().apply()
        keyAccess.delete()
    }

    private fun String.decodeBase64(): ByteArray? = runCatching {
        Base64.decode(this, Base64.NO_WRAP)
    }.getOrNull()

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val PREFERENCES_NAME = "merchant_session_token_encrypted"
        const val KEY_IV = "iv"
        const val KEY_CIPHERTEXT = "ciphertext"
        const val GCM_TAG_BITS = 128
        const val MAX_TOKEN_LENGTH = 4_096
    }
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
        ?.replace(Regex("(?i)(terminal|bearer)\\s+[A-Za-z0-9._~+/-]{8,}"), "$1 [REDACTED]")
        ?.replace(Regex("[\\r\\n\\t]+"), " ")
        ?.take(240)
}
