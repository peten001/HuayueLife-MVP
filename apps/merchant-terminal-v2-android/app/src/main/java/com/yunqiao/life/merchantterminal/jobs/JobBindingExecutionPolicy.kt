package com.yunqiao.life.merchantterminal.jobs

object JobBindingExecutionPolicy {
    private val enabledOnlySources = setOf("AUTOMATIC", "MANUAL", "MANUAL_REPRINT")
    private val declaredSources = enabledOnlySources + "TEST"

    fun canExecute(source: String, bindingEnabled: Boolean): Boolean = when (source) {
        "TEST" -> true
        in enabledOnlySources -> bindingEnabled
        else -> false
    }

    fun canExecuteClaimed(
        source: String,
        bindingEnabled: Boolean,
        channel: String,
    ): Boolean = if (channel == "LAN") {
        source in declaredSources
    } else {
        canExecute(source, bindingEnabled)
    }
}
