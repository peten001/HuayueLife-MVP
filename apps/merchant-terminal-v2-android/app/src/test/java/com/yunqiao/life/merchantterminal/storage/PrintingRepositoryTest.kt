package com.yunqiao.life.merchantterminal.storage

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.UUID
import com.yunqiao.life.merchantterminal.network.V2RemotePrinter

@RunWith(RobolectricTestRunner::class)
class PrintingRepositoryTest {
    private lateinit var database: V2PrintingDatabase
    private lateinit var repository: PrintingRepository

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            V2PrintingDatabase::class.java,
        ).allowMainThreadQueries().build()
        repository = PrintingRepository(database)
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun sameEndpointIsIsolatedByMerchantAndArchiveHidesImmediately() = runBlocking {
        val first = binding("11")
        val second = binding("12")
        repository.addLocalBinding(first)
        repository.addLocalBinding(second)
        assertEquals(1, repository.activeBindings("11").size)
        assertEquals(1, repository.activeBindings("12").size)

        repository.requestArchive("11", first.localBindingId)
        assertEquals(0, repository.activeBindings("11").size)
        assertEquals(1, repository.activeBindings("12").size)
    }

    @Test
    fun localTestTimestampsSurviveFirstSyncAndQueueLocalTestStatus() = runBlocking {
        val tested = binding("11").copy(
            localStatus = PhysicalStatus.CONNECTED,
            lastConnectedAt = 10_000L,
            lastTestedAt = 10_000L,
        )
        repository.addLocalBinding(tested)

        repository.markSynced(
            merchantId = tested.merchantId,
            localBindingId = tested.localBindingId,
            printerId = "101",
            bindingVersion = 1,
            enabled = false,
        )

        val stored = requireNotNull(repository.binding("11", tested.localBindingId))
        assertEquals(10_000L, stored.lastConnectedAt)
        assertEquals(10_000L, stored.lastTestedAt)
        val report = repository.dueStatusReports("11").single()
        assertEquals("101", report.printerId)
        assertEquals(1L, report.bindingVersion)
        assertEquals("CONNECTED", report.status)
        assertEquals("LOCAL_TEST", report.source)
    }

    @Test
    fun renamedBindingKeepsDesiredNameAcrossVersionConflictAndRetries() = runBlocking {
        val local = binding("11")
        repository.addLocalBinding(local)
        repository.markSynced("11", local.localBindingId, "101", 2, enabled = true)

        repository.updateDisplayName("11", local.localBindingId, "Front desk")
        val operation = repository.dueBindingOperations("11").single()
        assertEquals(2L, operation.expectedBindingVersion)
        assertEquals("Front desk", repository.binding("11", local.localBindingId)?.displayName)

        repository.adoptConflictAndRetry(
            operation,
            V2RemotePrinter(
                printerId = "101",
                displayName = "Old server name",
                channelType = "LOCAL_LAN_ESCPOS",
                paperWidth = "MM80",
                enabled = true,
                status = "ONLINE",
                localBindingId = local.localBindingId,
                bindingVersion = 3,
                transport = "LAN",
            ),
        )

        val pending = repository.binding("11", local.localBindingId)!!
        assertEquals("Front desk", pending.displayName)
        assertEquals(3L, pending.bindingVersion)
        assertEquals(BindingSyncStatus.PENDING_SYNC, pending.syncStatus)
    }

    private fun binding(merchantId: String) = LocalPrinterBinding(
        merchantId = merchantId,
        terminalInstanceId = "terminal-instance-123456",
        localBindingId = UUID.randomUUID().toString(),
        printerId = null,
        bindingVersion = 0,
        transport = PrinterTransport.LAN,
        displayName = "Kitchen",
        paperWidth = PaperWidth.MM_80,
        transportConfig = LocalTransportConfig.Lan("192.168.1.42", 9_100),
        localStatus = PhysicalStatus.UNKNOWN,
        syncStatus = BindingSyncStatus.LOCAL_ONLY,
        deletedPending = false,
        enabled = false,
        lastConnectedAt = null,
        lastTestedAt = null,
        lastStatusReportAt = null,
    )
}
