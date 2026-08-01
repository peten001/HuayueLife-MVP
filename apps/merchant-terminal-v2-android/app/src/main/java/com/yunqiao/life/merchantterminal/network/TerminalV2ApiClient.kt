package com.yunqiao.life.merchantterminal.network

import android.os.Build
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.security.CanonicalReceiptHash
import com.yunqiao.life.merchantterminal.security.SecretRedactor
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

class TerminalV2ApiClient(
    private val endpointResolver: (String) -> String = ::productionEndpoint,
    private val connectionFactory: (URL) -> HttpURLConnection = { url ->
        url.openConnection() as HttpURLConnection
    },
) {
    fun bootstrap(
        merchantJwt: String,
        terminalInstanceId: String,
        terminalSecret: String,
        deviceModel: String,
    ): V2BootstrapResponse {
        val data = request(
            method = "POST",
            path = "/merchant/printing/connector/v2/bootstrap",
            bearer = merchantJwt,
            body = JSONObject()
                .put("terminalInstanceId", terminalInstanceId)
                .put("terminalSecret", terminalSecret)
                .put("terminalName", "YunQiao Merchant Terminal")
                .put("deviceModel", deviceModel.take(80))
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("appVersionCode", BuildConfig.VERSION_CODE)
                .put(
                    "capabilities",
                    JSONObject()
                        .put("usb", true)
                        .put("lan", true)
                        .put("bluetoothClassic", true),
                ),
        )
        return V2BootstrapResponse(
            merchantId = data.requiredNumericString("merchantId"),
            terminalId = data.requiredNumericString("terminalId"),
            authorizationScheme = data.requiredString("authorizationScheme", 16)
                .also { require(it == "Bearer") },
            token = data.requiredSecret("token"),
            tokenVersion = data.requiredPositiveLong("tokenVersion"),
            tokenExpiresAt = data.requiredInstant("tokenExpiresAt"),
            heartbeatSeconds = data.requiredLongIn("heartbeatSeconds", 5L..300L),
            pollIntervalSeconds = data.requiredLongIn("pollIntervalSeconds", 2L..120L),
            configVersion = data.requiredNonNegativeLong("configVersion"),
        )
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
        val data = request("GET", "/terminal/v2/config", terminalBearer)
        val printersJson = data.optJSONArray("printers") ?: JSONArray()
        val printers = (0 until printersJson.length()).map { index ->
            val value = printersJson.getJSONObject(index)
            val binding = value.requiredObject("binding")
            V2RemotePrinter(
                printerId = value.requiredNumericString("id"),
                displayName = value.requiredString("name", 160),
                channelType = value.requiredString("channelType", 48),
                paperWidth = value.requiredString("paperWidth", 16),
                enabled = value.getBoolean("enabled"),
                status = value.requiredString("status", 32),
                localBindingId = binding.requiredString("localBindingId", 128),
                bindingVersion = binding.requiredPositiveLong("bindingVersion"),
                transport = binding.requiredString("transport", 16),
            )
        }
        return V2TerminalConfig(
            merchantId = data.requiredNumericString("merchantId"),
            terminalId = data.requiredNumericString("terminalId"),
            merchantPrintingEnabled = data.getBoolean("merchantPrintingEnabled"),
            terminalEnabled = data.getBoolean("terminalEnabled"),
            executionEnabled = data.getBoolean("executionEnabled"),
            automaticCreationEnabled = data.getBoolean("automaticCreationEnabled"),
            heartbeatSeconds = data.requiredLongIn("heartbeatSeconds", 5L..300L),
            pollIntervalSeconds = data.requiredLongIn("pollIntervalSeconds", 2L..120L),
            configVersion = data.requiredNonNegativeLong("configVersion"),
            printers = printers,
        )
    }

    fun syncBinding(
        terminalBearer: String,
        binding: LocalPrinterBinding,
    ): V2BindingSyncResponse {
        val data = request(
            "POST",
            "/terminal/v2/bindings/sync",
            terminalBearer,
            JSONObject()
                .put("localBindingId", binding.localBindingId)
                .put("expectedBindingVersion", binding.bindingVersion)
                .put("transport", binding.transport.name)
                .put("displayName", binding.displayName.take(80))
                .put("paperWidth", binding.paperWidth.apiValue())
                .put("transportConfig", binding.transportConfig.apiJson())
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
        source: String,
        capabilities: JSONObject,
        lastErrorCode: String?,
        lastErrorMessage: String?,
    ) {
        request(
            "POST",
            "/terminal/v2/printers/status",
            terminalBearer,
            route.json()
                .put("status", status)
                .put("source", source)
                .put("capabilities", capabilities)
                .put("lastErrorCode", lastErrorCode ?: JSONObject.NULL)
                .put(
                    "lastErrorMessage",
                    SecretRedactor.safeError(lastErrorMessage) ?: JSONObject.NULL,
                ),
        )
    }

    fun claim(
        terminalBearer: String,
        allowAutomatic: Boolean,
        routes: List<V2RouteIdentity>,
        leaseMs: Long = 60_000,
    ): ClaimedV2PrintJob? {
        require(routes.isNotEmpty() && routes.size <= 50)
        val data = request(
            "POST",
            "/terminal/v2/jobs/claim",
            terminalBearer,
            JSONObject()
                .put("allowAutomatic", allowAutomatic)
                .put("leaseMs", leaseMs.coerceIn(5_000, 120_000))
                .put("routes", JSONArray(routes.map { it.json() })),
        )
        val job = data.optJSONObject("job") ?: return null
        return parseJob(job, allowAutomatic)
    }

    fun activeJob(terminalBearer: String): ClaimedV2PrintJob? {
        val data = request("GET", "/terminal/v2/jobs/active", terminalBearer)
        return data.optJSONObject("job")?.let { parseJob(it, allowAutomatic = true) }
    }

    fun markPrinting(
        terminalBearer: String,
        job: ClaimedV2PrintJob,
        leaseVersion: Long = job.leaseVersion,
    ): V2StartPrintingResponse {
        val data = request(
            "POST",
            "/terminal/v2/jobs/${job.id.safePathSegment()}/printing",
            terminalBearer,
            job.route.json()
                .put("leaseVersion", leaseVersion)
                .put("contentHash", job.contentHash)
                .put("appVersion", BuildConfig.VERSION_NAME),
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
        val data = request(
            "POST",
            "/terminal/v2/jobs/${jobId.safePathSegment()}/extend-lease",
            terminalBearer,
            route.json()
                .put("leaseVersion", leaseVersion)
                .put("leaseMs", leaseMs.coerceIn(5_000, 120_000)),
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
    ) {
        require(bytesWritten > 0)
        request(
            "POST",
            "/terminal/v2/jobs/${jobId.safePathSegment()}/succeeded",
            terminalBearer,
            finishJson(route, contentHash, attemptNo, leaseVersion, bytesWritten)
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
    ) {
        require(!uncertain || !retryable)
        require(bytesWritten == 0 || uncertain)
        request(
            "POST",
            "/terminal/v2/jobs/${jobId.safePathSegment()}/failed",
            terminalBearer,
            finishJson(route, contentHash, attemptNo, leaseVersion, bytesWritten)
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

    private fun parseJob(job: JSONObject, allowAutomatic: Boolean): ClaimedV2PrintJob {
        val snapshot = job.requiredObject("receiptSnapshot")
        val hash = job.requiredString("contentHash", 64).lowercase()
        require(SHA256.matches(hash))
        if (!CanonicalReceiptHash.matches(snapshot, hash)) {
            throw V2ApiException(
                200,
                "CONTENT_HASH_MISMATCH",
                message = "Authenticated receipt content hash mismatch.",
            )
        }
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
        )
        return ClaimedV2PrintJob(
            id = job.requiredNumericString("id"),
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
            snapshotSchemaVersion = job.getInt("snapshotSchemaVersion"),
            receiptSnapshotJson = snapshot.toString(),
            route = routeIdentity,
            adapter = route.requiredString("adapter", 80),
        ).also {
            require(it.printerId == routeIdentity.printerId)
            require(it.status == "CLAIMED" || it.status == "PRINTING")
            require(it.snapshotSchemaVersion == 1)
        }
    }

    private fun finishJson(
        route: V2RouteIdentity,
        contentHash: String,
        attemptNo: Int,
        leaseVersion: Long,
        bytesWritten: Int,
    ) = route.json()
        .put("attemptNo", attemptNo)
        .put("leaseVersion", leaseVersion)
        .put("bytesWritten", bytesWritten.coerceAtLeast(0))
        .put("contentHash", contentHash)

    private fun request(
        method: String,
        path: String,
        bearer: String,
        body: JSONObject? = null,
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
            setRequestProperty("Authorization", "Bearer $bearer")
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
                throw V2ApiException(status, "REDIRECT_BLOCKED", message = "Redirect blocked.")
            }
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)
                ?.use(::readLimited)
                .orEmpty()
            val response = runCatching { JSONObject(text) }.getOrNull()
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

    private fun LocalTransportConfig.apiJson(): JSONObject = when (this) {
        is LocalTransportConfig.Usb -> JSONObject()
            .put("vendorId", vendorId)
            .put("productId", productId)
            .put("deviceName", deviceName ?: JSONObject.NULL)
            .put("interfaceClass", interfaceClass ?: JSONObject.NULL)
            .put("endpointAddress", endpointAddress)
        is LocalTransportConfig.Lan -> JSONObject().put("host", host).put("port", port)
        is LocalTransportConfig.Bluetooth -> JSONObject()
            .put("macAddress", macAddress.uppercase())
            .put("deviceName", deviceName ?: JSONObject.NULL)
            .put("serviceUuid", serviceUuid.lowercase())
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
        private const val MAX_RESPONSE_CHARS = 1_048_576

        private fun productionEndpoint(path: String): String {
            require(path.startsWith("/") && !path.contains(".."))
            val base = BuildConfig.CONNECTOR_API_BASE_URL.trimEnd('/')
            require(base.startsWith("https://"))
            return base + path
        }
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
