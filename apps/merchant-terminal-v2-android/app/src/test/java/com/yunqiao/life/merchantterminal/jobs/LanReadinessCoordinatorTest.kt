package com.yunqiao.life.merchantterminal.jobs

import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class LanReadinessCoordinatorTest {
    @Test
    fun firstCheckIsImmediateThenRepeatsAtFortyFiveSeconds() = runBlocking {
        var now = 1_000L
        var probes = 0
        val statuses = mutableListOf<PhysicalStatus>()
        val coordinator = LanReadinessCoordinator(
            probe = LanReadinessProbe {
                probes++
                Result.success(Unit)
            },
            recorder = LanReadinessRecorder { _, status, _ -> statuses += status },
            clock = { now },
        )

        assertEquals(1, coordinator.refreshDue(listOf(binding())))
        now += 44_999L
        assertEquals(0, coordinator.refreshDue(listOf(binding())))
        now += 1L
        assertEquals(1, coordinator.refreshDue(listOf(binding())))

        assertEquals(2, probes)
        assertEquals(listOf(PhysicalStatus.CONNECTED, PhysicalStatus.CONNECTED), statuses)
    }

    @Test
    fun failedTcpProbeRecordsErrorWithoutExecutingPrintData() = runBlocking {
        var probes = 0
        val records = mutableListOf<Pair<PhysicalStatus, String?>>()
        val coordinator = LanReadinessCoordinator(
            probe = LanReadinessProbe {
                probes++
                Result.failure(IllegalStateException("offline"))
            },
            recorder = LanReadinessRecorder { _, status, error -> records += status to error },
        )

        coordinator.refreshDue(listOf(binding()), force = true)

        assertEquals(1, probes)
        assertEquals(listOf(PhysicalStatus.ERROR to "LAN_CONNECT_FAILED"), records)
    }

    @Test
    fun forceRefreshAndRouteChangeAreImmediateWithoutDuplicateSchedule() = runBlocking {
        var now = 10_000L
        var probes = 0
        val coordinator = LanReadinessCoordinator(
            probe = LanReadinessProbe {
                probes++
                Result.success(Unit)
            },
            recorder = LanReadinessRecorder { _, _, _ -> },
            clock = { now },
        )
        val first = binding()
        val changed = first.copy(bindingVersion = 2)

        coordinator.refreshDue(listOf(first))
        coordinator.refreshDue(listOf(first))
        coordinator.refreshDue(listOf(first), force = true)
        coordinator.refreshDue(listOf(changed))

        assertEquals(3, probes)
    }

    private fun binding() = LocalPrinterBinding(
        merchantId = "2",
        terminalInstanceId = "26c2003c-a8f2-4fef-9bcf-6a943d47de35",
        localBindingId = "92b22dc6-95af-4857-a113-8644134488f1",
        printerId = "18",
        bindingVersion = 1,
        transport = PrinterTransport.LAN,
        displayName = "V2 LAN",
        paperWidth = PaperWidth.MM_80,
        transportConfig = LocalTransportConfig.Lan("10.0.2.2", 19_100),
        localStatus = PhysicalStatus.CONNECTED,
        syncStatus = BindingSyncStatus.SYNCED,
        deletedPending = false,
        enabled = false,
        lastConnectedAt = null,
        lastTestedAt = null,
        lastStatusReportAt = null,
    )
}
