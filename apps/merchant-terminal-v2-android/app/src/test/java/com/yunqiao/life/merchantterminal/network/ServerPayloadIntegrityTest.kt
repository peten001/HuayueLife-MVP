package com.yunqiao.life.merchantterminal.network

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.MessageDigest
import java.util.Base64

class ServerPayloadIntegrityTest {
    @Test
    fun acceptsOnlyAnExactBase64LengthAndShaTuple() {
        val payload = byteArrayOf(0x1b, 0x40, 0x1d, 0x56, 0x01)
        val encoded = Base64.getEncoder().encodeToString(payload)
        val sha = MessageDigest.getInstance("SHA-256").digest(payload)
            .joinToString("") { "%02x".format(it) }

        assertArrayEquals(payload, ServerPayloadIntegrity.decodeBase64(encoded, payload.size, sha))
        assertEquals(
            "PAYLOAD_INTEGRITY_FAIL",
            assertThrows(V2ApiException::class.java) {
                ServerPayloadIntegrity.decodeBase64(encoded, payload.size - 1, sha)
            }.errorCode,
        )
        assertEquals(
            "PAYLOAD_INTEGRITY_FAIL",
            assertThrows(V2ApiException::class.java) {
                ServerPayloadIntegrity.decodeBase64(encoded, payload.size, "0".repeat(64))
            }.errorCode,
        )
    }
}
