package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.network.ClaimedV2PrintJob
import com.yunqiao.life.merchantterminal.network.V2RouteIdentity
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintJobOrchestratorTest {
    @Test
    fun singleCoordinatorGateRejectsRepeatedStartsUntilStopped() {
        val gate = SinglePrintOrchestratorGate()

        assertTrue(gate.tryStart())
        assertFalse(gate.tryStart())
        gate.stopped()
        assertTrue(gate.tryStart())
    }

    @Test
    fun usbAndLanUseTheSameActiveClaimExecuteSequence() = runBlocking {
        listOf(PrinterTransport.USB, PrinterTransport.LAN).forEach { transport ->
            val binding = binding(transport)
            val events = mutableListOf<String>()
            val api = FakeApiAdapter(
                transport.name,
                claimed = job("TEST", binding),
                events = events,
            )
            val orchestrator = PrintJobOrchestrator()

            val result = orchestrator.poll(api, TOKEN, listOf(binding), allowAutomatic = false)

            assertEquals(JobExecutionResult.SUCCEEDED, result)
            assertEquals(listOf("active", "claim:false", "execute:267"), events)
            assertEquals(listOf(V2RouteIdentity.from(binding)), api.activeRoutes.single())
            assertEquals(listOf(V2RouteIdentity.from(binding)), api.claimRoutes.single())
        }
    }

    @Test
    fun activeJobResumesWithoutClaim() = runBlocking {
        val binding = binding(PrinterTransport.LAN, enabled = false)
        val api = FakeApiAdapter("LAN", active = job("TEST", binding))
        val orchestrator = PrintJobOrchestrator()

        orchestrator.poll(api, TOKEN, listOf(binding), allowAutomatic = false)

        assertEquals(0, api.claimRoutes.size)
    }

    @Test
    fun sourceFilterIsSharedForTestManualAndAutomatic() = runBlocking {
        assertTrue(PrintJobSourcePolicy.mayAccept("TEST", allowAutomatic = false))
        assertTrue(PrintJobSourcePolicy.mayAccept("MANUAL", allowAutomatic = false))
        assertFalse(PrintJobSourcePolicy.mayAccept("AUTOMATIC", allowAutomatic = false))
        assertTrue(PrintJobSourcePolicy.mayAccept("AUTOMATIC", allowAutomatic = true))

        val binding = binding(PrinterTransport.LAN)
        val automatic = FakeApiAdapter("LAN", claimed = job("AUTOMATIC", binding))
        var executed = false
        val orchestrator = PrintJobOrchestrator()
        automatic.onExecute = { executed = true }

        val error = runCatching {
            orchestrator.poll(automatic, TOKEN, listOf(binding), allowAutomatic = false)
        }.exceptionOrNull()

        assertTrue(error is IllegalStateException)
        assertFalse(executed)
    }

    @Test
    fun unmatchedOrChangedRouteCannotExecuteOldJob() = runBlocking {
        val old = binding(PrinterTransport.LAN)
        val changed = old.copy(
            printerId = "19",
            localBindingId = "7f3f0365-a668-4498-af30-751dfe4c63d4",
            bindingVersion = 2,
        )
        val api = FakeApiAdapter("LAN", claimed = job("TEST", old))
        var executed = false
        val orchestrator = PrintJobOrchestrator()
        api.onExecute = { executed = true }

        val error = runCatching {
            orchestrator.poll(api, TOKEN, listOf(changed), allowAutomatic = false)
        }.exceptionOrNull()

        assertTrue(error is IllegalStateException)
        assertFalse(executed)
    }

    @Test
    fun emptyRouteDoesNotCallApi() = runBlocking {
        val api = FakeApiAdapter("USB")
        val orchestrator = PrintJobOrchestrator()

        assertNull(orchestrator.poll(api, TOKEN, emptyList(), allowAutomatic = false))
        assertTrue(api.activeRoutes.isEmpty())
        assertTrue(api.claimRoutes.isEmpty())
    }

    private fun binding(
        transport: PrinterTransport,
        enabled: Boolean = true,
    ) = LocalPrinterBinding(
        merchantId = "2",
        terminalInstanceId = "26c2003c-a8f2-4fef-9bcf-6a943d47de35",
        localBindingId = "92b22dc6-95af-4857-a113-8644134488f1",
        printerId = "18",
        bindingVersion = 1,
        transport = transport,
        displayName = "V2 printer",
        paperWidth = PaperWidth.MM_80,
        transportConfig = if (transport == PrinterTransport.LAN) {
            LocalTransportConfig.Lan("10.0.2.2", 19_100)
        } else {
            LocalTransportConfig.Usb(
                vendorId = 1_152,
                productId = 22_390,
                deviceName = null,
                interfaceIndex = 0,
                interfaceId = 0,
                alternateSetting = 0,
                interfaceClass = null,
                endpointAddress = 1,
            )
        },
        localStatus = PhysicalStatus.CONNECTED,
        syncStatus = BindingSyncStatus.SYNCED,
        deletedPending = false,
        enabled = enabled,
        lastConnectedAt = null,
        lastTestedAt = null,
        lastStatusReportAt = null,
    )

    private fun job(source: String, binding: LocalPrinterBinding) = ClaimedV2PrintJob(
        id = "267",
        merchantId = binding.merchantId,
        printerId = requireNotNull(binding.printerId),
        status = "CLAIMED",
        receiptType = "ORDER_CUSTOMER",
        source = source,
        attemptCount = 0,
        currentAttemptNo = null,
        leaseVersion = 1,
        leaseExpiresAt = Long.MAX_VALUE,
        contentHash = "a".repeat(64),
        snapshotSchemaVersion = 1,
        receiptSnapshotJson = "{}",
        route = V2RouteIdentity.from(binding),
        adapter = if (binding.transport == PrinterTransport.LAN) {
            "ANDROID_LAN_ESCPOS"
        } else {
            "ANDROID_USB_ESCPOS"
        },
    )

    private class FakeApiAdapter(
        override val channel: String,
        private val active: ClaimedV2PrintJob? = null,
        private val claimed: ClaimedV2PrintJob? = null,
        private val events: MutableList<String> = mutableListOf(),
    ) : PrintChannelAdapter {
        val activeRoutes = mutableListOf<List<V2RouteIdentity>>()
        val claimRoutes = mutableListOf<List<V2RouteIdentity>>()
        var onExecute: () -> Unit = {}

        override fun isReady(binding: LocalPrinterBinding): Boolean = true

        override fun activeJob(
            terminalBearer: String,
            routes: List<V2RouteIdentity>,
        ): ClaimedV2PrintJob? {
            assertEquals(TOKEN, terminalBearer)
            events += "active"
            activeRoutes += routes
            return active
        }

        override fun claim(
            terminalBearer: String,
            routes: List<V2RouteIdentity>,
            allowAutomatic: Boolean,
        ): ClaimedV2PrintJob? {
            assertEquals(TOKEN, terminalBearer)
            events += "claim:$allowAutomatic"
            claimRoutes += routes
            return claimed
        }

        override suspend fun execute(
            job: ClaimedV2PrintJob,
            binding: LocalPrinterBinding,
        ): JobExecutionResult {
            onExecute()
            events += "execute:${job.id}"
            return JobExecutionResult.SUCCEEDED
        }
    }

    private companion object {
        const val TOKEN = "terminal-credential-placeholder"
    }
}
