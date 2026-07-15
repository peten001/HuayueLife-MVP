package com.yunqiao.life.merchantterminal.connector

import com.yunqiao.life.merchantterminal.security.CanonicalReceiptHash
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL

@RunWith(RobolectricTestRunner::class)
class ConnectorApiClientTest {
    @Test
    fun `pairing uses the one-time contract without a web credential`() {
        val response = JSONObject()
            .put("code", "OK")
            .put(
                "data",
                JSONObject()
                    .put(
                        "terminal",
                        JSONObject()
                            .put("id", "31")
                            .put("merchantId", "17")
                            .put("name", "Front counter"),
                    )
                    .put(
                        "credential",
                        JSONObject().put(
                            "token",
                            "yt1.31.opaque-terminal-token-material",
                        ),
                    ),
            )
        val connection = FakeConnection(URL("https://api.example.test/api/v1/terminal/pair"), response)
        val api = ConnectorApiClient(
            credentialProvider = { null },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = { connection },
        )

        val paired = api.pair(
            PairingRequest(
                pairingId = "123e4567-e89b-42d3-a456-426614174000",
                pairingCode = "12345678",
                deviceIdentifier = "1a3ce891-a83c-4924-9169-8478b34d4c11",
                name = "Front counter",
            ),
        )

        val request = JSONObject(connection.requestBody.toString(Charsets.UTF_8))
        assertEquals("31", paired.terminalId)
        assertEquals("ANDROID", request.getString("platform"))
        assertEquals("12345678", request.getString("pairingCode"))
        assertFalse(connection.headers.containsKey("Authorization"))
    }

    @Test
    fun `claim uses terminal credential and explicitly keeps automatic jobs off`() {
        val snapshot = JSONObject()
            .put("schemaVersion", 1)
            .put("receiptType", "ORDER_CUSTOMER")
        val response = JSONObject()
            .put("code", "OK")
            .put(
                "data",
                JSONObject().put(
                    "job",
                    JSONObject()
                        .put("id", "123")
                        .put("printerId", "9")
                        .put("receiptType", "ORDER_CUSTOMER")
                        .put("source", "MANUAL")
                        .put("leaseVersion", 1)
                        .put("leaseExpiresAt", "2026-07-15T10:00:00.000Z")
                        .put("contentHash", CanonicalReceiptHash.compute(snapshot))
                        .put("snapshotSchemaVersion", 1)
                        .put("receiptSnapshot", snapshot),
                ),
            )
        val connection = FakeConnection(URL("https://api.example.test/api/v1/terminal/jobs/claim"), response)
        val api = ConnectorApiClient(
            credentialProvider = { "opaque-terminal-token-that-is-never-a-web-token" },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = { connection },
        )

        val claimed = api.claim(allowAutomatic = false)

        assertEquals("123", claimed?.id)
        assertEquals(
            "Terminal opaque-terminal-token-that-is-never-a-web-token",
            connection.headers["Authorization"],
        )
        assertFalse(JSONObject(connection.requestBody.toString(Charsets.UTF_8)).getBoolean("allowAutomatic"))
    }

    @Test
    fun `config reads all independent remote safety gates`() {
        val response = JSONObject()
            .put("code", "OK")
            .put(
                "data",
                JSONObject()
                    .put("taskCenterEnabled", true)
                    .put("executionEnabled", true)
                    .put("automaticCreationEnabled", false)
                    .put("terminalEnabled", true)
                    .put("merchantPrintingEnabled", true)
                    .put("printerEnabled", true)
                    .put("pollIntervalSeconds", 5)
                    .put("heartbeatIntervalSeconds", 10)
                    .put(
                        "terminal",
                        JSONObject().put("status", "ACTIVE").put("configVersion", 12),
                    )
                    .put(
                        "boundPrinter",
                        JSONObject()
                            .put("id", "9")
                            .put("enabled", true)
                            .put("channelType", "LOCAL_USB_ESCPOS"),
                    ),
            )
        val api = ConnectorApiClient(
            credentialProvider = { "opaque-terminal-token-that-is-never-a-web-token" },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = {
                FakeConnection(URL("https://api.example.test/api/v1/terminal/config"), response)
            },
        )

        val config = api.config()

        assertTrue(config.taskCenterEnabled)
        assertTrue(config.executionEnabled)
        assertTrue(config.terminalEnabled)
        assertTrue(config.merchantPrintingEnabled)
        assertTrue(config.boundPrinterEnabled)
        assertFalse(config.automaticPrintingEnabled)
        assertEquals("9", config.boundPrinterId)
        assertEquals("LOCAL_USB_ESCPOS", config.boundPrinterChannelType)
        assertEquals(5_000L, config.pollIntervalMs)
        assertEquals(10_000L, config.heartbeatIntervalMs)
        assertEquals(12L, config.configVersion)
    }

