package com.yunqiao.life.merchantterminal.security

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(RobolectricTestRunner::class)
class V2CredentialStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var key: SecretKey
    private lateinit var store: V2CredentialStore

    @Before
    fun setUp() {
        context.getSharedPreferences("terminal_v2_credentials_encrypted", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        store = V2CredentialStore(
            context,
            object : V2CredentialKeyAccess {
                override fun getOrCreate(): SecretKey = key
                override fun existing(): SecretKey = key
            },
        )
    }

    @Test
    fun secretIsStableAndBearerCanBeClearedWithoutLosingIdentitySecret() {
        val secret = store.getOrCreateTerminalSecret()
        assertEquals(43, secret.length)
        assertEquals(secret, store.getOrCreateTerminalSecret())
        val credential = TerminalCredential(
            merchantId = "11",
            terminalId = "15",
            authorizationScheme = "Bearer",
            token = "t".repeat(24),
            tokenVersion = 1,
            tokenExpiresAt = System.currentTimeMillis() + 3_600_000,
            heartbeatSeconds = 20,
            pollIntervalSeconds = 5,
            configVersion = 1,
        )
        store.saveCredential(credential)
        assertEquals(credential, store.readCredential())

        store.clearBearerCredential()
        assertNull(store.readCredential())
        assertEquals(secret, store.getOrCreateTerminalSecret())
        assertTrue(
            context.getSharedPreferences(
                "terminal_v2_credentials_encrypted",
                Context.MODE_PRIVATE,
            ).all.values.none { it.toString().contains(credential.token) },
        )
    }
}
