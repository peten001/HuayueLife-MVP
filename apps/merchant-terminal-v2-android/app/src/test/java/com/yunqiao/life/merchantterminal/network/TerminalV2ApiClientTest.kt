package com.yunqiao.life.merchantterminal.network

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.security.CanonicalReceiptHash
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNotNull
import org.junit.Test
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.createTempDirectory

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
            assertTrue(config.archivedBindings.isEmpty())
            val heartbeat = server.takeRequest()
            val configRequest = server.takeRequest()
            assertEquals("/terminal/heartbeat", heartbeat.path)
            assertEquals("/terminal/config", configRequest.path)
            assertEquals("Terminal $terminalBearer", heartbeat.getHeader("Authorization"))
            assertEquals("Terminal $terminalBearer", configRequest.getHeader("Authorization"))
            assertTrue(
                JSONObject(heartbeat.body.readUtf8())
                    .getJSONObject("capabilities")
                    .getBoolean("BINARY_PRINT_ARTIFACT_V1"),
            )
        }
    }

    @Test
    fun configParsesServerEnabledAndStableUsbBindingRoute() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"code":"OK","data":{"terminal":{"id":"15","configVersion":9},"merchantPrintingEnabled":true,"terminalEnabled":true,"executionEnabled":true,"automaticCreationEnabled":false,"heartbeatIntervalSeconds":20,"pollIntervalSeconds":5,"boundPrinter":{"id":"37","name":"Front USB","channelType":"LOCAL_USB_ESCPOS","paperWidth":"MM80","enabled":true,"status":"ONLINE","capabilities":{"usbBinding":{"localBindingId":"123e4567-e89b-12d3-a456-426614174000","bindingVersion":4}}},"archivedBindings":[{"transport":"USB","printerId":"38","localBindingId":"223e4567-e89b-12d3-a456-426614174000","bindingVersion":5,"archivedAt":"2026-08-04T02:00:00.000Z"}]}}""",
                ),
            )
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

            val config = client.config(TERMINAL_TOKEN)
            val printer = config.printers.single()
            val archived = config.archivedBindings.single()

            assertEquals("37", printer.printerId)
            assertEquals("123e4567-e89b-12d3-a456-426614174000", printer.localBindingId)
            assertEquals(4L, printer.bindingVersion)
            assertTrue(printer.enabled)
            assertEquals("USB", printer.transport)
            assertEquals("USB", archived.transport)
            assertEquals("38", archived.printerId)
            assertEquals("223e4567-e89b-12d3-a456-426614174000", archived.localBindingId)
            assertEquals(5L, archived.bindingVersion)
            assertEquals(1_785_808_800_000L, archived.archivedAt)
        }
    }

    @Test
    fun lanConfigParsesServerEnabledWithStableBindingIdentity() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"code":"OK","data":{"terminalEnabled":true,"lanPrintingEnabled":true,"bindings":[{"printerId":"26","localBindingId":"123e4567-e89b-12d3-a456-426614174000","bindingVersion":3,"enabled":true},{"printerId":"27","localBindingId":"223e4567-e89b-12d3-a456-426614174000","bindingVersion":4,"enabled":false}],"archivedBindings":[{"printerId":"28","localBindingId":"323e4567-e89b-12d3-a456-426614174000","bindingVersion":5,"archivedAt":"2026-08-04T02:00:00.000Z"}]}}""",
                ),
            )
            server.enqueue(
                MockResponse().setBody(
                    """{"code":"OK","data":{"terminalEnabled":true,"lanPrintingEnabled":true}}""",
                ),
            )
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

            val config = client.lanConfig(TERMINAL_TOKEN)
            val legacyConfig = client.lanConfig(TERMINAL_TOKEN)

            assertEquals(2, config.bindings.size)
            assertEquals("26", config.bindings[0].printerId)
            assertEquals("123e4567-e89b-12d3-a456-426614174000", config.bindings[0].localBindingId)
            assertEquals(3L, config.bindings[0].bindingVersion)
            assertTrue(config.bindings[0].enabled)
            assertFalse(config.bindings[1].enabled)
            assertEquals("28", config.archivedBindings.single().printerId)
            assertEquals("323e4567-e89b-12d3-a456-426614174000", config.archivedBindings.single().localBindingId)
            assertEquals(5L, config.archivedBindings.single().bindingVersion)
            assertEquals(1_785_808_800_000L, config.archivedBindings.single().archivedAt)
            assertTrue(legacyConfig.bindings.isEmpty())
            assertTrue(legacyConfig.archivedBindings.isEmpty())
            assertEquals("/terminal/lan/config", server.takeRequest().path)
            assertEquals("/terminal/lan/config", server.takeRequest().path)
        }
    }

    @Test
    fun usbSyncAndStatusUseProductionDtosWithoutEnabledOrLanRouteFields() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"code":"OK","data":{"merchantId":"11","terminalId":"15","printerId":"37","localBindingId":"123e4567-e89b-12d3-a456-426614174000","bindingVersion":1,"channelType":"LOCAL_USB_ESCPOS","status":"UNKNOWN","enabled":false,"reportedAt":"2030-01-01T00:00:00Z"}}""",
                ),
            )
            server.enqueue(okData(JSONObject()))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
            val binding = usbBinding()

            val synced = client.syncBinding(TERMINAL_TOKEN, binding)
            client.reportStatus(
                TERMINAL_TOKEN,
                V2RouteIdentity(synced.printerId, synced.localBindingId, synced.bindingVersion, "USB"),
                "CONNECTED",
                JSONObject().put("usbDeviceRecognized", true),
                null,
                null,
            )

            assertFalse(synced.enabled)
            val sync = server.takeRequest()
            assertEquals("/terminal/usb/bindings/sync", sync.path)
            val syncBody = JSONObject(sync.body.readUtf8())
            assertFalse(syncBody.has("enabled"))
            assertFalse(syncBody.has("transport"))
            assertFalse(syncBody.has("transportConfig"))
            assertEquals(0x0fe6, syncBody.getInt("vendorId"))
            assertEquals(0x811e, syncBody.getInt("productId"))

            val status = server.takeRequest()
            assertEquals("/terminal/printers/status", status.path)
            val statusBody = JSONObject(status.body.readUtf8())
            assertEquals(
                setOf("printerId", "status", "capabilities", "lastErrorCode", "lastErrorMessage"),
                statusBody.keys().asSequence().toSet(),
            )
            assertFalse(statusBody.has("localBindingId"))
            assertFalse(statusBody.has("bindingVersion"))
            assertFalse(statusBody.has("source"))
        }
    }

    @Test
    fun usbActiveAndClaimParseTheSameProductionRouteWithoutLanTupleRequest() {
        MockWebServer().use { server ->
            server.enqueue(okData(JSONObject().put("job", usbJobJson())))
            server.enqueue(okData(JSONObject().put("job", usbJobJson())))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

            val active = requireNotNull(client.activeJob(TERMINAL_TOKEN))
            val claimed = requireNotNull(client.claim(TERMINAL_TOKEN, allowAutomatic = false))

            assertEquals(active.route, claimed.route)
            assertEquals("USB", claimed.route.transport)
            assertEquals("ANDROID_USB_ESCPOS", claimed.adapter)
            assertEquals("/terminal/jobs/active", server.takeRequest().path)
            val claimRequest = server.takeRequest()
            assertEquals("/terminal/jobs/claim", claimRequest.path)
            val claimBody = JSONObject(claimRequest.body.readUtf8())
            assertEquals(setOf("allowAutomatic", "leaseMs"), claimBody.keys().asSequence().toSet())
            assertFalse(claimBody.has("routes"))
            assertFalse(claimBody.has("localBindingId"))
            assertFalse(claimBody.has("bindingVersion"))
        }
    }

    @Test
    fun usbActiveAcceptsPrintDocumentV2Snapshot() {
        MockWebServer().use { server ->
            val snapshot = JSONObject(
                """{"documentType":"PRINT_DOCUMENT","schemaVersion":2,"paperWidth":"MM80","copies":1,"blocks":[{"type":"TEXT","text":"PrintDocument V2","align":"CENTER","bold":true,"fontSize":"NORMAL","underline":false}]}""",
            )
            val job = usbJobJson()
                .put("snapshotSchemaVersion", 2)
                .put("receiptSnapshot", snapshot)
                .put("contentHash", CanonicalReceiptHash.compute(snapshot))
            server.enqueue(okData(JSONObject().put("job", job)))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

            val active = requireNotNull(client.activeJob(TERMINAL_TOKEN))

            assertEquals(2, active.snapshotSchemaVersion)
            assertEquals(2, JSONObject(active.receiptSnapshotJson).getInt("schemaVersion"))
            assertEquals("PRINT_DOCUMENT", JSONObject(active.receiptSnapshotJson).getString("documentType"))
        }
    }

    @Test
    fun usbActiveAcceptsMeasuredPrintDocumentV3Snapshot() {
        MockWebServer().use { server ->
            val snapshot = JSONObject(
                """{"documentType":"PRINT_DOCUMENT","schemaVersion":3,"paperWidth":"MM58","copies":1,"blocks":[{"type":"COLUMNS","gapDots":6,"cells":[{"text":"Món","weight":82,"align":"LEFT","bold":true,"fontSize":"SMALL","overflow":"FIT","paddingDots":0},{"text":"SL","weight":18,"align":"CENTER","bold":true,"fontSize":"SMALL","overflow":"FIT","paddingDots":0}]}]}""",
            )
            val job = usbJobJson()
                .put("snapshotSchemaVersion", 3)
                .put("receiptSnapshot", snapshot)
                .put("contentHash", CanonicalReceiptHash.compute(snapshot))
            server.enqueue(okData(JSONObject().put("job", job)))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

            val active = requireNotNull(client.activeJob(TERMINAL_TOKEN))

            assertEquals(3, active.snapshotSchemaVersion)
            assertEquals(3, JSONObject(active.receiptSnapshotJson).getInt("schemaVersion"))
        }
    }

    @Test
    fun usbJobWithoutProductionRouteIsRejectedInsteadOfUsingAFalseFixture() {
        MockWebServer().use { server ->
            val withoutRoute = usbJobJson().apply { remove("route") }
            server.enqueue(okData(JSONObject().put("job", withoutRoute)))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

            val error = runCatching { client.activeJob(TERMINAL_TOKEN) }.exceptionOrNull()

            assertTrue(error is V2ApiException)
            assertEquals("INVALID_RESPONSE", (error as V2ApiException).errorCode)
        }
    }

    @Test
    fun usbJobActionsUseGenericEndpointsAndExactDtoFields() {
        MockWebServer().use { server ->
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
            server.enqueue(okData(JSONObject().put("job", usbJobJson())))
            val job = requireNotNull(client.claim(TERMINAL_TOKEN, allowAutomatic = false))
            server.takeRequest()
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
            server.enqueue(okData(JSONObject().put("jobId", "267").put("status", "SUCCEEDED")))
            server.enqueue(okData(JSONObject().put("jobId", "267").put("status", "FAILED")))

            client.markPrinting(TERMINAL_TOKEN, job)
            client.extendLease(TERMINAL_TOKEN, job.id, job.route, 2)
            client.succeeded(
                TERMINAL_TOKEN,
                job.id,
                job.route,
                job.adapter,
                job.contentHash,
                1,
                3,
                128,
            )
            client.failed(
                TERMINAL_TOKEN,
                job.id,
                job.route,
                job.contentHash,
                1,
                3,
                false,
                "PRINTER_OFFLINE",
                "offline",
                0,
                false,
            )

            val printing = server.takeRequest()
            assertEquals("/terminal/jobs/267/printing", printing.path)
            assertEquals(
                setOf("leaseVersion", "adapter", "contentHash", "appVersion"),
                JSONObject(printing.body.readUtf8()).keys().asSequence().toSet(),
            )
            val extend = server.takeRequest()
            assertEquals("/terminal/jobs/267/extend-lease", extend.path)
            assertEquals(
                setOf("leaseVersion", "leaseMs"),
                JSONObject(extend.body.readUtf8()).keys().asSequence().toSet(),
            )
            val succeeded = server.takeRequest()
            assertEquals("/terminal/jobs/267/succeeded", succeeded.path)
            assertEquals(
                setOf("attemptNo", "leaseVersion", "bytesWritten", "contentHash", "transport", "printerResponse"),
                JSONObject(succeeded.body.readUtf8()).keys().asSequence().toSet(),
            )
            val failed = server.takeRequest()
            assertEquals("/terminal/jobs/267/failed", failed.path)
            assertEquals(
                setOf(
                    "attemptNo",
                    "leaseVersion",
                    "bytesWritten",
                    "contentHash",
                    "transport",
                    "retryable",
                    "errorCode",
                    "errorMessage",
                    "outcome",
                    "printerResponse",
                ),
                JSONObject(failed.body.readUtf8()).keys().asSequence().toSet(),
            )
            assertFalse(listOf(printing, extend, succeeded, failed).any { it.path!!.contains("/terminal/v2/") })
            assertEquals(5, server.requestCount)
        }
    }

    @Test
    fun rc13Accepts500And750KiBCanonicalPayloadResponses() {
        for (payloadBytes in listOf(500 * 1024, 750 * 1024)) {
            MockWebServer().use { server ->
                val payload = ByteArray(payloadBytes) { index -> (index % 251).toByte() }
                server.enqueue(okData(JSONObject().put("job", canonicalUsbJob(payload))))
                val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

                val job = requireNotNull(client.activeJob(TERMINAL_TOKEN))

                assertEquals(payloadBytes, job.renderedPayload?.size)
                assertEquals(payloadBytes, job.renderedPayloadByteLength)
                assertEquals(1, server.requestCount)
            }
        }
    }

    @Test
    fun rc13Rejects1And2MiBCanonicalPayloadResponsesAtTheGlobalResponseLimit() {
        for (payloadBytes in listOf(1 * 1024 * 1024, 2 * 1024 * 1024)) {
            MockWebServer().use { server ->
                val payload = ByteArray(payloadBytes) { index -> (index % 251).toByte() }
                server.enqueue(okData(JSONObject().put("job", canonicalUsbJob(payload))))
                val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

                val error = runCatching { client.activeJob(TERMINAL_TOKEN) }.exceptionOrNull()

                assertTrue(error is V2ApiException)
                assertEquals("RESPONSE_TOO_LARGE", (error as V2ApiException).errorCode)
                assertEquals(1, server.requestCount)
            }
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
            client.reportStatus(token, V2RouteIdentity(synced.printerId, synced.localBindingId, synced.bindingVersion, "LAN"), "CONNECTED", JSONObject(), null, null)

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
            server.enqueue(okData(JSONObject().put("jobId", "267").put("status", "SUCCEEDED")))
            server.enqueue(okData(JSONObject().put("jobId", "267").put("status", "FAILED")))

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
            assertEquals(5, server.requestCount)
        }
    }

    @Test
    fun binaryClaimStreamsAndVerifiesFullCapacityMatrixInPrivateTempFiles() {
        listOf(
            100 * 1024,
            500 * 1024,
            1 * 1024 * 1024,
            2 * 1024 * 1024,
            5 * 1024 * 1024,
            10 * 1024 * 1024,
        ).forEach { byteLength ->
            MockWebServer().use { server ->
                val payload = ByteArray(byteLength) { (it % 251).toByte() }
                val sha = sha256(payload)
                server.enqueue(okData(JSONObject().put("job", binaryUsbJob(payload.size, sha))))
                server.enqueue(binaryResponse(payload, sha))
                val cache = createTempDirectory("yq-artifact-test-").toFile()
                try {
                    val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
                    val job = requireNotNull(client.claim(TERMINAL_TOKEN, allowAutomatic = false))

                    assertEquals("BINARY_PRINT_ARTIFACT_V1", job.payloadTransport)
                    assertEquals(null, job.renderedPayload)
                    assertEquals(payload.size, job.renderedPayloadByteLength)
                    val artifact = client.downloadArtifact(TERMINAL_TOKEN, job, cache, retryCount = 0)

                    assertEquals(cache.canonicalFile, artifact.file.parentFile?.canonicalFile)
                    assertEquals(payload.size, artifact.byteLength)
                    assertEquals(sha, artifact.sha256)
                    assertArrayEquals(payload, artifact.file.readBytes())
                    artifact.close()
                    assertFalse(artifact.file.exists())
                    assertEquals("/terminal/jobs/claim", server.takeRequest().path)
                    assertEquals("/terminal/jobs/267/artifact", server.takeRequest().path)
                } finally {
                    cache.deleteRecursively()
                }
            }
        }
    }

    @Test
    fun shaMismatchRefusesArtifactAndCleansTemporaryFile() {
        MockWebServer().use { server ->
            val expected = ByteArray(1024 * 1024) { 0x2a }
            val actual = expected.copyOf().also { it[it.lastIndex] = 0x2b }
            val sha = sha256(expected)
            server.enqueue(okData(JSONObject().put("job", binaryUsbJob(expected.size, sha))))
            server.enqueue(binaryResponse(actual, sha))
            val cache = createTempDirectory("yq-artifact-mismatch-").toFile()
            try {
                val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
                val job = requireNotNull(client.claim(TERMINAL_TOKEN, false))
                val error = runCatching {
                    client.downloadArtifact(TERMINAL_TOKEN, job, cache, retryCount = 0)
                }.exceptionOrNull() as V2ApiException

                assertEquals("PAYLOAD_SHA_MISMATCH", error.errorCode)
                assertTrue(cache.listFiles().orEmpty().isEmpty())
            } finally {
                cache.deleteRecursively()
            }
        }
    }

    @Test
    fun artifactIntegrityFailureUsesMinimalControlReportWithoutPayload() {
        MockWebServer().use { server ->
            server.enqueue(okData(JSONObject().put("jobId", "267").put("status", "FAILED")))
            val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })

            client.reportArtifactFailure(
                TERMINAL_TOKEN,
                "267",
                3,
                "PAYLOAD_SHA_MISMATCH",
            )

            val request = server.takeRequest()
            assertEquals("/terminal/jobs/267/artifact-failed", request.path)
            val body = JSONObject(request.body.readUtf8())
            assertEquals(setOf("leaseVersion", "errorCode"), body.keys().asSequence().toSet())
            assertFalse(body.has("payload"))
            assertFalse(body.has("renderedPayloadBase64"))
        }
    }

    @Test
    fun partialDownloadCanRetryWithoutChangingTheClaimOrCreatingAPrintAttempt() {
        MockWebServer().use { server ->
            val payload = ByteArray(5 * 1024 * 1024) { (it % 197).toByte() }
            val sha = sha256(payload)
            server.enqueue(okData(JSONObject().put("job", binaryUsbJob(payload.size, sha))))
            server.enqueue(
                binaryResponse(payload.copyOf(payload.size / 2), sha)
                    .setHeader("Content-Length", payload.size),
            )
            server.enqueue(
                binaryResponse(payload, sha)
                    .setHeadersDelay(100, java.util.concurrent.TimeUnit.MILLISECONDS)
                    .throttleBody(64 * 1024, 10, java.util.concurrent.TimeUnit.MILLISECONDS),
            )
            val cache = createTempDirectory("yq-artifact-retry-").toFile()
            try {
                val client = TerminalV2ApiClient(endpointResolver = { path -> server.url(path).toString() })
                val job = requireNotNull(client.claim(TERMINAL_TOKEN, false))
                val first = runCatching {
                    client.downloadArtifact(TERMINAL_TOKEN, job, cache, retryCount = 0)
                }.exceptionOrNull() as V2ApiException
                assertTrue(first.errorCode in setOf("NETWORK_IO_ERROR", "PAYLOAD_LENGTH_MISMATCH"))
                assertTrue(cache.listFiles().orEmpty().isEmpty())

                client.downloadArtifact(TERMINAL_TOKEN, job, cache, retryCount = 1).use { artifact ->
                    assertEquals(payload.size, artifact.byteLength)
                    assertEquals(sha, artifact.sha256)
                }
                assertTrue(cache.listFiles().orEmpty().isEmpty())
                assertEquals(3, server.requestCount)
            } finally {
                cache.deleteRecursively()
            }
        }
    }

    @Test
    fun slowPrivateInterfaceDownloadDoesNotStarveHeartbeat() {
        val address = siteLocalIpv4()
        assumeNotNull(address)
        val server = MockWebServer()
        server.start(InetAddress.getByName("0.0.0.0"), 0)
        val payload = ByteArray(5 * 1024 * 1024) { (it % 181).toByte() }
        val sha = sha256(payload)
        server.enqueue(okData(JSONObject().put("job", binaryUsbJob(payload.size, sha))))
        server.enqueue(
            binaryResponse(payload, sha)
                .throttleBody(64 * 1024, 125, TimeUnit.MILLISECONDS),
        )
        server.enqueue(okData(JSONObject()))
        val cache = createTempDirectory("yq-artifact-private-net-").toFile()
        val executor = Executors.newSingleThreadExecutor()
        try {
            val baseUrl = "http://${requireNotNull(address).hostAddress}:${server.port}"
            val client = TerminalV2ApiClient(endpointResolver = { path -> "$baseUrl$path" })
            val job = requireNotNull(client.claim(TERMINAL_TOKEN, false))
            val download = executor.submit<DownloadedPrintArtifact> {
                client.downloadArtifact(TERMINAL_TOKEN, job, cache, retryCount = 0)
            }

            Thread.sleep(400)
            client.heartbeat(TERMINAL_TOKEN, heartbeatSequence = 9, appliedConfigVersion = 7)

            assertFalse(download.isDone)
            download.get(20, TimeUnit.SECONDS).use { artifact ->
                assertEquals(payload.size, artifact.byteLength)
                assertEquals(sha, artifact.sha256)
            }
            assertEquals("/terminal/jobs/claim", server.takeRequest().path)
            assertEquals("/terminal/jobs/267/artifact", server.takeRequest().path)
            assertEquals("/terminal/heartbeat", server.takeRequest().path)
        } finally {
            executor.shutdownNow()
            server.shutdown()
            cache.deleteRecursively()
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

    private fun siteLocalIpv4(): Inet4Address? {
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
        while (interfaces.hasMoreElements()) {
            val addresses = interfaces.nextElement().inetAddresses
            while (addresses.hasMoreElements()) {
                val address = addresses.nextElement()
                if (address is Inet4Address && address.isSiteLocalAddress && !address.isLoopbackAddress) {
                    return address
                }
            }
        }
        return null
    }

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

    private fun usbBinding() = LocalPrinterBinding(
        merchantId = "11",
        terminalInstanceId = "terminal.instance.123",
        localBindingId = "123e4567-e89b-12d3-a456-426614174000",
        displayName = "USB test",
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
        paperWidth = PaperWidth.MM_80,
        localStatus = PhysicalStatus.CONNECTED,
        printerId = null,
        bindingVersion = 0,
        syncStatus = com.yunqiao.life.merchantterminal.model.BindingSyncStatus.PENDING_SYNC,
        deletedPending = false,
        enabled = false,
        lastConnectedAt = null,
        lastTestedAt = null,
        lastStatusReportAt = null,
    )

    private fun usbJobJson(): JSONObject {
        val snapshot = JSONObject().put("schemaVersion", 1)
        return JSONObject()
            .put("id", "267")
            .put("merchantId", "11")
            .put("printerId", "37")
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
                    .put("printerId", "37")
                    .put("localBindingId", "123e4567-e89b-12d3-a456-426614174000")
                    .put("bindingVersion", 4)
                    .put("adapter", "ANDROID_USB_ESCPOS"),
            )
    }

    private fun canonicalUsbJob(payload: ByteArray): JSONObject {
        val sha = MessageDigest.getInstance("SHA-256")
            .digest(payload)
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
        return usbJobJson()
            .put("canonicalTemplateVersion", "YQ_CANONICAL_RECEIPT_V1")
            .put("renderProtocol", "ESC_POS_RASTER_V1")
            .put("renderedPayloadBase64", Base64.getEncoder().encodeToString(payload))
            .put("renderedPayloadSha256", sha)
            .put("renderedPayloadByteLength", payload.size)
            .put("paperWidthMm", 80)
            .put("widthDots", 576)
    }

    private fun binaryUsbJob(byteLength: Int, sha: String): JSONObject = JSONObject()
        .put("id", "267")
        .put("jobId", "267")
        .put("merchantId", "11")
        .put("printerId", "37")
        .put("status", "CLAIMED")
        .put("receiptType", "ORDER_CUSTOMER")
        .put("source", "TEST")
        .put("attemptCount", 0)
        .put("leaseVersion", 1)
        .put("leaseExpiresAt", "2030-01-01T00:00:00Z")
        .put("contentHash", "a".repeat(64))
        .put("canonicalTemplateVersion", "YQ_CANONICAL_RECEIPT_V1")
        .put("renderProtocol", "ESC_POS_RASTER_V1")
        .put("payloadTransport", "BINARY_PRINT_ARTIFACT_V1")
        .put("payloadByteLength", byteLength)
        .put("payloadSha256", sha)
        .put("artifactPath", "/terminal/jobs/267/artifact")
        .put("paperWidthMm", 80)
        .put("widthDots", 576)
        .put(
            "route",
            JSONObject()
                .put("printerId", "37")
                .put("localBindingId", "123e4567-e89b-12d3-a456-426614174000")
                .put("bindingVersion", 4)
                .put("adapter", "ANDROID_USB_ESCPOS"),
        )

    private fun binaryResponse(payload: ByteArray, sha: String) = MockResponse()
        .setHeader("Content-Type", "application/octet-stream")
        .setHeader("Cache-Control", "private, no-store")
        .setHeader("X-YunQiao-Payload-SHA256", sha)
        .setHeader("X-YunQiao-Render-Protocol", "ESC_POS_RASTER_V1")
        .setBody(Buffer().write(payload))

    private fun sha256(payload: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(payload)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

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
