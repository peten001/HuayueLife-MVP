package com.yunqiao.life.merchantterminal.printing.usb

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbPermissionRecoveryReceiverTest {
    @Test
    fun `grant requires platform result device and current manager permission`() {
        assertTrue(
            UsbPermissionRecoveryResultPolicy.isGranted(
                resultFlag = true,
                devicePresent = true,
                managerHasPermission = true,
            ),
        )
    }

    @Test
    fun `denied result cannot schedule granted recovery`() {
        assertFalse(
            UsbPermissionRecoveryResultPolicy.isGranted(
                resultFlag = false,
                devicePresent = true,
                managerHasPermission = false,
            ),
        )
    }

    @Test
    fun `missing device cannot be treated as granted`() {
        assertFalse(
            UsbPermissionRecoveryResultPolicy.isGranted(
                resultFlag = true,
                devicePresent = false,
                managerHasPermission = false,
            ),
        )
    }

    @Test
    fun `stale manager permission cannot be treated as granted`() {
        assertFalse(
            UsbPermissionRecoveryResultPolicy.isGranted(
                resultFlag = true,
                devicePresent = true,
                managerHasPermission = false,
            ),
        )
    }
}
