package com.yunqiao.life.merchantterminal

/**
 * Counts taps inside one fixed window. A successful sequence is consumed immediately so an
 * additional tap cannot launch the protected destination a second time.
 */
internal class VersionTapUnlock(
    private val requiredTaps: Int = 7,
    private val windowMs: Long = 5_000L,
) {
    private var firstTapAtMs: Long? = null
    private var tapCount = 0

    init {
        require(requiredTaps > 1)
        require(windowMs > 0L)
    }

    fun registerTap(nowMs: Long): Boolean {
        val firstTap = firstTapAtMs
        if (firstTap == null || nowMs < firstTap || nowMs - firstTap > windowMs) {
            firstTapAtMs = nowMs
            tapCount = 1
            return false
        }

        tapCount += 1
        if (tapCount == requiredTaps) {
            reset()
            return true
        }
        return false
    }

    fun reset() {
        firstTapAtMs = null
        tapCount = 0
    }
}
