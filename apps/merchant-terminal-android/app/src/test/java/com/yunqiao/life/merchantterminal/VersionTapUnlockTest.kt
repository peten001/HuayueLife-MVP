package com.yunqiao.life.merchantterminal

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionTapUnlockTest {
    @Test
    fun `six taps do not unlock`() {
        val unlock = VersionTapUnlock()

        repeat(6) { index ->
            assertFalse(unlock.registerTap(index * 500L))
        }
    }

    @Test
    fun `seven taps inside five seconds unlock once and eighth tap does not`() {
        val unlock = VersionTapUnlock()

        repeat(6) { index ->
            assertFalse(unlock.registerTap(index * 700L))
        }
        assertTrue(unlock.registerTap(4_900L))
        assertFalse(unlock.registerTap(4_950L))
    }

    @Test
    fun `tap after five second window starts a new sequence`() {
        val unlock = VersionTapUnlock()

        repeat(6) { index ->
            assertFalse(unlock.registerTap(index * 800L))
        }
        assertFalse(unlock.registerTap(5_001L))
        repeat(5) { index ->
            assertFalse(unlock.registerTap(5_101L + index * 100L))
        }
        assertTrue(unlock.registerTap(5_701L))
    }

    @Test
    fun `lifecycle reset discards an incomplete sequence`() {
        val unlock = VersionTapUnlock()

        repeat(6) { index ->
            assertFalse(unlock.registerTap(index * 500L))
        }
        unlock.reset()

        assertFalse(unlock.registerTap(3_000L))
    }
}
