package com.yunqiao.life.merchantterminal.network

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.security.CanonicalReceiptHash
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Base64

class TerminalV2ApiClientTest {
    @Test
    fun bootstrapUsesDeployedMerchantRouteAndDerivesTerminalBearerLocally() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"code":"OK","data":{"terminalId":"15","tokenVersion":1,"tokenExpiresAt":"2030-01-01T00:00:00Z","authorizationScheme":"Terminal"}}""",
                ),
            )
            val jwt = merchantJwt("11")
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
            val response = client.bootstrap(jwt, "terminal.instance.123", "s".repeat(43), "D2")

            assertEquals("11", response.merchantId)
            assertEquals("15", response.terminalId)
            assertEquals("yt1.15.${"s".repeat(43)}", response.terminalBearer)
            val request = server.takeRequest()
            assertEquals("/merchant/printing/connector/lan-terminal/bootstrap", request.path)
            assertEquals("Bearer $jwt", request.getHeader("Authorization"))
            val body = JSONObject(request.body.readUtf8())
            assertEquals("terminal.instance.123", body.getString("terminalInstanceId"))
            assertEquals(43, body.getString("terminalSecret").length)
            assertEquals(43, body.length().let { body.getString("terminalSecret").length })
        }
    }

    @Test
    fun heartbeatUsesTerminalBearerAndConfigUsesDeployedRoute() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"code":"OK","data":{}}"""))
            server.enqueue(
                MockResponse().setBody(
                    """{"code":"OK","data":{"terminal":{"id":"15","configVersion":9},"merchantPrintingEnabled":true,"terminalEnabled":true,"executionEnabled":true,"automaticCreationEnabled":false,"heartbeatIntervalSeconds":20,"pollIntervalSeconds":5,"boundPrinter":null}}""",
                ),
            )
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
            val terminalBearer = "t".repeat(24)
            client.heartbeat(terminalBearer, 3, 7)
            val config = client.config(terminalBearer)

            assertEquals("15", config.terminalId)
            assertEquals(9L, config.configVersion)
            assertEquals(true, config.canClaimJobs)
            assertEquals(0, config.printers.size)
            val heartbeat = server.takeRequest()
            val configRequest = server.takeRequest()
            assertEquals("/terminal/heartbeat", heartbeat.path)
            assertEquals("/terminal/config", configRequest.path)
            assertEquals("Terminal $terminalBearer", heartbeat.getHeader("Authorization"))
            assertEquals("Terminal $terminalBearer", configRequest.getHeader("Authorization"))
        }
    }

    @Test
    fun lanSyncAndStatusUseDeployedLanRoutesWithTerminalAuthentication() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"code":"OK","data":{"terminalId":"15","printerId":"37","localBindingId":"123e4567-e89b-12d3-a456-426614174000","bindingVersion":1,"status":"CONNECTED","enabled":true,"reportedAt":"2030-01-01T00:00:00Z"}}"""))
            server.enqueue(MockResponse().setBody("""{"code":"OK","data":{}}"""))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
            val token = "t".repeat(24)
            val binding = LocalPrinterBinding(
                merchantId = "11", terminalInstanceId = "terminal.instance.123",
                localBindingId = "123e4567-e89b-12d3-a456-426614174000",
                displayName = "LAN test", transport = PrinterTransport.LAN,
                transportConfig = LocalTransportConfig.Lan("10.0.2.2", 19100),
                paperWidth = PaperWidth.MM_80, localStatus = PhysicalStatus.CONNECTED,
                printerId = null, bindingVersion = 0, syncStatus = com.yunqiao.life.merchantterminal.model.BindingSyncStatus.PENDING_SYNC,
                deletedPending = false, enabled = true, lastConnectedAt = null,
                lastTestedAt = null, lastStatusReportAt = null,
            )
            val synced = client.syncBinding(token, binding)
            client.reportStatus(token, V2RouteIdentity(synced.printerId, synced.localBindingId, synced.bindingVersion, "LAN"), "CONNECTED", "LOCAL_TEST", JSONObject(), null, null)

            val sync = server.takeRequest()
            val status = server.takeRequest()
            assertEquals("/terminal/lan/bindings/sync", sync.path)
            assertEquals("Terminal $token", sync.getHeader("Authorization"))
            assertEquals("10.0.2.2", JSONObject(sync.body.readUtf8()).getString("host"))
            assertEquals("/terminal/lan/printers/status", status.path)
            assertEquals("Terminal $token", status.getHeader("Authorization"))
            assertEquals("37", JSONObject(status.body.readUtf8()).getString("printerId"))
        }
    }

    @Test
    fun lanActiveAndClaimUseSingleRouteIdentityAndTerminalCredential() {
        MockWebServer().use { server ->
            server.enqueue(okData(JSONObject().put("job", JSONObject.NULL)))
            server.enqueue(okData(JSONObject().put("job", lanJobJson())))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
            val route = lanRoute()

            assertEquals(null, client.activeLanJob(TERMINAL_TOKEN, route))
            val claimed = client.claimLanJob(
                terminalBearer = TERMINAL_TOKEN,
                route = route,
                allowAutomatic = false,
            )

            assertEquals("267", claimed?.id)
            assertEquals("TEST", claimed?.source)
            assertEquals(route, claimed?.route)
            val activeRequest = server.takeRequest()
            val claimRequest = server.takeRequest()
            assertEquals(
                "/terminal/lan/jobs/active?printerId=18&localBindingId=92b22dc6-95af-4857-a113-8644134488f1&bindingVersion=1",
                activeRequest.path,
            )
            assertEquals("Terminal $TERMINAL_TOKEN", activeRequest.getHeader("Authorization"))
            assertEquals("/terminal/lan/jobs/claim", claimRequest.path)
            assertEquals("Terminal $TERMINAL_TOKEN", claimRequest.getHeader("Authorization"))
            val body = JSONObject(claimRequest.body.readUtf8())
            assertEquals("18", body.getString("printerId"))
            assertEquals(route.localBindingId, body.getString("localBindingId"))
            assertEquals(1, body.getInt("bindingVersion"))
            assertEquals(false, body.getBoolean("allowAutomatic"))
        }
    }

    @Test
    fun lanPrintingExtendAndResultsUseLanJobContract() {
        MockWebServer().use { server ->
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
            val job = parseLanJob(client, server)
            server.enqueue(
                okData(
                    JSONObject()
                        .put("attempt", JSONObject().put("attemptNo", 1))
                        .put(
                            "job",
                            JSONObject()
                                .put("leaseVersion", 2)
                                .put("leaseExpiresAt", "2030-01-01T00:00:00Z"),
                        ),
                ),
            )
            server.enqueue(
                okData(
                    JSONObject()
                        .put("leaseVersion", 3)
                        .put("leaseExpiresAt", "2030-01-01T00:00:00Z"),
                ),
            )
            server.enqueue(okData(JSONObject()))
            server.enqueue(okData(JSONObject()))

            client.markPrinting(TERMINAL_TOKEN, job)
            client.extendLease(TERMINAL_TOKEN, job.id, job.route, leaseVersion = 2)
            client.succeeded(
                TERMINAL_TOKEN,
                job.id,
                job.route,
                job.adapter,
                job.contentHash,
                attemptNo = 1,
                leaseVersion = 3,
                bytesWritten = 31_707,
            )
            client.failed(
                TERMINAL_TOKEN,
                job.id,
                job.route,
                job.contentHash,
                attemptNo = 1,
                leaseVersion = 3,
                retryable = false,
                errorCode = "PRINTER_OFFLINE",
                errorMessage = "offline",
                bytesWritten = 0,
                uncertain = false,
            )

            assertEquals("/terminal/lan/jobs/267/printing", server.takeRequest().path)
            assertEquals("/terminal/lan/jobs/267/extend", server.takeRequest().path)
            assertEquals("/terminal/lan/jobs/267/succeeded", server.takeRequest().path)
            val failed = server.takeRequest()
            assertEquals("/terminal/lan/jobs/267/failed", failed.path)
            assertEquals("FAILED", JSONObject(failed.body.readUtf8()).getString("outcome"))
        }
    }

    private fun parseLanJob(
        client: TerminalV2ApiClient,
        server: MockWebServer,
    ): ClaimedV2PrintJob {
        server.enqueue(okData(JSONObject().put("job", lanJobJson())))
        return requireNotNull(client.claimLanJob(TERMINAL_TOKEN, lanRoute(), false)).also {
            server.takeRequest()
        }
    }

    private fun lanRoute() = V2RouteIdentity(
        printerId = "18",
        localBindingId = "92b22dc6-95af-4857-a113-8644134488f1",
        bindingVersion = 1,
        transport = "LAN",
    )

    private fun lanJobJson(): JSONObject {
        val snapshot = JSONObject().put("schemaVersion", 1)
        return JSONObject()
            .put("id", "267")
            .put("merchantId", "2")
            .put("printerId", "18")
            .put("status", "CLAIMED")
            .put("receiptType", "ORDER_CUSTOMER")
            .put("source", "TEST")
            .put("attemptCount", 0)
            .put("leaseVersion", 1)
            .put("leaseExpiresAt", "2030-01-01T00:00:00Z")
            .put("contentHash", CanonicalReceiptHash.compute(snapshot))
            .put("snapshotSchemaVersion", 1)
            .put("receiptSnapshot", snapshot)
            .put(
                "route",
                JSONObject()
                    .put("printerId", "18")
                    .put("localBindingId", lanRoute().localBindingId)
                    .put("bindingVersion", 1)
                    .put("adapter", "ANDROID_LAN_ESCPOS"),
            )
    }

    private fun okData(data: JSONObject) = MockResponse().setBody(
        JSONObject().put("code", "OK").put("data", data).toString(),
    )

    private fun merchantJwt(merchantId: String): String {
        val payload = Base64.getUrlEncoder().withoutPadding()
            .encodeToString("{\"merchantId\":\"$merchantId\"}".toByteArray())
        return "aaaaaaaa.${payload}.bbbbbbbb"
    }

    private companion object {
        const val TERMINAL_TOKEN = "terminal-credential-placeholder"
    }
}
