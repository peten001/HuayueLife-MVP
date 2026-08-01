package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintOutcomePolicyTest {
    @Test
    fun anyAttemptedUnknownWriteIsUncertainAndNeverRetryable() {
        val result = PrintOutcomePolicy.classify(
            UsbPrintErrorCode.LAN_WRITE_FAILED,
            bytesWritten = 0,
            ioAttempted = true,
        )
        assertTrue(result.uncertain)
        assertFalse(result.retryable)
    }

    @Test
    fun partialWriteIsUncertainAndNeverRetryable() {
        val result = PrintOutcomePolicy.classify(
            UsbPrintErrorCode.BLUETOOTH_WRITE_FAILED,
            bytesWritten = 1,
            ioAttempted = true,
        )
        assertTrue(result.uncertain)
        assertFalse(result.retryable)
    }

    @Test
    fun connectionFailureBeforeIoCanFollowServerRetryPolicy() {
        val result = PrintOutcomePolicy.classify(
            UsbPrintErrorCode.LAN_CONNECT_FAILED,
            bytesWritten = 0,
            ioAttempted = false,
        )
        assertFalse(result.uncertain)
        assertTrue(result.retryable)
    }
}
