package com.yunqiao.life.merchantterminal.jobs

/** Keeps job polling on a fixed cadence instead of adding API time to every interval. */
internal object ConnectorPollSchedule {
    fun remainingDelayMs(
        intervalMs: Long,
        cycleStartedAtMs: Long,
        nowMs: Long,
    ): Long {
        require(intervalMs > 0L)
        val elapsedMs = (nowMs - cycleStartedAtMs).coerceAtLeast(0L)
        return (intervalMs - elapsedMs).coerceAtLeast(1L)
    }
}
