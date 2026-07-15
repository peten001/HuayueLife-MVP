package com.yunqiao.life.merchantterminal.web

import android.net.Uri
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class OriginPolicyTest {
    @Test
    fun `cashier url must match explicit trusted origin`() {
        val valid = OriginPolicy(
            startUrl = "https://cashier.example.test/orders",
            trustedPageOrigin = "https://cashier.example.test",
            trustedResourceHosts = "api.example.test",
        )
        val mismatch = OriginPolicy(
            startUrl = "https://other.example.test/",
            trustedPageOrigin = "https://cashier.example.test",
            trustedResourceHosts = "api.example.test",
        )

        assertTrue(valid.isConfigured)
        assertFalse(mismatch.isConfigured)
    }

    @Test
    fun `resource host cannot become a top level trusted page`() {
        val policy = OriginPolicy(
            startUrl = "https://cashier.example.test/",
            trustedPageOrigin = "https://cashier.example.test",
            trustedResourceHosts = "api.example.test",
        )
        val apiUri = Uri.parse("https://api.example.test/api/v1/orders")

        assertTrue(policy.isAllowedWebResource(apiUri))
        assertFalse(policy.isTrustedPage(apiUri))
    }

    @Test
    fun `invalid placeholder remains an unconfigured but safe diagnostic build`() {
        val policy = OriginPolicy(
            startUrl = "https://cashier.invalid/",
            trustedPageOrigin = "https://cashier.invalid",
            trustedResourceHosts = "",
        )

        assertFalse(policy.isConfigured)
    }

    @Test
    fun `diagnostic sanitizer never returns URL userinfo or query secrets`() {
        val policy = OriginPolicy(
            startUrl = "https://cashier.example.test/",
            trustedPageOrigin = "https://cashier.example.test",
            trustedResourceHosts = "",
        )

        assertTrue(
            policy.sanitizedForDiagnostics("https://cashier.example.test/orders?token=secret#detail") ==
                "https://cashier.example.test/orders",
        )
        assertTrue(
            policy.sanitizedForDiagnostics("https://user:secret@cashier.example.test/orders") ==
                "invalid-url",
        )
    }
}