    @Test
    fun `lease extension returns the incremented version required by final reports`() {
        val response = JSONObject()
            .put("code", "OK")
            .put(
                "data",
                JSONObject()
                    .put("leaseVersion", 8)
                    .put("leaseExpiresAt", "2026-07-15T10:01:00.000Z"),
            )
        val connection = FakeConnection(
            URL("https://api.example.test/api/v1/terminal/jobs/123/extend-lease"),
            response,
        )
        val api = ConnectorApiClient(
            credentialProvider = { "opaque-terminal-token-that-is-never-a-web-token" },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = { connection },
        )

        val extended = api.extendLease("123", leaseVersion = 7)

        assertEquals(8L, extended.leaseVersion)
        assertEquals(1_784_109_660_000L, extended.leaseExpiresAt)
        assertEquals(7, JSONObject(connection.requestBody.toString(Charsets.UTF_8)).getLong("leaseVersion"))
    }

    @Test
    fun `automatic server job is rejected when local automatic claiming is off`() {
        val snapshot = JSONObject()
            .put("schemaVersion", 1)
            .put("receiptType", "ORDER_CUSTOMER")
        val response = JSONObject()
            .put("code", "OK")
            .put(
                "data",
                JSONObject().put(
                    "job",
                    JSONObject()
                        .put("id", "124")
                        .put("printerId", "9")
                        .put("receiptType", "ORDER_CUSTOMER")
                        .put("source", "AUTOMATIC")
                        .put("leaseVersion", 1)
                        .put("leaseExpiresAt", "2026-07-15T10:00:00.000Z")
                        .put("contentHash", CanonicalReceiptHash.compute(snapshot))
                        .put("snapshotSchemaVersion", 1)
                        .put("receiptSnapshot", snapshot),
                ),
            )
        val api = ConnectorApiClient(
            credentialProvider = { "opaque-terminal-token-that-is-never-a-web-token" },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = {
                FakeConnection(URL("https://api.example.test/api/v1/terminal/jobs/claim"), response)
            },
        )

        val error = assertThrows(ConnectorApiException::class.java) {
            api.claim(allowAutomatic = false)
        }
        assertEquals("UNEXPECTED_AUTOMATIC_JOB", error.errorCode)
    }

    @Test
    fun `claim rejects a tampered receipt before it can enter the local ledger`() {
        val authenticSnapshot = JSONObject()
            .put("schemaVersion", 1)
            .put("receiptType", "ORDER_CUSTOMER")
            .put("quantity", 1)
        val tamperedSnapshot = JSONObject(authenticSnapshot.toString()).put("quantity", 2)
        val response = JSONObject()
            .put("code", "OK")
            .put(
                "data",
                JSONObject().put(
                    "job",
                    JSONObject()
                        .put("id", "126")
                        .put("printerId", "9")
                        .put("receiptType", "ORDER_CUSTOMER")
                        .put("source", "MANUAL")
                        .put("leaseVersion", 1)
                        .put("leaseExpiresAt", "2026-07-15T10:00:00.000Z")
                        .put("contentHash", CanonicalReceiptHash.compute(authenticSnapshot))
                        .put("snapshotSchemaVersion", 1)
                        .put("receiptSnapshot", tamperedSnapshot),
                ),
            )
        val api = ConnectorApiClient(
            credentialProvider = { "opaque-terminal-token-that-is-never-a-web-token" },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = {
                FakeConnection(URL("https://api.example.test/api/v1/terminal/jobs/claim"), response)
            },
        )

        val error = assertThrows(ConnectorApiException::class.java) {
            api.claim(allowAutomatic = false)
        }

        assertEquals("CONTENT_HASH_MISMATCH", error.errorCode)
    }

