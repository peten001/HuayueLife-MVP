package com.yunqiao.life.merchantterminal.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CredentialRefreshGateTest {
    @Test
    fun `allows only one refresh until an authenticated config is healthy`() {
        val gate = CredentialRefreshGate()

        assertTrue(gate.tryBegin())
        assertFalse(gate.tryBegin())

        gate.markHealthy()
        assertTrue(gate.tryBegin())
        assertFalse(gate.tryBegin())
    }
}
