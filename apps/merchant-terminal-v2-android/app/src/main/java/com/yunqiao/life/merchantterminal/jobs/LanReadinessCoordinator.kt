package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.runtime.StartupTrace
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal fun interface LanReadinessProbe {
    suspend fun probe(binding: LocalPrinterBinding): Result<Unit>
}

internal fun interface LanReadinessRecorder {
    suspend fun record(binding: LocalPrinterBinding, status: PhysicalStatus, errorCode: String?)
}

internal class LanReadinessCoordinator(
    private val probe: LanReadinessProbe,
    private val recorder: LanReadinessRecorder,
    private val clock: () -> Long = System::currentTimeMillis,
    private val intervalMs: Long = LAN_READINESS_INTERVAL_MS,
) {
    private val gate = Mutex()
    private val checkedAt = mutableMapOf<String, Long>()

    suspend fun refreshDue(
        bindings: List<LocalPrinterBinding>,
        force: Boolean = false,
    ): Int = gate.withLock {
        val routeKeys = bindings.mapTo(mutableSetOf(), ::routeKey)
        checkedAt.keys.retainAll(routeKeys)
        var refreshed = 0
        bindings.forEach { binding ->
            val key = routeKey(binding)
            val now = clock()
            val previousCheck = checkedAt[key]
            if (!force && previousCheck != null && now - previousCheck < intervalMs) return@forEach
            StartupTrace.event(
                "LAN_READINESS_START printerId=${binding.printerId} bindingVersion=${binding.bindingVersion}",
            )
            val result = probe.probe(binding)
            val connected = result.isSuccess
            recorder.record(
                binding,
                if (connected) PhysicalStatus.CONNECTED else PhysicalStatus.ERROR,
                if (connected) null else "LAN_CONNECT_FAILED",
            )
            checkedAt[key] = clock()
            StartupTrace.event(
                if (connected) {
                    "LAN_READINESS_CONNECTED printerId=${binding.printerId} bindingVersion=${binding.bindingVersion}"
                } else {
                    "LAN_READINESS_ERROR printerId=${binding.printerId} bindingVersion=${binding.bindingVersion} errorType=${result.exceptionOrNull()?.javaClass?.simpleName?.take(80) ?: "LAN_CONNECT_FAILED"}"
                },
            )
            refreshed++
        }
        refreshed
    }

    private fun routeKey(binding: LocalPrinterBinding): String =
        "${binding.printerId}:${binding.localBindingId}:${binding.bindingVersion}"

    companion object {
        const val LAN_READINESS_INTERVAL_MS = 45_000L
    }
}