    @Test
    fun `start and uncertain report preserve server attempt lease hash and safe outcome`() {
        val hash = "c".repeat(64)
        val startConnection = FakeConnection(
            URL("https://api.example.test/api/v1/terminal/jobs/125/printing"),
            JSONObject()
                .put("code", "OK")
                .put(
                    "data",
                    JSONObject()
                        .put(
                            "job",
                            JSONObject()
                                .put("leaseVersion", 4)
                                .put("leaseExpiresAt", "2026-07-15T10:00:00.000Z"),
                        )
                        .put("attempt", JSONObject().put("attemptNo", 2)),
                ),
        )
        val failConnection = FakeConnection(
            URL("https://api.example.test/api/v1/terminal/jobs/125/failed"),
            JSONObject().put("code", "OK").put("data", JSONObject()),
        )
        val startApi = ConnectorApiClient(
            credentialProvider = { "opaque-terminal-token-that-is-never-a-web-token" },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = { startConnection },
        )
        val job = ClaimedPrintJob(
            id = "125",
            printerId = "9",
            receiptType = "ORDER_CUSTOMER",
            source = "MANUAL",
            leaseVersion = 3,
            leaseExpiresAt = 1_784_109_600_000L,
            contentHash = hash,
            snapshotSchemaVersion = 1,
            receiptSnapshotJson = "{}",
        )

        val started = startApi.startPrinting(job, "wifi")
        ConnectorApiClient(
            credentialProvider = { "opaque-terminal-token-that-is-never-a-web-token" },
            endpointResolver = { "https://api.example.test/api/v1$it" },
            connectionFactory = { failConnection },
        ).failed(
            jobId = job.id,
            attemptNo = started.attemptNo,
            leaseVersion = started.leaseVersion,
            retryable = true,
            errorCode = "USB_WRITE_FAILED",
            errorMessage = "partial USB write",
            bytesWritten = 120,
            uncertain = true,
            contentHash = hash,
        )

        val startBody = JSONObject(startConnection.requestBody.toString(Charsets.UTF_8))
        val failBody = JSONObject(failConnection.requestBody.toString(Charsets.UTF_8))
        assertEquals(3L, startBody.getLong("leaseVersion"))
        assertEquals(hash, startBody.getString("contentHash"))
        assertEquals("ANDROID_USB_ESCPOS", startBody.getString("adapter"))
        assertEquals(2, started.attemptNo)
        assertEquals(4L, started.leaseVersion)
        assertEquals("UNCERTAIN", failBody.getString("outcome"))
        assertEquals("PRINT_OUTCOME_UNKNOWN", failBody.getString("errorCode"))
        assertFalse(failBody.getBoolean("retryable"))
        assertEquals(120, failBody.getInt("bytesWritten"))
    }

    private class FakeConnection(url: URL, response: JSONObject) : HttpURLConnection(url) {
        val headers = linkedMapOf<String, String>()
        val requestBody = ByteArrayOutputStream()
        private val responseBytes = response.toString().toByteArray(Charsets.UTF_8)

        override fun setRequestProperty(key: String, value: String) {
            headers[key] = value
        }

        override fun getOutputStream(): OutputStream = requestBody
        override fun getInputStream(): InputStream = ByteArrayInputStream(responseBytes)
        override fun getResponseCode(): Int = 200
        override fun connect() = Unit
        override fun disconnect() = Unit
        override fun usingProxy(): Boolean = false
    }
}
