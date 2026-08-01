package com.yunqiao.life.merchantterminal.network

import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.security.CanonicalReceiptHash
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import java.util.UUID

class TerminalV2ApiClientTest {
    @Test
    fun bootstrapUsesMerchantBearerAndParsesAuthoritativeMerchant() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    {
                      "code":"OK",
                      "data":{
                        "merchantId":"11",
                        "terminalId":"15",
                        "authorizationScheme":"Bearer",
                        "token":"bbbbbbbbbbbbbbbbbbbbbbbb",
                        "tokenVersion":1,
                        "tokenExpiresAt":"2030-01-01T00:00:00Z",
                        "heartbeatSeconds":20,
                        "pollIntervalSeconds":5,
                        "configVersion":1
                      }
                    }
                    """.trimIndent(),
                ),
            )
            val client = TerminalV2ApiClient(
                endpointResolver = { path -> server.url(path).toString() },
            )
            val response = client.bootstrap(
                merchantJwt = "a".repeat(24),
                terminalInstanceId = "terminal.instance.123",
                terminalSecret = "s".repeat(43),
                deviceModel = "D2",
            )
            assertEquals("11", response.merchantId)
            assertEquals("15", response.terminalId)
            val request = server.takeRequest()
            assertEquals("/merchant/printing/connector/v2/bootstrap", request.path)
            assertEquals("Bearer ${"a".repeat(24)}", request.getHeader("Authorization"))
            val body = JSONObject(requireNotNull(request.body.readUtf8()))
            assertTrue(body.getJSONObject("capabilities").getBoolean("bluetoothClassic"))
            assertEquals(40, body.getInt("appVersionCode"))
        }
    }

    @Test
    fun heartbeatUsesStableNonV2RouteAndTerminalBearer() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"code":"OK","data":{}}"""))
            val client = TerminalV2ApiClient(
                endpointResolver = { path -> server.url(path).toString() },
            )
            client.heartbeat(
                terminalBearer = "t".repeat(24),
                heartbeatSequence = 3,
                appliedConfigVersion = 7,
            )
            val request = server.takeRequest()
            assertEquals("/terminal/heartbeat", request.path)
            assertEquals("Bearer ${"t".repeat(24)}", request.getHeader("Authorization"))
            val body = JSONObject(request.body.readUtf8())
            assertEquals(3L, body.getLong("heartbeatSeq"))
            assertEquals(7L, body.getLong("appliedConfigVersion"))
        }
    }

    @Test
    fun exposesServerBindingConflictForAdoptionWithoutDuplicateCreate() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setResponseCode(409)
                    .setBody(
                        """
                        {
                          "code":"V2_BINDING_VERSION_CONFLICT",
                          "message":"stale",
                          "printerId":"123",
                          "currentBindingVersion":7
                        }
                        """.trimIndent(),
                    ),
            )
            val client = TerminalV2ApiClient(
                endpointResolver = { path -> server.url(path).toString() },
            )
            val error = runCatching {
                client.archiveBinding(
                    terminalBearer = "a".repeat(24),
                    route = V2RouteIdentity("123", "binding-local-1", 6),
                )
            }.exceptionOrNull() as V2ApiException

            assertTrue(error.bindingConflict)
            assertEquals(7L, error.currentBindingVersion)
            assertEquals("123", error.currentPrinterId)
            val request = server.takeRequest()
            assertEquals("/terminal/v2/bindings/archive", request.path)
            assertEquals("Bearer ${"a".repeat(24)}", request.getHeader("Authorization"))
        }
    }

    @Test
    fun fullV2ContractCoversConfigBindingStatusClaimAttemptAndCredentialExpiry() {
        MockWebServer().use { server ->
            val localBindingId = UUID.randomUUID().toString()
            val route = V2RouteIdentity("101", localBindingId, 2)
            val snapshot = JSONObject()
                .put("schemaVersion", 1)
                .put("receiptType", "ORDER")
                .put("order", JSONObject().put("orderNo", "YQ-501"))
            val contentHash = CanonicalReceiptHash.compute(snapshot)
            val responses = listOf(
                """
                {"code":"OK","data":{"merchantId":"11","terminalId":"15",
                "merchantPrintingEnabled":true,"terminalEnabled":true,"executionEnabled":true,
                "automaticCreationEnabled":false,"heartbeatSeconds":20,"pollIntervalSeconds":5,
                "configVersion":9,"printers":[{"id":"101","name":"Kitchen",
                "channelType":"LOCAL_LAN_ESCPOS","paperWidth":"MM80","enabled":false,
                "status":"ONLINE","binding":{"localBindingId":"$localBindingId",
                "bindingVersion":2,"transport":"LAN"}}]}}
                """,
                """
                {"code":"OK","data":{"merchantId":"11","terminalId":"15",
                "printerId":"101","localBindingId":"$localBindingId","bindingVersion":2,
                "channelType":"LOCAL_LAN_ESCPOS","status":"ONLINE","enabled":false,
                "reportedAt":"2030-01-01T00:00:00Z"}}
                """,
                """{"code":"OK","data":{}}""",
                """
                {"code":"OK","data":{"job":{"id":"501","merchantId":"11",
                "printerId":"101","status":"CLAIMED","receiptType":"ORDER","source":"TEST",
                "attemptCount":0,"currentAttempt":null,"leaseVersion":1,
                "leaseExpiresAt":"2030-01-01T00:01:00Z","contentHash":"$contentHash",
                "snapshotSchemaVersion":1,"receiptSnapshot":$snapshot,
                "route":{"printerId":"101","localBindingId":"$localBindingId",
                "bindingVersion":2,"adapter":"LOCAL_LAN_ESCPOS"}}}}
                """,
                """
                {"code":"OK","data":{"attempt":{"attemptNo":1},"job":{"leaseVersion":2,
                "leaseExpiresAt":"2030-01-01T00:02:00Z"}}}
                """,
                """
                {"code":"OK","data":{"leaseVersion":3,
                "leaseExpiresAt":"2030-01-01T00:03:00Z"}}
                """,
                """{"code":"OK","data":{}}""",
                """{"code":"OK","data":{}}""",
            )
            responses.forEach { server.enqueue(MockResponse().setBody(it.trimIndent())) }
            server.enqueue(
                MockResponse().setResponseCode(401).setBody(
                    """{"code":"TERMINAL_CREDENTIAL_EXPIRED","message":"expired"}""",
                ),
            )
            val client = TerminalV2ApiClient(
                endpointResolver = { path -> server.url(path).toString() },
            )
            val terminalBearer = "t".repeat(24)

            val config = client.config(terminalBearer)
            assertEquals("11", config.merchantId)
            assertEquals(false, config.printers.single().enabled)

            val localBinding = LocalPrinterBinding(
                merchantId = "11",
                terminalInstanceId = "terminal-instance-123456",
                localBindingId = localBindingId,
                printerId = null,
                bindingVersion = 0,
                transport = PrinterTransport.LAN,
                displayName = "Kitchen",
                paperWidth = PaperWidth.MM_80,
                transportConfig = LocalTransportConfig.Lan("192.168.1.42"),
                localStatus = PhysicalStatus.CONNECTED,
                syncStatus = BindingSyncStatus.PENDING_SYNC,
                deletedPending = false,
                enabled = false,
                lastConnectedAt = 1L,
                lastTestedAt = 1L,
                lastStatusReportAt = null,
            )
            val synced = client.syncBinding(terminalBearer, localBinding)
            assertEquals("101", synced.printerId)
            assertEquals(2L, synced.bindingVersion)

            client.reportStatus(
                terminalBearer = terminalBearer,
                route = route,
                status = "CONNECTED",
                source = "LOCAL_TEST",
                capabilities = JSONObject().put("paperWidth", "MM80"),
                lastErrorCode = null,
                lastErrorMessage = null,
            )
            val job = requireNotNull(
                client.claim(
                    terminalBearer = terminalBearer,
                    allowAutomatic = false,
                    routes = listOf(route),
                ),
            )
            assertEquals("TEST", job.source)
            assertEquals(contentHash, job.contentHash)

            val attempt = client.markPrinting(terminalBearer, job)
            assertEquals(1, attempt.attemptNo)
            assertEquals(2L, attempt.leaseVersion)
            val lease = client.extendLease(
                terminalBearer,
                job.id,
                route,
                attempt.leaseVersion,
            )
            assertEquals(3L, lease.leaseVersion)
            client.succeeded(
                terminalBearer,
                job.id,
                route,
                job.adapter,
                contentHash,
                attemptNo = 1,
                leaseVersion = 3,
                bytesWritten = 128,
            )
            client.failed(
                terminalBearer,
                job.id,
                route,
                contentHash,
                attemptNo = 1,
                leaseVersion = 3,
                retryable = false,
                errorCode = "LAN_WRITE_FAILED",
                errorMessage = "write outcome unknown",
                bytesWritten = 32,
                uncertain = true,
            )
            val expiry = runCatching { client.config(terminalBearer) }
                .exceptionOrNull() as V2ApiException
            assertTrue(expiry.credentialInvalid)
            assertEquals("TERMINAL_CREDENTIAL_EXPIRED", expiry.errorCode)

            val requests = (0 until 9).map { server.takeRequest() }
            assertEquals("/terminal/v2/config", requests[0].path)
            assertEquals("GET", requests[0].method)
            assertEquals("/terminal/v2/bindings/sync", requests[1].path)
            assertEquals(0L, JSONObject(requests[1].body.readUtf8()).getLong("expectedBindingVersion"))
            assertEquals("/terminal/v2/printers/status", requests[2].path)
            assertEquals("LOCAL_TEST", JSONObject(requests[2].body.readUtf8()).getString("source"))
            assertEquals("/terminal/v2/jobs/claim", requests[3].path)
            val claimBody = JSONObject(requests[3].body.readUtf8())
            assertEquals(false, claimBody.getBoolean("allowAutomatic"))
            assertEquals(localBindingId, claimBody.getJSONArray("routes").getJSONObject(0)
                .getString("localBindingId"))
            assertEquals("/terminal/v2/jobs/501/printing", requests[4].path)
            assertEquals("/terminal/v2/jobs/501/extend-lease", requests[5].path)
            assertEquals("/terminal/v2/jobs/501/succeeded", requests[6].path)
            assertEquals(128, JSONObject(requests[6].body.readUtf8()).getInt("bytesWritten"))
            assertEquals("/terminal/v2/jobs/501/failed", requests[7].path)
            val uncertainBody = JSONObject(requests[7].body.readUtf8())
            assertEquals("UNCERTAIN", uncertainBody.getString("outcome"))
            assertEquals("PRINT_OUTCOME_UNKNOWN", uncertainBody.getString("errorCode"))
            assertEquals(false, uncertainBody.getBoolean("retryable"))
            assertEquals("/terminal/v2/config", requests[8].path)
            requests.forEach {
                assertEquals("Bearer $terminalBearer", it.getHeader("Authorization"))
            }
        }
    }
}
