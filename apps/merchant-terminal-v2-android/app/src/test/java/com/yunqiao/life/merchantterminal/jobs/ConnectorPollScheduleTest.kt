package com.yunqiao.life.merchantterminal.jobs

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectorPollScheduleTest {
    @Test
    fun subtractsNetworkAndExecutionTimeFromConfiguredInterval() {
        assertEquals(
            1_250L,
            ConnectorPollSchedule.remainingDelayMs(
                intervalMs = 2_000L,
                cycleStartedAtMs = 10_000L,
                nowMs = 10_750L,
            ),
        )
    }

    @Test
    fun immediatelyStartsNextCycleWhenWorkConsumedTheInterval() {
        assertEquals(
            1L,
            ConnectorPollSchedule.remainingDelayMs(
                intervalMs = 2_000L,
                cycleStartedAtMs = 10_000L,
                nowMs = 12_400L,
            ),
        )
    }

    @Test
    fun clockRegressionDoesNotShortenTheInterval() {
        assertEquals(
            2_000L,
            ConnectorPollSchedule.remainingDelayMs(
                intervalMs = 2_000L,
                cycleStartedAtMs = 10_000L,
                nowMs = 9_900L,
            ),
        )
    }
}
