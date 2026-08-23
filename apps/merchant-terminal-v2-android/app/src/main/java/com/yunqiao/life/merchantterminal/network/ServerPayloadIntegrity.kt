package com.yunqiao.life.merchantterminal.network

import java.security.MessageDigest
import java.util.Base64

object ServerPayloadIntegrity {
    private val SHA256 = Regex("^[a-f0-9]{64}$")

    fun decodeBase64(encoded: String, declaredLength: Int, expectedSha256: String?): ByteArray {
        val payload = try {
            Base64.getDecoder().decode(encoded)
        } catch (_: IllegalArgumentException) {
            throw V2ApiException(200, "PAYLOAD_INTEGRITY_FAIL", message = "Server payload base64 is invalid.")
        }
        val actual = MessageDigest.getInstance("SHA-256")
            .digest(payload)
            .joinToString("") { "%02x".format(it) }
        if (
            payload.size != declaredLength ||
            expectedSha256 == null ||
            !SHA256.matches(expectedSha256) ||
            actual != expectedSha256
        ) {
            throw V2ApiException(200, "PAYLOAD_INTEGRITY_FAIL", message = "Server payload hash mismatch.")
        }
        return payload
    }
}
