package com.yunqiao.life.merchantterminal.security

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MerchantWebSessionContractTest {
    private val token = "aaaaaaaa.bbbbbbbb.cccccccc"

    @Test
    fun `decodes local storage as persistent session`() {
        val snapshot = MerchantWebSessionContract.decodeSnapshot(
            encodedResult("AUTHENTICATED", "PERSISTENT", token),
        )

        assertEquals(
            MerchantWebSessionSnapshot.Authenticated(
                token,
                MerchantWebSessionPersistence.PERSISTENT,
            ),
            snapshot,
        )
    }

    @Test
    fun `decodes session storage as process session`() {
        val snapshot = MerchantWebSessionContract.decodeSnapshot(
            encodedResult("AUTHENTICATED", "PROCESS", token),
        )

        assertEquals(
            MerchantWebSessionSnapshot.Authenticated(
                token,
                MerchantWebSessionPersistence.PROCESS,
            ),
            snapshot,
        )
    }

    @Test
    fun `missing or malformed session fails closed`() {
        assertEquals(
            MerchantWebSessionSnapshot.SignedOut,
            MerchantWebSessionContract.decodeSnapshot(encodedResult("SIGNED_OUT")),
        )
        assertEquals(
            MerchantWebSessionSnapshot.Invalid,
            MerchantWebSessionContract.decodeSnapshot("null"),
        )
        assertEquals(
            MerchantWebSessionSnapshot.Invalid,
            MerchantWebSessionContract.decodeSnapshot(
                encodedResult("AUTHENTICATED", "PERSISTENT", "not-a-jwt"),
            ),
        )
    }

    @Test
    fun `oversized jwt shaped value is rejected before regex validation`() {
        val segment = "a".repeat(1_500)
        val oversized = "$segment.$segment.$segment"

        assertEquals(
            MerchantWebSessionSnapshot.Invalid,
            MerchantWebSessionContract.decodeSnapshot(
                encodedResult("AUTHENTICATED", "PERSISTENT", oversized),
            ),
        )
    }

    @Test
    fun `logout signal is fixed and never posts the credential`() {
        val script = MerchantWebSessionContract.logoutObserverScript()

        assertTrue(script.contains("bridge.postMessage('SIGNED_OUT')"))
        assertTrue(script.contains("window.top!==window"))
        assertFalse(script.contains("postMessage(token"))
        assertFalse(script.contains("fetch("))
        assertFalse(script.contains("XMLHttpRequest"))
    }

    @Test
    fun `snapshot reads the shared cashier key with persistent precedence`() {
        val script = MerchantWebSessionContract.snapshotScript()

        assertTrue(script.contains(MerchantWebSessionContract.STORAGE_KEY))
        assertTrue(script.indexOf("localStorage") < script.indexOf("sessionStorage"))
    }

    private fun encodedResult(
        state: String,
        persistence: String? = null,
        credential: String? = null,
    ): String {
        val payload = JSONObject().put("state", state)
        persistence?.let { payload.put("persistence", it) }
        credential?.let { payload.put("token", it) }
        return JSONObject.quote(payload.toString())
    }
}
