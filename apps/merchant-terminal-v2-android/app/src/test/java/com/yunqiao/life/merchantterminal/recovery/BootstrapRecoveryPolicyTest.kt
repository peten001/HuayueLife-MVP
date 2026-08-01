package com.yunqiao.life.merchantterminal.recovery

import com.yunqiao.life.merchantterminal.network.V2ApiException
import org.junit.Assert.assertEquals
import org.junit.Test

class BootstrapRecoveryPolicyTest {
    @Test
    fun `bootstrap network failure is requeued instead of requiring login`() {
        assertEquals(
            BootstrapRecoveryDisposition.RETRY_WHEN_NETWORK_AVAILABLE,
            BootstrapRecoveryPolicy.classify(
                V2ApiException(0, "NETWORK_IO_ERROR", message = "SocketTimeoutException"),
            ),
        )
        assertEquals(
            BootstrapRecoveryDisposition.RETRY_WHEN_NETWORK_AVAILABLE,
            BootstrapRecoveryPolicy.classify(
                V2ApiException(503, "SERVICE_UNAVAILABLE", message = "Unavailable"),
            ),
        )
    }

    @Test
    fun `invalid merchant bearer requires a new merchant session`() {
        assertEquals(
            BootstrapRecoveryDisposition.MERCHANT_SESSION_REQUIRED,
            BootstrapRecoveryPolicy.classify(
                V2ApiException(401, "UNAUTHORIZED", message = "Unauthorized"),
            ),
        )
    }
}
