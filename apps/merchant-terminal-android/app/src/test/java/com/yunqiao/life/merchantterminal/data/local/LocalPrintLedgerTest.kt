package com.yunqiao.life.merchantterminal.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.connector.ClaimedPrintJob
import com.yunqiao.life.merchantterminal.security.SnapshotCipher
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LocalPrintLedgerTest {
    private lateinit var database: LocalPrintingDatabase
    private var time = 1_000L

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),
            LocalPrintingDatabase::class.java,
        ).allowMainThreadQueries().build()
    }

    @After fun tearDown() = database.close()

    @Test
    fun `successful server job is never printed twice`() = runBlocking {
        val ledger = ledger()
        val ready = ledger.registerClaim(job()) as ClaimRegistration.Ready
        val printing = ledger.markPrinting(ready.job, attemptNo = 1)
        val written = ledger.markUsbComplete(printing, bytesWritten = 300)
        ledger.markReported(written)

        val duplicate = ledger.registerClaim(job())
        assertTrue(duplicate is ClaimRegistration.AlreadySucceeded)
        assertEquals(LocalJobStatus.SUCCEEDED, (duplicate as ClaimRegistration.AlreadySucceeded).job.status)
    }

    @Test
    fun `process death during USB phase becomes uncertain and blocks retry`() = runBlocking {
        val ledger = ledger()
        val ready = ledger.registerClaim(job()) as ClaimRegistration.Ready
        ledger.markPrinting(ready.job, attemptNo = 1)

        assertEquals(LocalJobStatus.PRINTING, database.printingDao().job(job().id)?.status)
        assertEquals(1, database.printingDao().latestAttempt(job().id)?.attemptNo)

        val recovered = ledger.recoverInterrupted()
        assertEquals(1, recovered.size)
        val duplicate = ledger.registerClaim(job())
        assertTrue(duplicate is ClaimRegistration.RequiresOperator)
        assertEquals(
            LocalJobStatus.UNCERTAIN_PENDING_REPORT,
            (duplicate as ClaimRegistration.RequiresOperator).job.status,
        )
    }

    @Test
    fun `legacy claimed job with an orphan printing attempt is recovered as uncertain`() = runBlocking {
        val dao = database.printingDao()
        val claimed = (ledger().registerClaim(job()) as ClaimRegistration.Ready).job
        dao.insertAttempt(
            LocalPrintAttemptEntity(
                serverJobId = claimed.serverJobId,
                attemptNo = 1,
                startedAt = 1_100,
                appVersion = "legacy",
            ),
        )

        val recovered = ledger().recoverInterrupted()

        assertEquals(1, recovered.size)
        assertEquals(
            LocalJobStatus.UNCERTAIN_PENDING_REPORT,
            dao.job(claimed.serverJobId)?.status,
        )
        assertEquals("UNCERTAIN", dao.latestAttempt(claimed.serverJobId)?.result)
    }

    @Test
    fun `reported history pruning deletes old receipts and cascades attempts only after report`() =
        runBlocking {
            val dao = database.printingDao()
            val ready = (ledger().registerClaim(job()) as ClaimRegistration.Ready).job
            val printing = ledger().markPrinting(ready, attemptNo = 1)
            val finished = ledger().markUsbComplete(printing, bytesWritten = 20)
            ledger().markReported(finished)
            val reported = requireNotNull(dao.job(job().id))
            dao.updateJob(reported.copy(finishedAt = 1L))

            dao.pruneReportedHistory(cutoff = 2L, keepMostRecent = 500)

            assertEquals(null, dao.job(job().id))
            assertEquals(null, dao.latestAttempt(job().id))
        }

    @Test
    fun `successful USB outcome remains pending and cannot be finished a second time`() = runBlocking {
        val ready = (ledger().registerClaim(job()) as ClaimRegistration.Ready).job
        val printing = ledger().markPrinting(ready, attemptNo = 1)
        val pending = ledger().markUsbComplete(printing, bytesWritten = 100)

        assertTrue(pending.status in LocalJobStatus.pendingReport)
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) {
            runBlocking {
                ledger().markUsbFailed(
                    pending,
                    errorCode = "TERMINAL_AUTH_INVALID",
                    bytesWritten = 100,
                    retryable = false,
                    uncertain = true,
                )
            }
        }
        assertEquals(LocalJobStatus.PRINTED_PENDING_REPORT, database.printingDao().job(job().id)?.status)
    }

    @Test
    fun `renewed lease version is durable and used by later reports`() = runBlocking {
        val ledger = ledger()
        val ready = ledger.registerClaim(job()) as ClaimRegistration.Ready
        val printing = ledger.markPrinting(ready.job, attemptNo = 1)

        val extended = ledger.updateLease(printing, leaseVersion = 2, leaseExpiresAt = 200_000)

        assertEquals(2L, extended.leaseVersion)
        assertEquals(200_000L, extended.leaseExpiresAt)
        assertEquals(2L, database.printingDao().job(job().id)?.leaseVersion)
    }

    private fun ledger() = LocalPrintLedger(
        dao = database.printingDao(),
        cipher = object : SnapshotCipher {
            override fun encrypt(plaintext: String) = "encrypted:$plaintext"
            override fun decrypt(envelope: String) = envelope.removePrefix("encrypted:")
        },
        now = { ++time },
    )

    private fun job() = ClaimedPrintJob(
        id = "123",
        printerId = "456",
        receiptType = "ORDER_CUSTOMER",
        source = "MANUAL",
        leaseVersion = 1,
        leaseExpiresAt = 100_000,
        contentHash = "a".repeat(64),
        snapshotSchemaVersion = 1,
        receiptSnapshotJson = "{\"schemaVersion\":1}",
    )
}
