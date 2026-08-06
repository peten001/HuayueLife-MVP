package com.yunqiao.life.merchantterminal.printing.usb

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UsbPermissionControllerTest {
    @Test
    fun `already granted returns explicit result and callback`() {
        val harness = Harness()

        val outcome = harness.tracker.begin(DEVICE, alreadyGranted = true) { false }

        assertEquals(UsbPermissionRequestResult.ALREADY_GRANTED, outcome.result)
        assertEquals(listOf(DEVICE to true), harness.results)
        assertNull(harness.tracker.pendingDeviceName)
    }

    @Test
    fun `started request and existing pending are distinguished`() {
        val harness = Harness()

        val started = harness.tracker.begin(DEVICE, alreadyGranted = false) { true }
        val pending = harness.tracker.begin("usb-b", alreadyGranted = false) { true }

        assertEquals(UsbPermissionRequestResult.REQUEST_STARTED, started.result)
        assertEquals(UsbPermissionRequestResult.REQUEST_ALREADY_PENDING, pending.result)
        assertEquals(DEVICE, pending.pendingDeviceName)
        assertEquals(DEVICE, harness.tracker.pendingDeviceName)
    }

    @Test
    fun `failed platform request clears pending state`() {
        val harness = Harness()

        val outcome = harness.tracker.begin(DEVICE, alreadyGranted = false) { false }

        assertEquals(UsbPermissionRequestResult.REQUEST_FAILED, outcome.result)
        assertNull(harness.tracker.pendingDeviceName)
        assertTrue(harness.results.isEmpty())
    }

    @Test
    fun `granted and denied callbacks are kept distinct`() {
        val granted = Harness()
        granted.tracker.begin(DEVICE, alreadyGranted = false) { true }
        assertTrue(granted.tracker.complete(DEVICE, true))
        assertEquals(listOf(DEVICE to true), granted.results)

        val denied = Harness()
        denied.tracker.begin(DEVICE, alreadyGranted = false) { true }
        assertTrue(denied.tracker.complete(DEVICE, false))
        assertEquals(listOf(DEVICE to false), denied.results)
        assertFalse(denied.scheduler.hasScheduledAction)
    }

    @Test
    fun `timeout clears pending and reports the exact device`() {
        val harness = Harness()
        harness.tracker.begin(DEVICE, alreadyGranted = false) { true }

        harness.scheduler.fire()

        assertEquals(listOf(DEVICE), harness.timeouts)
        assertNull(harness.tracker.pendingDeviceName)
    }

    private class Harness {
        val results = mutableListOf<Pair<String, Boolean>>()
        val timeouts = mutableListOf<String>()
        val scheduler = FakeTimeoutScheduler()
        val tracker = UsbPermissionRequestTracker(
            onPermissionResult = { deviceName, granted -> results += deviceName to granted },
            onPermissionTimeout = timeouts::add,
            timeoutScheduler = scheduler,
        )
    }

    private class FakeTimeoutScheduler : UsbPermissionTimeoutScheduler {
        private var action: (() -> Unit)? = null
        val hasScheduledAction: Boolean
            get() = action != null

        override fun schedule(
            delayMs: Long,
            action: () -> Unit,
        ): UsbPermissionTimeoutCancellation {
            assertEquals(USB_PERMISSION_TIMEOUT_MS, delayMs)
            this.action = action
            return UsbPermissionTimeoutCancellation { this.action = null }
        }

        fun fire() {
            val pending = action
            action = null
            pending?.invoke()
        }
    }

    private companion object {
        const val DEVICE = "/dev/bus/usb/001/002"
    }
}
