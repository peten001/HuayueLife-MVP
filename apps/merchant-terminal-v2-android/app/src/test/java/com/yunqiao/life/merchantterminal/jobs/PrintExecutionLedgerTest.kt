package com.yunqiao.life.merchantterminal.jobs

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.model.PrintExecutionState
import com.yunqiao.life.merchantterminal.network.ClaimedV2PrintJob
import com.yunqiao.life.merchantterminal.network.V2RouteIdentity
import com.yunqiao.life.merchantterminal.storage.V2PrintingDatabase
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PrintExecutionLedgerTest {
    private lateinit var database: V2PrintingDatabase
    private lateinit var ledger: PrintExecutionLedger

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            V2PrintingDatabase::class.java,
        ).allowMainThreadQueries().build()
        ledger = PrintExecutionLedger(database.printingDao())
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun succeededAttemptBlocksDuplicatePhysicalExecution() = runBlocking {
        val job = job()
        val ready = ledger.register(job) as LedgerRegistration.Ready
        val printing = ledger.markPrinting(ready.entry, leaseVersion = 2, plannedBytes = 3)
        ledger.complete(
            printing,
            PrintExecutionState.SUCCEEDED,
            bytesWritten = 3,
            ioAttempted = true,
            retryable = false,
            errorCode = null,
        )

        assertTrue(ledger.register(job) is LedgerRegistration.DuplicateBlocked)
    }

    @Test
    fun processRestartConvertsPrintingToUncertain() = runBlocking {
        val ready = ledger.register(job()) as LedgerRegistration.Ready
        ledger.markPrinting(ready.entry, leaseVersion = 2, plannedBytes = 3)
        assertEquals(1, ledger.recoverInterrupted())
        assertTrue(ledger.register(job()) is LedgerRegistration.RequiresOperator)
    }

    private fun job() = ClaimedV2PrintJob(
        id = "101",
        merchantId = "11",
        printerId = "123",
        status = "CLAIMED",
        receiptType = "ORDER_CUSTOMER",
        source = "MANUAL",
        attemptCount = 0,
        currentAttemptNo = null,
        leaseVersion = 1,
        leaseExpiresAt = 1,
        contentHash = "a".repeat(64),
        route = V2RouteIdentity("123", "binding-one", 1, transport = "LAN"),
        adapter = "ANDROID_LAN_ESCPOS",
        renderProtocol = "ESC_POS_RASTER_V1",
        canonicalTemplateVersion = "YQ_CANONICAL_RECEIPT_V1",
        renderedPayloadSha256 = "b".repeat(64),
        renderedPayloadByteLength = 1,
        payloadTransport = "BINARY_PRINT_ARTIFACT_V1",
        artifactPath = "/terminal/jobs/101/artifact",
    )
}
