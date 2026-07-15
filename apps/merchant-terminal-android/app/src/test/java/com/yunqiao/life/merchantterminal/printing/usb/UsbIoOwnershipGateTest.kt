package com.yunqiao.life.merchantterminal.printing.usb

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbIoOwnershipGateTest {
    @Test
    fun `only one adapter can own USB until the same owner releases it`() {
        val gate = UsbIoOwnershipGate()
        val connector = Any()
        val diagnostics = Any()

        assertTrue(gate.tryAcquire(connector))
        assertTrue(gate.tryAcquire(connector))
        assertFalse(gate.tryAcquire(diagnostics))
        gate.release(diagnostics)
        assertTrue(gate.isBusy())
        gate.release(connector)
        assertFalse(gate.isBusy())
        assertTrue(gate.tryAcquire(diagnostics))
    }
}
