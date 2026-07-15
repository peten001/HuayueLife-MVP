package com.yunqiao.life.merchantterminal.security

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@RunWith(RobolectricTestRunner::class)
class TerminalCredentialStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var keyAccess: MemoryKeyAccess
    private lateinit var store: TerminalCredentialStore

    @Before
    fun setUp() {
        context.getSharedPreferences("terminal_credential_encrypted", Context.MODE_PRIVATE)
            .edit().clear().commit()
        keyAccess = MemoryKeyAccess()
        store = TerminalCredentialStore(context, keyAccess)
    }

    @After fun tearDown() = store.clear()

    @Test
    fun `opaque terminal token round trips but preferences never contain plaintext`() {
        val token = "yt1.123.${"x".repeat(48)}"
        store.save(token)

        assertEquals(token, store.read())
        val persisted = context
            .getSharedPreferences("terminal_credential_encrypted", Context.MODE_PRIVATE)
            .all.values.joinToString("|")
        assertFalse(persisted.contains(token))
        assertFalse(persisted.contains("yt1.123"))
    }

    @Test
    fun `deleting key makes ciphertext unreadable and clear removes it`() {
        store.save("yt1.123.${"y".repeat(48)}")
        keyAccess.delete()
        assertNull(store.read())
        store.clear()
        assertFalse(store.hasCredential())
    }

    private class MemoryKeyAccess : TerminalKeyAccess {
        private var key: SecretKey? = null
        override fun getOrCreate(): SecretKey = key ?: KeyGenerator.getInstance("AES")
            .apply { init(256) }
            .generateKey()
            .also { key = it }
        override fun existing(): SecretKey? = key
        override fun delete() { key = null }
    }
}
