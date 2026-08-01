package com.yunqiao.life.merchantterminal.presentation

import org.junit.Assert.assertEquals
import org.junit.Test

class ResponsiveLayoutPolicyTest {
    @Test
    fun supportsP10PortraitWithoutForcingLandscape() {
        assertEquals(
            TerminalLayoutClass.COMPACT_PORTRAIT,
            ResponsiveLayoutPolicy.classify(widthDp = 600, heightDp = 960),
        )
    }

    @Test
    fun supportsD2AndD10Landscape() {
        assertEquals(
            TerminalLayoutClass.EXPANDED_LANDSCAPE,
            ResponsiveLayoutPolicy.classify(widthDp = 1366, heightDp = 768),
        )
        assertEquals(
            TerminalLayoutClass.COMPACT_LANDSCAPE,
            ResponsiveLayoutPolicy.classify(widthDp = 800, heightDp = 480),
        )
    }
}
