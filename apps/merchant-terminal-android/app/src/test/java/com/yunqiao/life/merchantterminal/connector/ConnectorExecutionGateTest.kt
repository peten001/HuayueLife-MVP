package com.yunqiao.life.merchantterminal.connector

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ConnectorExecutionGateTest {
    @Test
    fun `recovery cannot overlap foreground execution`() = runBlocking {
        val executionEntered = CompletableDeferred<Unit>()
        val releaseExecution = CompletableDeferred<Unit>()
        var recoveryEntered = false

        val execution = async {
            ConnectorExecutionGate.exclusive {
                executionEntered.complete(Unit)
                releaseExecution.await()
            }
        }
        executionEntered.await()
        val recovery = async {
            ConnectorExecutionGate.exclusive { recoveryEntered = true }
        }

        kotlinx.coroutines.yield()
        assertFalse(recoveryEntered)
        releaseExecution.complete(Unit)
        execution.await()
        recovery.await()
        assertEquals(true, recoveryEntered)
    }
}
