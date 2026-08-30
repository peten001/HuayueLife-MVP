package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.network.ClaimedV2PrintJob
import com.yunqiao.life.merchantterminal.network.TerminalV2ApiClient
import com.yunqiao.life.merchantterminal.network.V2RouteIdentity
import com.yunqiao.life.merchantterminal.runtime.StartupTrace
import java.util.concurrent.atomic.AtomicBoolean

internal class SinglePrintOrchestratorGate {
    private val running = AtomicBoolean(false)

    fun tryStart(): Boolean = running.compareAndSet(false, true)

    fun stopped() {
        running.set(false)
    }
}

internal interface PrintChannelAdapter {
    val channel: String

    fun routeIdentity(binding: LocalPrinterBinding): V2RouteIdentity = V2RouteIdentity.from(binding)

    fun isReady(binding: LocalPrinterBinding): Boolean

    fun claim(
        terminalBearer: String,
        routes: List<V2RouteIdentity>,
        allowAutomatic: Boolean,
    ): ClaimedV2PrintJob?

    suspend fun execute(
        job: ClaimedV2PrintJob,
        binding: LocalPrinterBinding,
    ): JobExecutionResult
}

internal class TerminalUsbJobApiAdapter(
    private val api: TerminalV2ApiClient,
    private val executor: V2PrintJobExecutor,
) : PrintChannelAdapter {
    override val channel: String = "USB"

    override fun claim(
        terminalBearer: String,
        routes: List<V2RouteIdentity>,
        allowAutomatic: Boolean,
    ): ClaimedV2PrintJob? = api.claim(terminalBearer, allowAutomatic)

    override fun isReady(binding: LocalPrinterBinding): Boolean =
        UsbJobClaimPolicy.isReady(binding)

    override suspend fun execute(
        job: ClaimedV2PrintJob,
        binding: LocalPrinterBinding,
    ): JobExecutionResult = executor.execute(job, binding)
}

internal object UsbJobClaimPolicy {
    fun isReady(binding: LocalPrinterBinding): Boolean =
        binding.transport.name == "USB" &&
            binding.enabled &&
            binding.localStatus.name == "CONNECTED"
}

internal class TerminalLanJobApiAdapter(
    private val api: TerminalV2ApiClient,
    private val executor: V2PrintJobExecutor,
) : PrintChannelAdapter {
    override val channel: String = "LAN"

    override fun claim(
        terminalBearer: String,
        routes: List<V2RouteIdentity>,
        allowAutomatic: Boolean,
    ): ClaimedV2PrintJob? = routes.firstNotNullOfOrNull { route ->
        api.claimLanJob(terminalBearer, route, allowAutomatic)
    }

    override fun isReady(binding: LocalPrinterBinding): Boolean =
        LanJobClaimPolicy.isReady(binding)

    override suspend fun execute(
        job: ClaimedV2PrintJob,
        binding: LocalPrinterBinding,
    ): JobExecutionResult = executor.execute(job, binding)
}

internal object LanJobClaimPolicy {
    fun isReady(binding: LocalPrinterBinding): Boolean =
        binding.transport.name == "LAN" && binding.localStatus.name == "CONNECTED"
}

/**
 * Channel-neutral acquisition and execution coordinator. API paths and physical I/O stay in
 * channel adapters; lease, PRINTING, device execution and result reporting stay in the shared
 * [V2PrintJobExecutor].
 */
internal class PrintJobOrchestrator {
    private val activeRoutes = mutableMapOf<String, Set<String>>()

    fun reconcileRoutes(adapters: List<Pair<PrintChannelAdapter, List<LocalPrinterBinding>>>) {
        val currentChannels = adapters.mapTo(mutableSetOf()) { it.first.channel }
        (activeRoutes.keys - currentChannels).forEach { channel ->
            activeRoutes.remove(channel).orEmpty().forEach { route ->
                StartupTrace.event("PRINT_ROUTE_STOPPED channel=$channel route=$route")
            }
        }
        adapters.forEach { (adapter, bindings) ->
            val next = bindings.mapTo(linkedSetOf()) { routeKey(it) }
            val previous = activeRoutes.put(adapter.channel, next).orEmpty()
            (previous - next).forEach { route ->
                StartupTrace.event("PRINT_ROUTE_STOPPED channel=${adapter.channel} route=$route")
            }
            (next - previous).forEach { route ->
                StartupTrace.event("PRINT_ROUTE_STARTED channel=${adapter.channel} route=$route")
            }
        }
    }

    suspend fun poll(
        adapter: PrintChannelAdapter,
        terminalBearer: String,
        bindings: List<LocalPrinterBinding>,
        allowAutomatic: Boolean,
    ): JobExecutionResult? {
        val readyBindings = bindings.filter(adapter::isReady)
        if (readyBindings.isEmpty()) return null
        val routes = readyBindings.map(adapter::routeIdentity)
        // The claim endpoints already return the terminal's live CLAIMED/PRINTING
        // job before attempting to lease a new one. Calling active first doubles
        // the idle network round trips and makes every USB poll wait behind an
        // unnecessary request without improving crash recovery.
        StartupTrace.event("PRINT_CLAIM_START channel=${adapter.channel}")
        val job = adapter.claim(terminalBearer, routes, allowAutomatic)?.also { claimed ->
            StartupTrace.event(
                "PRINT_CLAIM_SUCCESS channel=${adapter.channel} jobId=${claimed.id} printerId=${claimed.printerId} bindingVersion=${claimed.route.bindingVersion}",
            )
        } ?: return null

        val binding = readyBindings.firstOrNull { candidate ->
            candidate.printerId == job.route.printerId &&
                candidate.localBindingId == job.route.localBindingId &&
                candidate.bindingVersion == job.route.bindingVersion
        } ?: run {
            StartupTrace.event(
                "PRINT_POST_CLAIM_REJECTED channel=${adapter.channel} jobId=${job.id} printerId=${job.printerId} reason=ROUTE_MISMATCH",
            )
            error("${adapter.channel} job route does not match an active binding.")
        }
        if (!JobBindingExecutionPolicy.canExecuteClaimed(job.source, binding.enabled, adapter.channel)) {
            StartupTrace.event(
                "PRINT_POST_CLAIM_REJECTED channel=${adapter.channel} jobId=${job.id} printerId=${job.printerId} reason=LOCAL_EXECUTION_POLICY",
            )
            if (adapter.channel == "LAN") {
                error("LAN claimed job source is not supported locally.")
            }
            return null
        }
        return adapter.execute(job, binding)
    }

    fun stop() {
        activeRoutes.forEach { (channel, routes) ->
            routes.forEach { route ->
                StartupTrace.event("PRINT_ROUTE_STOPPED channel=$channel route=$route")
            }
        }
        activeRoutes.clear()
    }

    private fun routeKey(binding: LocalPrinterBinding): String =
        "${binding.printerId}:${binding.localBindingId}:${binding.bindingVersion}"
}
