package com.yunqiao.life.merchantterminal.recovery

import com.yunqiao.life.merchantterminal.network.V2ApiException

enum class BootstrapRecoveryDisposition {
    RETRY_WHEN_NETWORK_AVAILABLE,
    MERCHANT_SESSION_REQUIRED,
}

object BootstrapRecoveryPolicy {
    fun classify(error: Throwable): BootstrapRecoveryDisposition =
        if (error is V2ApiException && error.credentialInvalid) {
            BootstrapRecoveryDisposition.MERCHANT_SESSION_REQUIRED
        } else {
            BootstrapRecoveryDisposition.RETRY_WHEN_NETWORK_AVAILABLE
        }
}
