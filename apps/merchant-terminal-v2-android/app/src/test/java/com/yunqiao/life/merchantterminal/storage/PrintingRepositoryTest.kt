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
import com.yunqiao.life.merchantterminal.network.V2ArchivedLanBinding
import com.yunqiao.life.merchantterminal.network.V2ArchivedUsbBinding
import com.yunqiao.life.merchantterminal.network.V2RemotePrinter
import com.yunqiao.life.merchantterminal.network.V2LanRemoteBinding

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

    @Test
    fun configRefreshAppliesServerEnabledAsTheLocalCache() = runBlocking {
        val local = binding("11").copy(
            transport = PrinterTransport.USB,
            transportConfig = LocalTransportConfig.Usb(
                vendorId = 0x0fe6,
                productId = 0x811e,
                deviceName = "/dev/bus/usb/001/002",
                interfaceIndex = 0,
                interfaceId = 0,
                alternateSetting = 0,
                interfaceClass = 7,
                endpointAddress = 1,
            ),
        )
        repository.addLocalBinding(local)
        repository.markSynced("11", local.localBindingId, "101", 1, enabled = false)

        repository.applyRemotePrinters(
            "11",
            listOf(
                V2RemotePrinter(
                    printerId = "101",
                    displayName = "Server USB",
                    channelType = "LOCAL_USB_ESCPOS",
                    paperWidth = "MM80",
                    enabled = true,
                    status = "ONLINE",
                    localBindingId = local.localBindingId,
                    bindingVersion = 1,
                    transport = "USB",
                ),
            ),
        )

        assertEquals(true, repository.binding("11", local.localBindingId)?.enabled)
    }

    @Test
    fun lanConfigRefreshAppliesBothServerEnabledStates() = runBlocking {
        val enabledByServer = binding("11")
        val disabledByServer = binding("11").copy(
            transportConfig = LocalTransportConfig.Lan("192.168.1.43", 9_100),
        )
        repository.addLocalBinding(enabledByServer)
        repository.addLocalBinding(disabledByServer)
        repository.markSynced("11", enabledByServer.localBindingId, "101", 1, enabled = false)
        repository.markSynced("11", disabledByServer.localBindingId, "102", 2, enabled = true)

        repository.applyRemoteLanBindings(
            "11",
            listOf(
                V2LanRemoteBinding("101", enabledByServer.localBindingId, 1, enabled = true),
                V2LanRemoteBinding("102", disabledByServer.localBindingId, 2, enabled = false),
            ),
        )

        assertEquals(true, repository.binding("11", enabledByServer.localBindingId)?.enabled)
        assertEquals(false, repository.binding("11", disabledByServer.localBindingId)?.enabled)
    }

    @Test
    fun lanConfigRefreshRequiresTheCompleteBindingIdentity() = runBlocking {
        val local = binding("11")
        repository.addLocalBinding(local)
        repository.markSynced("11", local.localBindingId, "101", 3, enabled = false)

        repository.applyRemoteLanBindings(
            "11",
            listOf(
                V2LanRemoteBinding("999", local.localBindingId, 3, enabled = true),
                V2LanRemoteBinding("101", UUID.randomUUID().toString(), 3, enabled = true),
                V2LanRemoteBinding("101", local.localBindingId, 4, enabled = true),
            ),
        )

        assertEquals(false, repository.binding("11", local.localBindingId)?.enabled)
    }

    @Test
    fun matchingLanTombstoneRemovesBindingQueuesButPreservesExecutionHistory() = runBlocking {
        val local = binding("11")
        repository.addLocalBinding(local)
        repository.markSynced("11", local.localBindingId, "101", 3, enabled = true)
        repository.updateDisplayName("11", local.localBindingId, "Kitchen renamed")
        repository.queueStatusProbe(requireNotNull(repository.binding("11", local.localBindingId)))
        repository.executionDao().reserveExecution(execution(local, "SUCCEEDED"))

        val result = repository.applyArchivedLanBindings(
            "11",
            listOf(
                V2ArchivedLanBinding(
                    printerId = "101",
                    localBindingId = local.localBindingId,
                    bindingVersion = 3,
                    archivedAt = 1_785_808_800_000L,
                ),
            ),
        )

        assertEquals(1, result.removed.size)
        assertEquals(0, result.deferred.size)
        assertEquals(null, repository.binding("11", local.localBindingId))
        assertEquals(0, repository.dueBindingOperations("11").size)
        assertEquals(0, repository.dueStatusReports("11").size)
        assertEquals("SUCCEEDED", repository.executionDao().latestExecution("11", "501")?.state)
    }

    @Test
    fun lanTombstoneRequiresExactIdentityAndNeverRemovesUsbOrOtherLanBindings() = runBlocking {
        val target = binding("11")
        val otherLan = binding("11").copy(
            transportConfig = LocalTransportConfig.Lan("192.168.1.43", 9_100),
        )
        val usb = binding("11").copy(
            transport = PrinterTransport.USB,
            transportConfig = LocalTransportConfig.Usb(
                vendorId = 0x0fe6,
                productId = 0x811e,
                deviceName = "/dev/bus/usb/001/002",
                interfaceIndex = 0,
                interfaceId = 0,
                alternateSetting = 0,
                interfaceClass = 7,
                endpointAddress = 1,
            ),
        )
        repository.addLocalBinding(target)
        repository.addLocalBinding(otherLan)
        repository.addLocalBinding(usb)
        repository.markSynced("11", target.localBindingId, "101", 3, enabled = true)
        repository.markSynced("11", otherLan.localBindingId, "102", 4, enabled = true)
        repository.markSynced("11", usb.localBindingId, "103", 5, enabled = true)

        val result = repository.applyArchivedLanBindings(
            "11",
            listOf(
                V2ArchivedLanBinding("999", target.localBindingId, 3, 1L),
                V2ArchivedLanBinding("101", UUID.randomUUID().toString(), 3, 1L),
                V2ArchivedLanBinding("101", target.localBindingId, 4, 1L),
                V2ArchivedLanBinding("103", usb.localBindingId, 5, 1L),
            ),
        )

        assertEquals(0, result.removed.size)
        assertEquals(0, result.deferred.size)
        assertEquals(3, repository.activeBindings("11").size)
        assertEquals("101", repository.binding("11", target.localBindingId)?.printerId)
        assertEquals("102", repository.binding("11", otherLan.localBindingId)?.printerId)
        assertEquals(PrinterTransport.USB, repository.binding("11", usb.localBindingId)?.transport)
    }

    @Test
    fun activeLocalPrintingDefersPhysicalDeletionUntilTheNextConfigRefresh() = runBlocking {
        val local = binding("11")
        repository.addLocalBinding(local)
        repository.markSynced("11", local.localBindingId, "101", 3, enabled = true)
        repository.updateDisplayName("11", local.localBindingId, "Kitchen renamed")
        repository.queueStatusProbe(requireNotNull(repository.binding("11", local.localBindingId)))
        repository.executionDao().reserveExecution(execution(local, "PRINTING"))
        val tombstone = V2ArchivedLanBinding("101", local.localBindingId, 3, 1L)

        val deferred = repository.applyArchivedLanBindings("11", listOf(tombstone))

        assertEquals(1, deferred.deferred.size)
        assertEquals(true, repository.binding("11", local.localBindingId)?.deletedPending)
        assertEquals(0, repository.activeBindings("11").size)
        assertEquals(0, repository.dueBindingOperations("11").size)
        assertEquals(0, repository.dueStatusReports("11").size)
        assertEquals(
            1,
            repository.executionDao().completeExecution(
                merchantId = "11",
                jobId = "501",
                attemptNo = 1,
                state = "SUCCEEDED",
                bytesWritten = 100,
                ioAttempted = true,
                retryable = false,
                errorCode = null,
                updatedAt = 2L,
            ),
        )

        val removed = repository.applyArchivedLanBindings("11", listOf(tombstone))

        assertEquals(1, removed.removed.size)
        assertEquals(null, repository.binding("11", local.localBindingId))
        assertEquals("SUCCEEDED", repository.executionDao().latestExecution("11", "501")?.state)
    }

    @Test
    fun matchingUsbTombstoneRemovesBindingQueuesAndProbeButPreservesExecutionHistory() = runBlocking {
        val local = usbBinding("11")
        repository.addLocalBinding(local)
        repository.markSynced("11", local.localBindingId, "101", 3, enabled = true)
        repository.updateDisplayName("11", local.localBindingId, "USB renamed")
        repository.executionDao().upsertBindingOperation(
            PendingBindingOperationEntity(
                operationId = "11:${local.localBindingId}:ARCHIVE",
                merchantId = "11",
                terminalInstanceId = local.terminalInstanceId,
                localBindingId = local.localBindingId,
                operationType = "ARCHIVE",
                expectedBindingVersion = 3,
                attemptCount = 0,
                nextAttemptAt = 1L,
                lastErrorCode = null,
                createdAt = 1L,
                updatedAt = 1L,
            ),
        )
        repository.queueStatusProbe(requireNotNull(repository.binding("11", local.localBindingId)))
        repository.executionDao().reserveExecution(execution(local, "SUCCEEDED"))
        assertEquals(2, repository.dueBindingOperations("11").size)
        assertEquals(1, repository.dueStatusReports("11").size)

        val result = repository.applyArchivedUsbBindings(
            "11",
            listOf(usbTombstone(local)),
        )

        assertEquals(1, result.removed.size)
        assertEquals(0, result.deferred.size)
        assertEquals(null, repository.binding("11", local.localBindingId))
        assertEquals(0, repository.dueBindingOperations("11").size)
        assertEquals(0, repository.dueStatusReports("11").size)
        assertEquals("SUCCEEDED", repository.executionDao().latestExecution("11", "501")?.state)
    }

    @Test
    fun usbTombstoneRequiresTransportAndExactIdentityWithoutAffectingLan() = runBlocking {
        val target = usbBinding("11")
        val lan = binding("11")
        repository.addLocalBinding(target)
        repository.addLocalBinding(lan)
        repository.markSynced("11", target.localBindingId, "101", 3, enabled = true)
        repository.markSynced("11", lan.localBindingId, "102", 4, enabled = true)

        val result = repository.applyArchivedUsbBindings(
            "11",
            listOf(
                usbTombstone(target).copy(printerId = "999"),
                usbTombstone(target).copy(localBindingId = UUID.randomUUID().toString()),
                usbTombstone(target).copy(bindingVersion = 4),
                usbTombstone(target).copy(transport = "LAN"),
                V2ArchivedUsbBinding("USB", "102", lan.localBindingId, 4, 1L),
            ),
        )

        assertEquals(0, result.removed.size)
        assertEquals(0, result.deferred.size)
        assertEquals("101", repository.binding("11", target.localBindingId)?.printerId)
        assertEquals(PrinterTransport.LAN, repository.binding("11", lan.localBindingId)?.transport)
    }

    @Test
    fun activeUsbPrintingDefersDeletionWithoutResyncingOrRotatingTheBinding() = runBlocking {
        val local = usbBinding("11")
        repository.addLocalBinding(local)
        repository.markSynced("11", local.localBindingId, "101", 3, enabled = true)
        repository.updateDisplayName("11", local.localBindingId, "USB renamed")
        repository.queueStatusProbe(requireNotNull(repository.binding("11", local.localBindingId)))
        repository.executionDao().reserveExecution(execution(local, "PRINTING"))
        val tombstone = usbTombstone(local)

        val deferred = repository.applyArchivedUsbBindings("11", listOf(tombstone))

        assertEquals(1, deferred.deferred.size)
        assertEquals(true, repository.binding("11", local.localBindingId)?.deletedPending)
        assertEquals(0, repository.activeBindings("11").size)
        assertEquals(0, repository.dueBindingOperations("11").size)
        assertEquals(0, repository.dueStatusReports("11").size)
        assertEquals(
            1,
            repository.executionDao().completeExecution(
                merchantId = "11",
                jobId = "501",
                attemptNo = 1,
                state = "SUCCEEDED",
                bytesWritten = 100,
                ioAttempted = true,
                retryable = false,
                errorCode = null,
                updatedAt = 2L,
            ),
        )

        val removed = repository.applyArchivedUsbBindings("11", listOf(tombstone))

        assertEquals(1, removed.removed.size)
        assertEquals(null, repository.binding("11", local.localBindingId))
        assertEquals(0, repository.dueBindingOperations("11").size)
        assertEquals("SUCCEEDED", repository.executionDao().latestExecution("11", "501")?.state)
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

    private fun usbBinding(merchantId: String) = binding(merchantId).copy(
        transport = PrinterTransport.USB,
        displayName = "Front USB",
        transportConfig = LocalTransportConfig.Usb(
            vendorId = 0x0fe6,
            productId = 0x811e,
            deviceName = "/dev/bus/usb/001/002",
            interfaceIndex = 0,
            interfaceId = 0,
            alternateSetting = 0,
            interfaceClass = 7,
            endpointAddress = 1,
        ),
    )

    private fun usbTombstone(binding: LocalPrinterBinding) = V2ArchivedUsbBinding(
        transport = "USB",
        printerId = "101",
        localBindingId = binding.localBindingId,
        bindingVersion = 3,
        archivedAt = 1L,
    )

    private fun execution(
        binding: LocalPrinterBinding,
        state: String,
    ) = PrintExecutionLedgerEntity(
        ledgerKey = "${binding.merchantId}:501:1",
        merchantId = binding.merchantId,
        jobId = "501",
        attemptNo = 1,
        localBindingId = binding.localBindingId,
        printerId = "101",
        bindingVersion = 3,
        contentHash = "a".repeat(64),
        adapter = if (binding.transport == PrinterTransport.USB) {
            "ANDROID_USB_ESCPOS"
        } else {
            "ANDROID_LAN_ESCPOS"
        },
        leaseVersion = 1,
        state = state,
        plannedBytes = 100,
        bytesWritten = if (state == "SUCCEEDED") 100 else 0,
        ioAttempted = state != "CLAIMED",
        retryable = false,
        errorCode = null,
        serverReportedAt = null,
        createdAt = 1L,
        updatedAt = 1L,
    )
}
