package com.yunqiao.life.merchantterminal.connector

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbConnectionRuntimeStateTest {
    @Test
    fun `tracks open and claim independently and only owner can clear state`() {
        val tracker = UsbConnectionRuntimeTracker()
        val connector = Any()
        val diagnostics = Any()

        tracker.markConnectionOpen(connector)
        assertTrue(tracker.snapshot().connectionOpen)
        assertFalse(tracker.snapshot().interfaceClaimed)

        tracker.markInterfaceClaimed(connector)
        assertTrue(tracker.snapshot().connectionOpen)
        assertTrue(tracker.snapshot().interfaceClaimed)

        tracker.markClosed(diagnostics)
        assertTrue(tracker.snapshot().connectionOpen)
        assertTrue(tracker.snapshot().interfaceClaimed)

        tracker.markClosed(connector)
        assertFalse(tracker.snapshot().connectionOpen)
        assertFalse(tracker.snapshot().interfaceClaimed)
    }
}
