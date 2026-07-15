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
class MerchantSessionTokenStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var keyAccess: MemoryKeyAccess
    private lateinit var store: MerchantSessionTokenStore

    @Before
    fun setUp() {
        context.getSharedPreferences("merchant_session_token_encrypted", Context.MODE_PRIVATE)
            .edit().clear().commit()
        keyAccess = MemoryKeyAccess()
        store = MerchantSessionTokenStore(context, keyAccess)
    }

    @After fun tearDown() = store.clear()

    @Test
    fun `merchant session token round trips but preferences never contain plaintext`() {
        val token = "merchant.jwt.${"x".repeat(48)}"
        store.save(token)

        assertEquals(token, store.read())
        val persisted = context
            .getSharedPreferences("merchant_session_token_encrypted", Context.MODE_PRIVATE)
            .all.values.joinToString("|")
        assertFalse(persisted.contains(token))
        assertFalse(persisted.contains("merchant.jwt"))
    }

    @Test
    fun `deleting key makes ciphertext unreadable and clear removes it`() {
        store.save("merchant.jwt.${"y".repeat(48)}")
        keyAccess.delete()
        assertNull(store.read())
        store.clear()
        assertFalse(store.hasCredential())
    }

    private class MemoryKeyAccess : MerchantSessionKeyAccess {
        private var key: SecretKey? = null
        override fun getOrCreate(): SecretKey = key ?: KeyGenerator.getInstance("AES")
            .apply { init(256) }
            .generateKey()
            .also { key = it }
        override fun existing(): SecretKey? = key
        override fun delete() { key = null }
    }
}
