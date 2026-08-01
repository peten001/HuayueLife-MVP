package com.yunqiao.life.merchantterminal.jobs

/** Local fail-closed mirror of the V2 server source/enablement contract. */
object JobBindingExecutionPolicy {
    private val enabledOnlySources = setOf("AUTOMATIC", "MANUAL", "MANUAL_REPRINT")

    fun canExecute(source: String, bindingEnabled: Boolean): Boolean = when (source) {
        "TEST" -> true
        in enabledOnlySources -> bindingEnabled
        else -> false
    }
}
