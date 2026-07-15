package com.yunqiao.life.merchantterminal.printing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintActionGateAndErrorsTest {
    @Test
    fun `gate blocks concurrent and rapid repeated print clicks`() {
        val gate = PrintActionGate(debounceMs = 750)

        assertTrue(gate.tryAcquire(1_000))
        assertFalse(gate.tryAcquire(2_000))
        gate.release()
        assertFalse(gate.tryAcquire(1_500))
        assertTrue(gate.tryAcquire(1_751))
    }

    @Test
    fun `all required error codes have user facing messages`() {
        val mappedResources = UsbPrintErrorCode.entries.map { it.userMessageResource() }

        assertEquals(UsbPrintErrorCode.entries.size, mappedResources.size)
        assertTrue(mappedResources.all { it > 0 })
    }
}
