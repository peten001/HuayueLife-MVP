package com.yunqiao.life.merchantterminal.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.Base64

class CanonicalServerPayloadTest {
    @Test
    fun androidVerifiesTheSharedServerPayloadWithoutRendering() {
        val fixture = JSONObject(sharedFixture().readText())
        val payload = Base64.getDecoder().decode(fixture.getString("payloadBase64"))
        val sha = MessageDigest.getInstance("SHA-256")
            .digest(payload)
            .joinToString("") { "%02x".format(it) }
        assertEquals(fixture.getInt("byteLength"), payload.size)
        assertEquals(fixture.getString("sha256"), sha)
        assertEquals("ESC_POS_RASTER_V1", fixture.getString("renderProtocol"))
    }

    private fun sharedFixture(): File {
        var current = File(System.getProperty("user.dir")).absoluteFile
        repeat(8) {
            val candidate = File(current, "fixtures/printing/server-esc-pos-payload-v1.json")
            if (candidate.isFile) return candidate
            current = current.parentFile ?: current
        }
        error("Shared canonical payload fixture was not found")
    }
}
