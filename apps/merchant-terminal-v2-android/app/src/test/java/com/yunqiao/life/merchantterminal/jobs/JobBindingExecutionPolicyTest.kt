package com.yunqiao.life.merchantterminal.jobs

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JobBindingExecutionPolicyTest {
    @Test
    fun `disabled synchronized printer accepts only TEST source`() {
        assertTrue(JobBindingExecutionPolicy.canExecute("TEST", bindingEnabled = false))
        assertFalse(JobBindingExecutionPolicy.canExecute("MANUAL", bindingEnabled = false))
        assertFalse(JobBindingExecutionPolicy.canExecute("MANUAL_REPRINT", bindingEnabled = false))
        assertFalse(JobBindingExecutionPolicy.canExecute("AUTOMATIC", bindingEnabled = false))
    }

    @Test
    fun `enabled printer accepts declared sources and rejects unknown source`() {
        listOf("TEST", "MANUAL", "MANUAL_REPRINT", "AUTOMATIC").forEach { source ->
            assertTrue(JobBindingExecutionPolicy.canExecute(source, bindingEnabled = true))
        }
        assertFalse(JobBindingExecutionPolicy.canExecute("TEST_PRINT", bindingEnabled = true))
        assertFalse(JobBindingExecutionPolicy.canExecute("UNKNOWN", bindingEnabled = true))
    }
}
