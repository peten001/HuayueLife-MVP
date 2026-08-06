package com.yunqiao.life.merchantterminal.recovery

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalRecoveryReceiverTest {
    @Test
    fun `boot keeps connector recovery and adds usb permission recovery`() {
        val plan = TerminalRecoveryActionPolicy.plan(Intent.ACTION_BOOT_COMPLETED)

        assertTrue(plan.connectorRecovery)
        assertTrue(plan.usbPermissionRecovery)
    }

    @Test
    fun `user unlocked schedules only usb permission recovery`() {
        val plan = TerminalRecoveryActionPolicy.plan(Intent.ACTION_USER_UNLOCKED)

        assertFalse(plan.connectorRecovery)
        assertTrue(plan.usbPermissionRecovery)
    }

    @Test
    fun `repeated user unlocked uses the same unique work identity`() {
        val first = TerminalRecoveryActionPolicy.plan(Intent.ACTION_USER_UNLOCKED)
        val second = TerminalRecoveryActionPolicy.plan(Intent.ACTION_USER_UNLOCKED)

        assertEquals(first, second)
        assertEquals(
            "yunqiao-usb-permission-recovery",
            V2RecoveryScheduler.USB_PERMISSION_RECOVERY_WORK_NAME,
        )
    }

    @Test
    fun `other actions preserve connector behavior without usb permission recovery`() {
        val plan = TerminalRecoveryActionPolicy.plan(Intent.ACTION_MY_PACKAGE_REPLACED)

        assertTrue(plan.connectorRecovery)
        assertFalse(plan.usbPermissionRecovery)
    }
}
