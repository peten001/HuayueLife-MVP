package com.yunqiao.life.merchantterminal.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class V2WebMessageContractTest {
    @Test
    fun acceptsOnlyVersionedPrinterDevicesJson() {
        assertTrue(
            MerchantWebSessionContract.isOpenPrinterDevicesMessage(
                """{"type":"OPEN_PRINTER_DEVICES","version":1}""",
            ),
        )
        assertFalse(MerchantWebSessionContract.isOpenPrinterDevicesMessage("OPEN_PRINTER_DEVICES"))
        assertFalse(
            MerchantWebSessionContract.isOpenPrinterDevicesMessage(
                """{"type":"OPEN_PRINTER_DEVICES","version":2}""",
            ),
        )
        assertFalse(
            MerchantWebSessionContract.isOpenPrinterDevicesMessage(
                """{"type":"OPEN_PRINTER_DEVICES","version":1,"hidden":true}""",
            ),
        )
        assertFalse(
            MerchantWebSessionContract.isOpenPrinterDevicesMessage(
                """{"type":"OPEN_PRINTER_DIAGNOSTICS","version":1}""",
            ),
        )
    }

    @Test
    fun usesSeparateLeastPrivilegeObjects() {
        assertTrue(
            MerchantWebSessionContract.SIGNAL_OBJECT_NAME !=
                MerchantWebSessionContract.PRINTER_DEVICES_OBJECT_NAME,
        )
    }

    @Test
    fun `spa login sends a token-free change signal and native then reads snapshot`() {
        assertTrue(
            MerchantWebSessionContract.logoutObserverScript().contains(
                "postMessage('${MerchantWebSessionContract.SESSION_CHANGED_MESSAGE}')",
            ),
        )
        assertTrue(
            MerchantWebSessionContract.sessionTransitionSignal(
                previous = false,
                current = true,
            ) == MerchantWebSessionContract.SESSION_CHANGED_MESSAGE,
        )
        assertTrue(
            MerchantWebSessionContract.isSessionSignalMessage(
                MerchantWebSessionContract.SESSION_CHANGED_MESSAGE,
            ),
        )
        assertFalse(
            MerchantWebSessionContract.isSessionSignalMessage(
                "${MerchantWebSessionContract.SESSION_CHANGED_MESSAGE}:header.payload.signature",
            ),
        )
        assertFalse(MerchantWebSessionContract.SESSION_CHANGED_MESSAGE.contains('.'))
    }

    @Test
    fun `spa signout remains fail closed and unchanged states emit nothing`() {
        assertTrue(MerchantWebSessionContract.isSignOutMessage("SIGNED_OUT:AUTH_EXPIRED"))
        assertTrue(
            MerchantWebSessionContract.signOutSnapshotFromSignal("SIGNED_OUT:AUTH_EXPIRED").reason ==
                MerchantSessionStopReason.AUTH_EXPIRED,
        )
        assertTrue(MerchantWebSessionContract.sessionTransitionSignal(false, false) == null)
        assertTrue(MerchantWebSessionContract.sessionTransitionSignal(true, true) == null)
    }
}
