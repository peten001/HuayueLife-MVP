package com.yunqiao.life.merchantterminal.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts the minimal immutable receipt snapshot cached for crash recovery. */
interface SnapshotCipher {
    fun encrypt(plaintext: String): String
    fun decrypt(envelope: String): String
}

class ReceiptSnapshotCipher : SnapshotCipher {
    @Synchronized
    override fun encrypt(plaintext: String): String {
        require(plaintext.length in 2..MAX_SNAPSHOT_CHARS)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return listOf(
            ENVELOPE_VERSION,
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
            Base64.encodeToString(encrypted, Base64.NO_WRAP),
        ).joinToString(":")
    }

    @Synchronized
    override fun decrypt(envelope: String): String {
        val parts = envelope.split(':', limit = 3)
        require(parts.size == 3 && parts[0] == ENVELOPE_VERSION) { "Unsupported receipt envelope." }
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        val ciphertext = Base64.decode(parts[2], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, existingKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8).also {
            require(it.length in 2..MAX_SNAPSHOT_CHARS)
        }
    }

    private fun getOrCreateKey(): SecretKey = existingKeyOrNull() ?: KeyGenerator
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
        }.generateKey()

    private fun existingKey(): SecretKey = existingKeyOrNull()
        ?: error("Receipt cache key is unavailable.")

    private fun existingKeyOrNull(): SecretKey? = KeyStore
        .getInstance(ANDROID_KEYSTORE)
        .apply { load(null) }
        .getKey(KEY_ALIAS, null) as? SecretKey

    companion object {
        /** Deletes the merchant-scoped local receipt key when a terminal is unpaired/reassigned. */
        fun clearKey() {
            runCatching {
                KeyStore.getInstance(ANDROID_KEYSTORE)
                    .apply { load(null) }
                    .deleteEntry(KEY_ALIAS)
            }
        }

        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val KEY_ALIAS = "yunqiao_receipt_snapshot_v1"
        private const val ENVELOPE_VERSION = "v1"
        private const val GCM_TAG_BITS = 128
        private const val MAX_SNAPSHOT_CHARS = 512_000
    }
}
