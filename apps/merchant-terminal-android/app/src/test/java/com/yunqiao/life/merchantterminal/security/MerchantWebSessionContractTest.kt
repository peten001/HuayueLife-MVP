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

    @Test
    fun `printer settings menu uses fixed trusted diagnostics message without credential access`() {
        val script = MerchantWebSessionContract.printerSettingsMenuObserverScript()
        assertTrue(script.contains("employee-menu-popover"))
        assertTrue(script.contains("data-yunqiao-printer-settings"))
        assertTrue(script.contains("bridge.postMessage('OPEN_PRINTER_SETTINGS')"))
        assertTrue(script.contains("min-height:44px"))
        assertFalse(script.contains("localStorage"))
        assertFalse(script.contains("document.cookie"))
    }

    @Test
    fun `session sync script has an executable JWT regular expression`() {
        val script = MerchantWebSessionContract.sessionSyncObserverScript()

        assertTrue(script.contains("!/^[A-Za-z0-9_-]{8,"))
        assertFalse(script.contains("!^[A-Za-z0-9_-]{8,"))
    }

    @Test
    fun `trusted main frame accepts authenticated and connector messages`() {
        val authenticated = sessionMessage("SESSION_AUTHENTICATED", "PERSISTENT", token)
        val connector = sessionMessage("OPEN_CONNECTOR_CONTROL", "PROCESS", token)

        assertTrue(
            MerchantWebSessionContract.routeWebMessage(true, true, true, authenticated)
                is MerchantWebSessionMessageAction.Synchronize,
        )
        assertTrue(
            MerchantWebSessionContract.routeWebMessage(true, true, true, connector)
                is MerchantWebSessionMessageAction.OpenConnectorControl,
        )
    }

    @Test
    fun `untrusted origin iframe and malformed credential are rejected`() {
        val valid = sessionMessage("SESSION_AUTHENTICATED", "PERSISTENT", token)
        val malformed = sessionMessage("SESSION_AUTHENTICATED", "PERSISTENT", "not-a-jwt")

        assertEquals(MerchantWebSessionMessageAction.Ignore, MerchantWebSessionContract.routeWebMessage(false, true, true, valid))
        assertEquals(MerchantWebSessionMessageAction.Ignore, MerchantWebSessionContract.routeWebMessage(true, false, true, valid))
        assertEquals(MerchantWebSessionMessageAction.Ignore, MerchantWebSessionContract.routeWebMessage(true, true, true, malformed))
    }

    @Test
    fun `trusted sign out is routed without a credential`() {
        assertEquals(
            MerchantWebSessionMessageAction.SignedOut,
            MerchantWebSessionContract.routeWebMessage(true, true, true, "SIGNED_OUT"),
        )
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

    private fun sessionMessage(type: String, persistence: String, credential: String): String = JSONObject()
        .put("type", type)
        .put("persistence", persistence)
        .put("token", credential)
        .toString()
}
