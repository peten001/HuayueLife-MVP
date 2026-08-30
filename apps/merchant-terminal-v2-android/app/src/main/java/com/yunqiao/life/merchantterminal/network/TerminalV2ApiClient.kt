package com.yunqiao.life.merchantterminal.network

import android.os.Build
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.security.SecretRedactor
import com.yunqiao.life.merchantterminal.runtime.StartupTrace
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.security.MessageDigest
import java.util.zip.GZIPInputStream

class TerminalV2ApiClient(
    private val endpointResolver: (String) -> String = ::productionEndpoint,
    private val connectionFactory: (URL) -> HttpURLConnection = { url ->
        url.openConnection() as HttpURLConnection
    },
) {
    fun merchantIdFromMerchantJwt(merchantJwt: String): String = merchantJwt.merchantIdClaim()

    fun bootstrap(
        merchantJwt: String,
        terminalInstanceId: String,
        terminalSecret: String,
        deviceModel: String,
    ): V2BootstrapResponse {
        val data = request(
            method = "POST",
            path = "/merchant/printing/connector/lan-terminal/bootstrap",
            bearer = merchantJwt,
            authorizationScheme = "Bearer",
            body = JSONObject()
                .put("terminalInstanceId", terminalInstanceId)
                .put("terminalSecret", terminalSecret)
                .put("terminalName", "YunQiao Cashier")
                .put("deviceModel", deviceModel.take(80))
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("appVersionCode", BuildConfig.VERSION_CODE)
        )
        return V2BootstrapResponse(
            merchantId = merchantIdFromMerchantJwt(merchantJwt),
            terminalId = data.requiredNumericString("terminalId"),
            terminalBearer = "yt1.${data.requiredNumericString("terminalId")}.$terminalSecret",
            tokenVersion = data.requiredPositiveLong("tokenVersion"),
            tokenExpiresAt = data.requiredInstant("tokenExpiresAt"),
        ).also {
            require(data.requiredString("authorizationScheme", 16) == "Terminal")
        }
    }

    fun heartbeat(
        terminalBearer: String,
        heartbeatSequence: Long,
        appliedConfigVersion: Long,
        activeJobIds: List<String> = emptyList(),
    ) {
        request(
            method = "POST",
            path = "/terminal/heartbeat",
            bearer = terminalBearer,
            body = JSONObject()
                .put("heartbeatSeq", heartbeatSequence.coerceAtLeast(0))
                .put("appliedConfigVersion", appliedConfigVersion.coerceAtLeast(0))
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("buildRevision", BuildConfig.BUILD_REVISION.take(64))
                .put(
                    "capabilities",
                    JSONObject()
                        .put("platform", "ANDROID")
                        .put("SERVER_ESC_POS_PAYLOAD_V1", true)
                        .put("RAW_PAYLOAD_PASSTHROUGH", true)
                        .put("BINARY_PRINT_ARTIFACT_V1", true)
                        .put("androidApiLevel", Build.VERSION.SDK_INT)
                        .put(
                            "channels",
                            JSONArray(
                                listOf(
                                    "LOCAL_USB_ESCPOS",
                                    "LOCAL_LAN_ESCPOS",
                                    "LOCAL_BLUETOOTH_ESCPOS",
                                ),
                            ),
                        ),
                )
                .put("activeJobIds", JSONArray(activeJobIds.take(20))),
        )
    }

    fun config(terminalBearer: String): V2TerminalConfig {
        val data = request("GET", "/terminal/config", terminalBearer)
        val terminal = data.requiredObject("terminal")
        val boundPrinter = data.optJSONObject("boundPrinter")
        val printers = boundPrinter?.let(::parseUsbRemotePrinter)?.let(::listOf).orEmpty()
        val archivedBindings = data.optJSONArray("archivedBindings")?.let { values ->
            buildList {
                repeat(values.length()) { index ->
                    add(parseArchivedUsbBinding(values.getJSONObject(index)))
                }
            }
        }.orEmpty()
        return V2TerminalConfig(
            merchantId = "0", // Replaced by the locally validated terminal credential in the service.
            terminalId = terminal.requiredNumericString("id"),
            merchantPrintingEnabled = data.getBoolean("merchantPrintingEnabled"),
            terminalEnabled = data.getBoolean("terminalEnabled"),
            executionEnabled = data.getBoolean("executionEnabled"),
            automaticCreationEnabled = data.getBoolean("automaticCreationEnabled"),
            heartbeatSeconds = data.requiredLongIn("heartbeatIntervalSeconds", 5L..300L),
            pollIntervalSeconds = data.requiredLongIn("pollIntervalSeconds", 2L..120L),
            configVersion = terminal.requiredNonNegativeLong("configVersion"),
            printers = printers,
            archivedBindings = archivedBindings,
        )
    }

    fun lanConfig(terminalBearer: String): V2LanConfig {
        val data = request("GET", "/terminal/lan/config", terminalBearer)
        val bindings = data.optJSONArray("bindings")?.let { values ->
            buildList {
                repeat(values.length()) { index ->
                    add(parseLanRemoteBinding(values.getJSONObject(index)))
                }
            }
        }.orEmpty()
        val archivedBindings = data.optJSONArray("archivedBindings")?.let { values ->
            buildList {
                repeat(values.length()) { index ->
                    add(parseArchivedLanBinding(values.getJSONObject(index)))
                }
            }
        }.orEmpty()
        return V2LanConfig(
            terminalEnabled = data.getBoolean("terminalEnabled"),
            lanPrintingEnabled = data.getBoolean("lanPrintingEnabled"),
            bindings = bindings,
            archivedBindings = archivedBindings,
        )
    }

    fun syncBinding(
        terminalBearer: String,
        binding: LocalPrinterBinding,
    ): V2BindingSyncResponse {
        if (binding.transport == com.yunqiao.life.merchantterminal.model.PrinterTransport.LAN) {
            return syncLanBinding(terminalBearer, binding)
        }
        val usb = binding.transportConfig as LocalTransportConfig.Usb
        val data = request(
            "POST",
            "/terminal/usb/bindings/sync",
            terminalBearer,
            JSONObject()
                .put("localBindingId", binding.localBindingId)
                .put("vendorId", usb.vendorId)
                .put("productId", usb.productId)
                .put("name", binding.displayName.take(80))
                .put("paperWidth", binding.paperWidth.apiValue())
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("appVersionCode", BuildConfig.VERSION_CODE)
                .put("status", binding.localStatus.name)
                .put("capabilities", JSONObject()),
        )
        check(data.requiredNumericString("merchantId") == binding.merchantId)
        check(data.requiredString("localBindingId", 128) == binding.localBindingId)
        return V2BindingSyncResponse(
            merchantId = data.requiredNumericString("merchantId"),
            terminalId = data.requiredNumericString("terminalId"),
            printerId = data.requiredNumericString("printerId"),
            localBindingId = data.requiredString("localBindingId", 128),
            bindingVersion = data.requiredPositiveLong("bindingVersion"),
            channelType = data.requiredString("channelType", 48),
            status = data.requiredString("status", 32),
            enabled = data.getBoolean("enabled"),
            reportedAt = data.requiredInstant("reportedAt"),
        )
    }

    fun archiveBinding(terminalBearer: String, route: V2RouteIdentity) {
        val data = request(
            "POST",
            "/terminal/v2/bindings/archive",
            terminalBearer,
            route.json(),
        )
        check(data.optBoolean("archived", false))
        check(data.requiredNumericString("printerId") == route.printerId)
        check(data.requiredString("localBindingId", 128) == route.localBindingId)
    }

    fun reportStatus(
        terminalBearer: String,
        route: V2RouteIdentity,
        status: String,
        capabilities: JSONObject,
        lastErrorCode: String?,
        lastErrorMessage: String?,
    ) {
        if (route.transport == "LAN") {
            reportLanStatus(terminalBearer, route, status, capabilities, lastErrorMessage)
            return
        }
        request(
            "POST",
            "/terminal/printers/status",
            terminalBearer,
            JSONObject()
                .put("printerId", route.printerId)
                .put("status", status)
                .put("capabilities", capabilities)
                .put("lastErrorCode", lastErrorCode ?: JSONObject.NULL)
                .put(
                    "lastErrorMessage",
                    SecretRedactor.safeError(lastErrorMessage) ?: JSONObject.NULL,
                ),
        )
    }

    private fun syncLanBinding(terminalBearer: String, binding: LocalPrinterBinding): V2BindingSyncResponse {
        val lan = binding.transportConfig as LocalTransportConfig.Lan
        val data = request("POST", "/terminal/lan/bindings/sync", terminalBearer, JSONObject()
            .put("localBindingId", binding.localBindingId)
            .put("displayName", binding.displayName.take(80))
            .put("host", lan.host).put("port", lan.port)
            .put("paperWidth", binding.paperWidth.apiValue())
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("appVersionCode", BuildConfig.VERSION_CODE)
            .put("expectedBindingVersion", binding.bindingVersion)
            .put("serviceRunning", true)
            .put("executionEnabled", true)
            .put("status", binding.localStatus.name)
            .put("capabilities", JSONObject()))
        return V2BindingSyncResponse(
            merchantId = binding.merchantId,
            terminalId = data.requiredNumericString("terminalId"),
            printerId = data.requiredNumericString("printerId"),
            localBindingId = data.requiredString("localBindingId", 128),
            bindingVersion = data.requiredPositiveLong("bindingVersion"),
            channelType = "LOCAL_LAN_ESCPOS",
            status = data.requiredString("status", 32),
            enabled = data.getBoolean("enabled"),
            reportedAt = data.requiredInstant("reportedAt"),
        ).also {
            StartupTrace.event("LAN_BINDING_SYNC_SUCCESS printerId=${it.printerId} localBindingId=${it.localBindingId} bindingVersion=${it.bindingVersion}")
        }
    }

    private fun reportLanStatus(terminalBearer: String, route: V2RouteIdentity, status: String, capabilities: JSONObject, lastError: String?) {
        require(status in setOf("UNKNOWN", "CONNECTED", "DISCONNECTED", "ERROR"))
        request("POST", "/terminal/lan/printers/status", terminalBearer, route.json()
            .put("status", status).put("serviceRunning", true).put("executionEnabled", true)
            .put("capabilities", capabilities)
            .apply { if (lastError != null) put("lastError", SecretRedactor.safeError(lastError)) })
        StartupTrace.event("LAN_STATUS_REPORT_SUCCESS printerId=${route.printerId} localBindingId=${route.localBindingId} bindingVersion=${route.bindingVersion}")
    }

    fun claim(
        terminalBearer: String,
        allowAutomatic: Boolean,
        leaseMs: Long = 60_000,
    ): ClaimedV2PrintJob? {
        val data = request(
            "POST",
            "/terminal/jobs/claim",
            terminalBearer,
            JSONObject()
                .put("allowAutomatic", allowAutomatic)
                .put("leaseMs", leaseMs.coerceIn(5_000, 120_000)),
        )
        val job = data.optJSONObject("job") ?: return null
        return parseJob(job, allowAutomatic, transport = "USB")
    }

    fun claimLanJob(
        terminalBearer: String,
        route: V2RouteIdentity,
        allowAutomatic: Boolean,
        leaseMs: Long = 60_000,
    ): ClaimedV2PrintJob? {
        require(route.transport == "LAN")
        val data = request(
            "POST",
            "/terminal/lan/jobs/claim",
            terminalBearer,
            route.json()
                .put("allowAutomatic", allowAutomatic)
                .put("leaseMs", leaseMs.coerceIn(5_000, 120_000)),
        )
        val job = data.optJSONObject("job") ?: return null
        return parseJob(job, allowAutomatic, transport = "LAN")
    }

    fun activeJob(terminalBearer: String): ClaimedV2PrintJob? {
        val data = request("GET", "/terminal/jobs/active", terminalBearer)
        return data.optJSONObject("job")?.let {
            parseJob(it, allowAutomatic = true, transport = "USB")
        }
    }

    fun activeLanJob(
        terminalBearer: String,
        route: V2RouteIdentity,
    ): ClaimedV2PrintJob? {
        require(route.transport == "LAN")
        val data = request(
            "GET",
            "/terminal/lan/jobs/active?${route.queryString()}",
            terminalBearer,
        )
        return data.optJSONObject("job")?.let {
            parseJob(it, allowAutomatic = true, transport = "LAN")
        }
    }

    fun markPrinting(
        terminalBearer: String,
        job: ClaimedV2PrintJob,
        leaseVersion: Long = job.leaseVersion,
    ): V2StartPrintingResponse {
        val body = if (job.route.transport == "LAN") job.route.json() else JSONObject()
        body
            .put("leaseVersion", leaseVersion)
            .put("contentHash", job.contentHash)
            .put("appVersion", BuildConfig.VERSION_NAME)
        if (job.route.transport != "LAN") body.put("adapter", job.adapter)
        val data = request(
            "POST",
            job.route.jobEndpoint(job.id, "printing"),
            terminalBearer,
            body,
        )
        val attempt = data.requiredObject("attempt")
        val returnedJob = data.requiredObject("job")
        return V2StartPrintingResponse(
            attemptNo = attempt.getInt("attemptNo").also { require(it > 0) },
            leaseVersion = returnedJob.requiredPositiveLong("leaseVersion"),
            leaseExpiresAt = returnedJob.requiredInstant("leaseExpiresAt"),
        )
    }

    fun extendLease(
        terminalBearer: String,
        jobId: String,
        route: V2RouteIdentity,
        leaseVersion: Long,
        leaseMs: Long = 60_000,
    ): V2LeaseExtension {
        val body = if (route.transport == "LAN") route.json() else JSONObject()
        body
            .put("leaseVersion", leaseVersion)
            .put("leaseMs", leaseMs.coerceIn(5_000, 120_000))
        val data = request(
            "POST",
            route.jobEndpoint(
                jobId,
                if (route.transport == "LAN") "extend" else "extend-lease",
            ),
            terminalBearer,
            body,
        )
        return V2LeaseExtension(
            leaseVersion = data.requiredPositiveLong("leaseVersion"),
            leaseExpiresAt = data.requiredInstant("leaseExpiresAt"),
        )
    }

    fun succeeded(
        terminalBearer: String,
        jobId: String,
        route: V2RouteIdentity,
        adapter: String,
        contentHash: String,
        attemptNo: Int,
        leaseVersion: Long,
        bytesWritten: Int,
        actualPayloadSha256: String? = null,
    ) {
        require(bytesWritten > 0)
        request(
            "POST",
            route.jobEndpoint(jobId, "succeeded"),
            terminalBearer,
            finishJson(route, contentHash, attemptNo, leaseVersion, bytesWritten, actualPayloadSha256)
                .put("printerResponse", "${adapter.take(80)}_WRITE_COMPLETE"),
        )
    }

    fun failed(
        terminalBearer: String,
        jobId: String,
        route: V2RouteIdentity,
        contentHash: String,
        attemptNo: Int,
        leaseVersion: Long,
        retryable: Boolean,
        errorCode: String,
        errorMessage: String,
        bytesWritten: Int,
        uncertain: Boolean,
        actualPayloadSha256: String? = null,
    ) {
        require(!uncertain || !retryable)
        require(bytesWritten == 0 || uncertain)
        request(
            "POST",
            route.jobEndpoint(jobId, "failed"),
            terminalBearer,
            finishJson(route, contentHash, attemptNo, leaseVersion, bytesWritten, actualPayloadSha256)
                .put("retryable", retryable && !uncertain)
                .put("errorCode", if (uncertain) "PRINT_OUTCOME_UNKNOWN" else errorCode.take(64))
                .put(
                    "errorMessage",
                    SecretRedactor.safeError(errorMessage) ?: "Local transport failure",
                )
                .put("outcome", if (uncertain) "UNCERTAIN" else "FAILED")
                .put(
                    "printerResponse",
                    if (uncertain) "LOCAL_WRITE_OUTCOME_UNKNOWN" else "LOCAL_WRITE_FAILED",
                ),
        )
    }

    private fun parseJob(
        job: JSONObject,
        allowAutomatic: Boolean,
        transport: String = "UNKNOWN",
    ): ClaimedV2PrintJob {
        val id = job.requiredNumericString("id")
        val payloadTransport = job.requiredString("payloadTransport", 64)
        if (payloadTransport != BINARY_PRINT_ARTIFACT_V1) {
            throw V2ApiException(200, "CLIENT_UPGRADE_REQUIRED", message = "Binary print artifact is required.")
        }
        val hash = job.requiredString("contentHash", 64).lowercase()
        require(SHA256.matches(hash))
        val route = job.requiredObject("route")
        val source = job.optString("source", "UNKNOWN").take(32)
        if (!allowAutomatic && source == "AUTOMATIC") {
            throw V2ApiException(
                200,
                "UNEXPECTED_AUTOMATIC_JOB",
                message = "Automatic job returned when disabled.",
            )
        }
        val routeIdentity = V2RouteIdentity(
            printerId = route.requiredNumericString("printerId"),
            localBindingId = route.requiredString("localBindingId", 128),
            bindingVersion = route.requiredPositiveLong("bindingVersion"),
            transport = transport,
        )
        val renderProtocol = job.requiredString("renderProtocol", 64)
        val payloadSha = job.requiredString("payloadSha256", 64).lowercase()
        return ClaimedV2PrintJob(
            id = id,
            merchantId = job.requiredNumericString("merchantId"),
            printerId = job.requiredNumericString("printerId"),
            status = job.requiredString("status", 32),
            receiptType = job.requiredString("receiptType", 32),
            source = source,
            attemptCount = job.getInt("attemptCount").also { require(it >= 0) },
            currentAttemptNo = job.optJSONObject("currentAttempt")
                ?.optInt("attemptNo", -1)
                ?.takeIf { it > 0 },
            leaseVersion = job.requiredPositiveLong("leaseVersion"),
            leaseExpiresAt = job.requiredInstant("leaseExpiresAt"),
            contentHash = hash,
            renderProtocol = renderProtocol,
            canonicalTemplateVersion = job.requiredString("canonicalTemplateVersion", 64),
            renderedPayloadSha256 = payloadSha,
            renderedPayloadByteLength = job.getInt("payloadByteLength"),
            paperWidthMm = job.optInt("paperWidthMm", -1).takeIf { it > 0 },
            widthDots = job.optInt("widthDots", -1).takeIf { it > 0 },
            route = routeIdentity,
            adapter = route.requiredString("adapter", 80),
            payloadTransport = payloadTransport,
            artifactPath = job.requiredString("artifactPath", 256).also {
                require(it == "/terminal/jobs/$id/artifact")
            },
        ).also {
            require(it.printerId == routeIdentity.printerId)
            require(it.status == "CLAIMED" || it.status == "PRINTING")
            require(it.renderProtocol == "ESC_POS_RASTER_V1")
            require(it.canonicalTemplateVersion == "YQ_CANONICAL_RECEIPT_V1")
            require(it.renderedPayloadByteLength in 1..MAX_BINARY_ARTIFACT_BYTES)
            require(it.renderedPayloadSha256.matches(SHA256))
        }
    }

    fun downloadArtifact(
        terminalBearer: String,
        job: ClaimedV2PrintJob,
        cacheDirectory: File,
        retryCount: Int,
    ): DownloadedPrintArtifact {
        require(job.payloadTransport == BINARY_PRINT_ARTIFACT_V1)
        val artifactPath = job.artifactPath
        val expectedLength = job.renderedPayloadByteLength
        val expectedSha = job.renderedPayloadSha256.lowercase()
        require(expectedLength in 1..MAX_BINARY_ARTIFACT_BYTES)
        require(SHA256.matches(expectedSha))
        require(cacheDirectory.mkdirs() || cacheDirectory.isDirectory)
        val temporary = File.createTempFile("yq-${job.id}-", ".escpos", cacheDirectory)
        val startedAt = System.currentTimeMillis()
        StartupTrace.event(
            "PRINT_ARTIFACT_DOWNLOAD_STARTED jobId=${job.id} bytes=$expectedLength retryCount=${retryCount.coerceIn(0, 20)}",
        )
        val connection = connectionFactory(URL(endpointResolver(artifactPath))).apply {
            requestMethod = "GET"
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = ARTIFACT_READ_TIMEOUT_MS
            instanceFollowRedirects = false
            useCaches = false
            setRequestProperty("Accept", "application/octet-stream")
            setRequestProperty("Accept-Encoding", "gzip")
            setRequestProperty("Authorization", "Terminal $terminalBearer")
            setRequestProperty("X-Terminal-App-Version", BuildConfig.VERSION_NAME.take(64))
            setRequestProperty("X-YunQiao-Artifact-Retry-Count", retryCount.coerceIn(0, 20).toString())
            setRequestProperty("X-YunQiao-Accept-Artifact-Encoding", GZIP_ARTIFACT_ENCODING)
        }
        try {
            val status = connection.responseCode
            if (status in 300..399) {
                throw V2ApiException(status, "REDIRECT_BLOCKED", message = "Redirect blocked.")
            }
            if (status !in 200..299) {
                throw V2ApiException(status, "HTTP_$status", message = "Artifact request failed.")
            }
            if (connection.contentType?.substringBefore(';')?.trim() != "application/octet-stream") {
                throw V2ApiException(status, "INVALID_RESPONSE", message = "Artifact response headers are invalid.")
            }
            val contentEncoding = connection.contentEncoding?.trim()?.lowercase().orEmpty()
            val gzipEncoded = contentEncoding == "gzip"
            if (contentEncoding.isNotEmpty() && !gzipEncoded) {
                throw V2ApiException(status, "INVALID_RESPONSE", message = "Artifact response encoding is unsupported.")
            }
            if (gzipEncoded) {
                if (connection.getHeaderField("X-YunQiao-Artifact-Encoding") != GZIP_ARTIFACT_ENCODING ||
                    connection.getHeaderFieldLong("X-YunQiao-Uncompressed-Length", -1L) != expectedLength.toLong() ||
                    connection.contentLengthLong !in 1L..MAX_GZIP_WIRE_BYTES
                ) {
                    throw V2ApiException(status, "INVALID_RESPONSE", message = "Compressed artifact headers are invalid.")
                }
            } else if (connection.contentLengthLong != expectedLength.toLong()) {
                throw V2ApiException(status, "PAYLOAD_LENGTH_MISMATCH", message = "Artifact Content-Length mismatch.")
            }
            val headerSha = connection.getHeaderField("X-YunQiao-Payload-SHA256")?.lowercase()
            if (headerSha != expectedSha ||
                connection.getHeaderField("X-YunQiao-Render-Protocol") != "ESC_POS_RASTER_V1"
            ) {
                throw V2ApiException(status, "PAYLOAD_SHA_MISMATCH", message = "Artifact identity header mismatch.")
            }
            val digest = MessageDigest.getInstance("SHA-256")
            var actualLength = 0L
            val artifactInput = if (gzipEncoded) {
                GZIPInputStream(connection.inputStream, 64 * 1024)
            } else {
                connection.inputStream
            }
            artifactInput.use { input ->
                FileOutputStream(temporary).buffered(64 * 1024).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        actualLength += count
                        if (actualLength > expectedLength) {
                            throw V2ApiException(status, "PAYLOAD_LENGTH_MISMATCH", message = "Artifact body exceeds declared length.")
                        }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
            if (actualLength != expectedLength.toLong()) {
                throw V2ApiException(status, "PAYLOAD_LENGTH_MISMATCH", message = "Artifact body length mismatch.")
            }
            val actualSha = digest.digest().joinToString("") { "%02x".format(it) }
            if (actualSha != expectedSha) {
                throw V2ApiException(status, "PAYLOAD_SHA_MISMATCH", message = "Artifact SHA-256 mismatch.")
            }
            StartupTrace.event(
                "PRINT_ARTIFACT_DOWNLOAD_COMPLETED jobId=${job.id} bytes=$actualLength wireBytes=${connection.contentLengthLong} encoding=${if (gzipEncoded) GZIP_ARTIFACT_ENCODING else "identity"} durationMs=${System.currentTimeMillis() - startedAt} shaStatus=MATCH retryCount=${retryCount.coerceIn(0, 20)}",
            )
            return DownloadedPrintArtifact(temporary, expectedLength, actualSha)
        } catch (error: Throwable) {
            temporary.delete()
            StartupTrace.event(
                "PRINT_ARTIFACT_DOWNLOAD_FAILED jobId=${job.id} bytes=$expectedLength durationMs=${System.currentTimeMillis() - startedAt} shaStatus=${(error as? V2ApiException)?.errorCode ?: "IO_ERROR"} retryCount=${retryCount.coerceIn(0, 20)}",
            )
            if (error is V2ApiException) throw error
            if (error is IOException) {
                throw V2ApiException(0, "NETWORK_IO_ERROR", message = error.javaClass.simpleName, cause = error)
            }
            throw error
        } finally {
            connection.disconnect()
        }
    }

    fun reportArtifactFailure(
        terminalBearer: String,
        jobId: String,
        leaseVersion: Long,
        errorCode: String,
    ) {
        require(errorCode in setOf("PAYLOAD_LENGTH_MISMATCH", "PAYLOAD_SHA_MISMATCH"))
        request(
            "POST",
            "/terminal/jobs/${jobId.safePathSegment()}/artifact-failed",
            terminalBearer,
            JSONObject()
                .put("leaseVersion", leaseVersion)
                .put("errorCode", errorCode),
        )
    }

    private fun finishJson(
        route: V2RouteIdentity,
        contentHash: String,
        attemptNo: Int,
        leaseVersion: Long,
        bytesWritten: Int,
        actualPayloadSha256: String?,
    ): JSONObject {
        val body = if (route.transport == "LAN") route.json() else JSONObject()
        return body
            .put("attemptNo", attemptNo)
            .put("leaseVersion", leaseVersion)
            .put("bytesWritten", bytesWritten.coerceAtLeast(0))
            .put("contentHash", contentHash)
            .put(
                "transport",
                if (route.transport == "LAN") "ANDROID_LAN_ESCPOS" else "ANDROID_USB_ESCPOS",
            )
            .apply { if (actualPayloadSha256 != null) put("actualPayloadSha256", actualPayloadSha256) }
    }

    private fun parseUsbRemotePrinter(printer: JSONObject): V2RemotePrinter? {
        if (printer.optString("channelType") != "LOCAL_USB_ESCPOS") return null
        val capabilities = printer.optJSONObject("capabilities") ?: return null
        val binding = capabilities.optJSONObject("usbBinding") ?: return null
        return V2RemotePrinter(
            printerId = printer.requiredNumericString("id"),
            displayName = printer.requiredString("name", 160),
            channelType = "LOCAL_USB_ESCPOS",
            paperWidth = printer.requiredString("paperWidth", 16),
            enabled = printer.getBoolean("enabled"),
            status = printer.requiredString("status", 32),
            localBindingId = binding.requiredString("localBindingId", 128),
            bindingVersion = binding.requiredPositiveLong("bindingVersion"),
            transport = "USB",
        )
    }

    private fun parseLanRemoteBinding(binding: JSONObject): V2LanRemoteBinding =
        V2LanRemoteBinding(
            printerId = binding.requiredNumericString("printerId"),
            localBindingId = binding.requiredString("localBindingId", 128),
            bindingVersion = binding.requiredPositiveLong("bindingVersion"),
            enabled = binding.getBoolean("enabled"),
        )

    private fun parseArchivedLanBinding(binding: JSONObject): V2ArchivedLanBinding =
        V2ArchivedLanBinding(
            printerId = binding.requiredNumericString("printerId"),
            localBindingId = binding.requiredString("localBindingId", 128),
            bindingVersion = binding.requiredPositiveLong("bindingVersion"),
            archivedAt = binding.requiredInstant("archivedAt"),
        )

    private fun parseArchivedUsbBinding(binding: JSONObject): V2ArchivedUsbBinding =
        V2ArchivedUsbBinding(
            transport = binding.requiredString("transport", 16).also {
                require(it == "USB")
            },
            printerId = binding.requiredNumericString("printerId"),
            localBindingId = binding.requiredString("localBindingId", 128),
            bindingVersion = binding.requiredPositiveLong("bindingVersion"),
            archivedAt = binding.requiredInstant("archivedAt"),
        )

    private fun request(
        method: String,
        path: String,
        bearer: String,
        body: JSONObject? = null,
        authorizationScheme: String = "Terminal",
    ): JSONObject {
        require(bearer.length in 24..4_096 && bearer.none(Char::isWhitespace))
        val connection = connectionFactory(URL(endpointResolver(path))).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = false
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "$authorizationScheme $bearer")
            setRequestProperty("X-Terminal-App-Version", BuildConfig.VERSION_NAME.take(64))
            if (body != null) doOutput = true
        }
        try {
            if (body != null) {
                connection.outputStream.use {
                    it.write(body.toString().toByteArray(Charsets.UTF_8))
                }
            }
            val status = connection.responseCode
            if (status in 300..399) {
                StartupTrace.api(path, status, "REDIRECT_BLOCKED", connection.getHeaderField("X-Request-Id"), authorizationScheme)
                throw V2ApiException(status, "REDIRECT_BLOCKED", message = "Redirect blocked.")
            }
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)
                ?.use(::readLimited)
                .orEmpty()
            val response = runCatching { JSONObject(text) }.getOrNull()
            StartupTrace.api(
                endpoint = path,
                status = status,
                code = response?.optString("code")?.takeIf(String::isNotBlank),
                requestId = connection.getHeaderField("X-Request-Id") ?: connection.getHeaderField("X-Request-ID"),
                authenticationScheme = authorizationScheme,
            )
            if (status !in 200..299) {
                throw V2ApiException(
                    statusCode = status,
                    errorCode = response?.optString("code")?.takeIf(String::isNotBlank)
                        ?.take(80) ?: "HTTP_$status",
                    currentBindingVersion = response?.optLong(
                        "currentBindingVersion",
                        -1,
                    )?.takeIf { it >= 0 },
                    currentPrinterId = response?.optString("printerId")
                        ?.takeIf { Regex("^[1-9][0-9]{0,18}$").matches(it) },
                    message = SecretRedactor.safeError(response?.optString("message"))
                        ?: "V2 connector request failed.",
                )
            }
            if (response == null || response.optString("code") != "OK") {
                throw V2ApiException(
                    status,
                    response?.optString("code") ?: "INVALID_RESPONSE",
                    message = "V2 connector response envelope is invalid.",
                )
            }
            return response.optJSONObject("data") ?: JSONObject()
        } catch (error: V2ApiException) {
            throw error
        } catch (error: IOException) {
            StartupTrace.api(path, 0, "NETWORK_IO_ERROR", null, authorizationScheme)
            throw V2ApiException(
                0,
                "NETWORK_IO_ERROR",
                message = error.javaClass.simpleName,
                cause = error,
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun readLimited(reader: java.io.BufferedReader): String {
        val output = StringBuilder()
        val buffer = CharArray(2_048)
        while (true) {
            val count = reader.read(buffer)
            if (count < 0) break
            if (output.length + count > MAX_RESPONSE_CHARS) {
                throw V2ApiException(0, "RESPONSE_TOO_LARGE", message = "Response is too large.")
            }
            output.append(buffer, 0, count)
        }
        return output.toString()
    }

    private fun V2RouteIdentity.json() = JSONObject()
        .put("printerId", printerId)
        .put("localBindingId", localBindingId)
        .put("bindingVersion", bindingVersion)

    private fun V2RouteIdentity.queryString(): String = listOf(
        "printerId" to printerId,
        "localBindingId" to localBindingId,
        "bindingVersion" to bindingVersion.toString(),
    ).joinToString("&") { (key, value) ->
        "$key=${URLEncoder.encode(value, StandardCharsets.UTF_8.name())}"
    }

    private fun V2RouteIdentity.jobEndpoint(jobId: String, action: String): String {
        require(action in setOf("printing", "extend", "extend-lease", "succeeded", "failed"))
        return if (transport == "LAN") {
            "/terminal/lan/jobs/${jobId.safePathSegment()}/$action"
        } else {
            "/terminal/jobs/${jobId.safePathSegment()}/$action"
        }
    }

    private fun PaperWidth.apiValue(): String = when (this) {
        PaperWidth.MM_58 -> "MM58"
        PaperWidth.MM_80 -> "MM80"
        PaperWidth.CUSTOM -> error("V2 does not synchronize custom paper widths.")
    }

    private fun String.safePathSegment(): String {
        require(NUMERIC_ID.matches(this))
        return this
    }

    companion object {
        private val NUMERIC_ID = Regex("^[1-9][0-9]{0,18}$")
        private val SHA256 = Regex("^[0-9a-f]{64}$")
        private const val CONNECT_TIMEOUT_MS = 8_000
        private const val READ_TIMEOUT_MS = 20_000
        private const val ARTIFACT_READ_TIMEOUT_MS = 60_000
        private const val MAX_RESPONSE_CHARS = 1_048_576
        private const val MAX_BINARY_ARTIFACT_BYTES = 20 * 1024 * 1024
        private const val MAX_GZIP_WIRE_BYTES = MAX_BINARY_ARTIFACT_BYTES + 64 * 1024L
        private const val GZIP_ARTIFACT_ENCODING = "gzip-v1"
        private const val BINARY_PRINT_ARTIFACT_V1 = "BINARY_PRINT_ARTIFACT_V1"

        private fun productionEndpoint(path: String): String {
            require(path.startsWith("/") && !path.contains(".."))
            val base = BuildConfig.CONNECTOR_API_BASE_URL.trimEnd('/')
            require(base.startsWith("https://"))
            return base + path
        }
    }
}

data class DownloadedPrintArtifact(
    val file: File,
    val byteLength: Int,
    val sha256: String,
) : AutoCloseable {
    override fun close() {
        file.delete()
    }
}

private fun JSONObject.requiredObject(key: String): JSONObject = optJSONObject(key)
    ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Missing object: $key")

private fun JSONObject.requiredString(key: String, maxLength: Int): String =
    optString(key).takeIf { it.isNotBlank() && it.length <= maxLength }
        ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Invalid field: $key")

private fun JSONObject.requiredSecret(key: String): String =
    requiredString(key, 4_096).takeIf { it.length >= 24 && it.none(Char::isWhitespace) }
        ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Invalid credential field.")

private fun JSONObject.requiredNumericString(key: String): String =
    requiredString(key, 20).takeIf { Regex("^[1-9][0-9]{0,18}$").matches(it) }
        ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Invalid identity field.")

private fun JSONObject.requiredPositiveLong(key: String): Long =
    optLong(key, -1).takeIf { it > 0 }
        ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Invalid positive field: $key")

private fun JSONObject.requiredNonNegativeLong(key: String): Long =
    optLong(key, -1).takeIf { it >= 0 }
        ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Invalid field: $key")

private fun JSONObject.requiredLongIn(key: String, range: LongRange): Long =
    optLong(key, Long.MIN_VALUE).takeIf { it in range }
        ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Invalid bounded field: $key")

private fun JSONObject.requiredInstant(key: String): Long =
    optString(key).takeIf(String::isNotBlank)?.let {
        runCatching { Instant.parse(it).toEpochMilli() }.getOrNull()
    } ?: throw V2ApiException(200, "INVALID_RESPONSE", message = "Invalid timestamp: $key")

private fun String.merchantIdClaim(): String {
    val payload = split('.').getOrNull(1)
        ?.let { java.util.Base64.getUrlDecoder().decode(it) }
        ?.toString(Charsets.UTF_8)
        ?.let { runCatching { JSONObject(it) }.getOrNull() }
        ?: throw V2ApiException(200, "INVALID_MERCHANT_SESSION", message = "Merchant identity is missing.")
    return payload.requiredNumericString("merchantId")
}
