package com.yunqiao.life.merchantterminal.presentation

enum class TerminalLayoutClass {
    COMPACT_PORTRAIT,
    COMPACT_LANDSCAPE,
    EXPANDED_LANDSCAPE,
}

object ResponsiveLayoutPolicy {
    fun classify(widthDp: Int, heightDp: Int): TerminalLayoutClass {
        require(widthDp > 0 && heightDp > 0)
        return when {
            widthDp < heightDp -> TerminalLayoutClass.COMPACT_PORTRAIT
            widthDp < 900 -> TerminalLayoutClass.COMPACT_LANDSCAPE
            else -> TerminalLayoutClass.EXPANDED_LANDSCAPE
        }
    }
}
