package com.yunqiao.life.merchantterminal.connector

import android.os.Build
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.security.CanonicalReceiptHash
import com.yunqiao.life.merchantterminal.security.SecretRedactor
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

class ConnectorApiClient(
    private val merchantTokenProvider: () -> String?,
    private val endpointResolver: (String) -> String = ConnectorApiConfig::endpoint,
    private val connectionFactory: (URL) -> HttpURLConnection = { url ->
        url.openConnection() as HttpURLConnection
    },
) {
    fun config(): ConnectorRemoteConfig {
        val data = request("GET", "/merchant/printing/connector/config")
        val printer = data.optJSONObject("boundPrinter")
        val resetUsb = data.optJSONObject("commands")?.optJSONObject("resetUsb")
        val printerChannelType = printer?.optString("channelType")?.takeIf(String::isNotBlank)
            ?.take(40)
        val pollSeconds = data.optLong("pollIntervalSeconds", 7).coerceIn(5, 30)
        val heartbeatSeconds = data.optLong(
            "configRefreshIntervalSeconds",
            data.optLong("heartbeatIntervalSeconds", pollSeconds),
        ).coerceIn(5, 60)
        return ConnectorRemoteConfig(
            merchantPrintingEnabled = data.optBoolean("merchantPrintingEnabled", false),
            executionEnabled = data.optBoolean("executionEnabled", false),
            taskCenterEnabled = data.optBoolean("taskCenterEnabled", false),
            automaticPrintingEnabled = data.optBoolean(
                "automaticCreationEnabled",
                data.optBoolean("automaticPrintingEnabled", false),
            ),
            pollIntervalMs = pollSeconds * 1_000,
            heartbeatIntervalMs = heartbeatSeconds * 1_000,
            boundPrinterId = printer?.optString("id")?.takeIf(String::isNotBlank)?.take(128),
            boundPrinterChannelType = printerChannelType,
            boundPrinterEnabled = data.optBoolean(
                "printerEnabled",
                printer?.optBoolean("enabled", false) == true,
            ) && printerChannelType == "LOCAL_USB_ESCPOS",
            configVersion = data.optLong("configVersion", 0).coerceAtLeast(0),
            resetUsbConfigVersion = resetUsb?.optLong("configVersion", -1)?.takeIf { it >= 0 },
        )
    }

    fun claim(
        allowAutomatic: Boolean,
        printerId: String? = null,
        leaseMs: Long = 60_000,
    ): ClaimedPrintJob? {
        require(printerId == null || NUMERIC_ID.matches(printerId)) { "Printer id is invalid." }
        val data = request(
            "POST",
            "/merchant/printing/connector/jobs/claim",
            JSONObject()
                .put("allowAutomatic", allowAutomatic)
                .put("leaseMs", leaseMs.coerceIn(30_000, 120_000))
                .also { body ->
                    printerId?.let { body.put("printerId", it) }
                },
        )
        val job = data.optJSONObject("job") ?: return null
        val snapshot = job.requiredObject("receiptSnapshot")
        val contentHash = job.requiredString("contentHash", 64).lowercase()
        require(SHA256.matches(contentHash)) { "Invalid server content hash." }
        val snapshotHashMatches = runCatching {
            CanonicalReceiptHash.matches(snapshot, contentHash)
        }.getOrDefault(false)
        if (!snapshotHashMatches) {
            throw ConnectorApiException(
                200,
                "CONTENT_HASH_MISMATCH",
                "Receipt snapshot hash does not match the authenticated job payload.",
            )
        }
        val schemaVersion = job.optInt("snapshotSchemaVersion", snapshot.optInt("schemaVersion", -1))
        require(schemaVersion == 1) { "Unsupported receipt snapshot schema." }
        val source = job.optString("source", "UNKNOWN").take(32)
        if (!allowAutomatic && source == "AUTOMATIC") {
            throw ConnectorApiException(
                200,
                "UNEXPECTED_AUTOMATIC_JOB",
                "Server returned an automatic job while automatic claiming was disabled.",
            )
        }
        return ClaimedPrintJob(
            id = job.requiredString("id", 128),
            printerId = job.requiredString("printerId", 128),
            receiptType = job.requiredString("receiptType", 32),
            source = source,
            leaseVersion = job.requiredPositiveLong("leaseVersion"),
            leaseExpiresAt = job.requiredInstantMillis("leaseExpiresAt"),
            contentHash = contentHash,
            snapshotSchemaVersion = schemaVersion,
            receiptSnapshotJson = snapshot.toString(),
        )
    }

    fun startPrinting(
        job: ClaimedPrintJob,
        networkInfo: String,
    ): StartPrintingResult {
        val data = request(
            "POST",
            "/merchant/printing/connector/jobs/${job.id.safePathSegment()}/printing",
            JSONObject()
                .put("leaseVersion", job.leaseVersion)
                .put("adapter", "ANDROID_USB_ESCPOS")
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("contentHash", job.contentHash)
                .put("networkInfo", JSONObject().put("state", networkInfo.take(120))),
        )
        val attempt = data.optJSONObject("attempt") ?: data
        val responseJob = data.optJSONObject("job") ?: data
        return StartPrintingResult(
            attemptNo = attempt.optInt("attemptNo", 1).coerceAtLeast(1),
            leaseVersion = responseJob.optLong("leaseVersion", job.leaseVersion),
            leaseExpiresAt = responseJob.optString("leaseExpiresAt")
                .takeIf(String::isNotBlank)
                ?.let(::parseInstant)
                ?: job.leaseExpiresAt,
        )
    }

    fun extendLease(
        jobId: String,
        leaseVersion: Long,
        leaseMs: Long = 60_000,
    ): LeaseExtensionResult {
        val data = request(
            "POST",
            "/merchant/printing/connector/jobs/${jobId.safePathSegment()}/extend-lease",
            JSONObject()
                .put("leaseVersion", leaseVersion)
                .put("leaseMs", leaseMs.coerceIn(30_000, 120_000)),
        )
        return LeaseExtensionResult(
            leaseVersion = data.requiredPositiveLong("leaseVersion"),
            leaseExpiresAt = data.requiredInstantMillis("leaseExpiresAt"),
        )
    }

    fun succeeded(
        jobId: String,
        attemptNo: Int,
        leaseVersion: Long,
        bytesWritten: Int,
        contentHash: String,
    ) {
        request(
            "POST",
            "/merchant/printing/connector/jobs/${jobId.safePathSegment()}/succeeded",
            JSONObject()
                .put("attemptNo", attemptNo)
                .put("leaseVersion", leaseVersion)
                .put("bytesWritten", bytesWritten.coerceAtLeast(0))
                .put("contentHash", contentHash)
                .put("printerResponse", "USB_BULK_WRITE_COMPLETE"),
        )
    }

    fun failed(
        jobId: String,
        attemptNo: Int,
        leaseVersion: Long,
        retryable: Boolean,
        errorCode: String,
        errorMessage: String?,
        bytesWritten: Int,
        uncertain: Boolean,
        contentHash: String,
    ) {
        request(
            "POST",
            "/merchant/printing/connector/jobs/${jobId.safePathSegment()}/failed",
            JSONObject()
                .put("attemptNo", attemptNo)
                .put("leaseVersion", leaseVersion)
                .put("retryable", retryable && !uncertain)
                .put("errorCode", if (uncertain) "PRINT_OUTCOME_UNKNOWN" else errorCode.take(80))
                .put("errorMessage", SecretRedactor.safeError(errorMessage).orEmpty())
                .put("bytesWritten", bytesWritten.coerceAtLeast(0))
                .put("contentHash", contentHash)
                .put("outcome", if (uncertain) "UNCERTAIN" else "FAILED")
                .put("printerResponse", if (uncertain) "USB_WRITE_OUTCOME_UNKNOWN" else "USB_WRITE_FAILED"),
        )
    }

    fun reportPrinterStatus(
        printerId: String,
        status: String,
        lastErrorCode: String?,
        lastErrorMessage: String?,
    ) {
        request(
            "POST",
            "/merchant/printing/connector/printers/status",
            JSONObject()
                .put("printerId", printerId)
                .put("status", status.take(32))
                .put(
                    "capabilities",
                    baseCapabilities()
                        .put("connectorState", status.take(32))
                        .put("connectionEvidence", "USB_CONFIG_READY_ONLY")
                        .put("printerHealthVerified", false)
                        .put("paperOutputVerified", false),
                )
                .put("lastErrorCode", lastErrorCode?.take(80) ?: JSONObject.NULL)
                .put("lastErrorMessage", SecretRedactor.safeError(lastErrorMessage) ?: JSONObject.NULL),
        )
    }

    private fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        authenticated: Boolean = true,
    ): JSONObject {
        val endpoint = endpointResolver(path)
        val connection = connectionFactory(URL(endpoint)).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = false
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("X-Terminal-App-Version", BuildConfig.VERSION_NAME.take(80))
            if (authenticated) {
                val token = merchantTokenProvider()
                    ?: throw ConnectorApiException(401, "MERCHANT_SESSION_MISSING", "Merchant session is not available.")
                setRequestProperty("Authorization", "Bearer $token")
            }
            if (body != null) doOutput = true
        }
        try {
            if (body != null) {
                connection.outputStream.use { stream ->
                    stream.write(body.toString().toByteArray(Charsets.UTF_8))
                }
            }
            val status = connection.responseCode
            if (status in 300..399) {
                throw ConnectorApiException(status, "REDIRECT_BLOCKED", "Connector API redirect was blocked.")
            }
            val responseText = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)
                ?.use(::readLimited)
                .orEmpty()
            val response = runCatching { JSONObject(responseText) }.getOrNull()
            if (status !in 200..299) {
                val code = response?.optString("code")?.takeIf(String::isNotBlank) ?: "HTTP_$status"
                val message = response?.opt("message")?.toString() ?: "Connector API request failed."
                throw ConnectorApiException(status, code.take(80), SecretRedactor.safeError(message).orEmpty())
            }
            val code = response?.optString("code")
            if (response == null || code != "OK") {
                throw ConnectorApiException(status, code ?: "INVALID_RESPONSE", "Connector API response is invalid.")
            }
            return response.optJSONObject("data") ?: JSONObject()
        } catch (exception: ConnectorApiException) {
            throw exception
        } catch (exception: IOException) {
            throw ConnectorApiException(0, "NETWORK_IO_ERROR", exception.javaClass.simpleName, exception)
        } finally {
            connection.disconnect()
        }
    }

    private fun baseCapabilities(): JSONObject = JSONObject()
        .put("usbHost", true)
        .put("channels", JSONArray(listOf("LOCAL_USB_ESCPOS")))
        .put("receiptTypes", JSONArray(listOf("ORDER_CUSTOMER", "TABLE_BILL")))
        .put("renderProfiles", JSONArray(listOf("ESCPOS_RASTER_V1")))
        .put("paperWidths", JSONArray(listOf("MM58", "MM80")))
        .put("platform", "ANDROID")
        .put("androidApiLevel", Build.VERSION.SDK_INT)

    private fun JSONObject.requiredObject(key: String): JSONObject = optJSONObject(key)
        ?: throw ConnectorApiException(200, "INVALID_RESPONSE", "Missing object: $key")

    private fun JSONObject.requiredString(key: String, maxLength: Int): String = optString(key)
        .takeIf { it.isNotBlank() && it.length <= maxLength }
        ?: throw ConnectorApiException(200, "INVALID_RESPONSE", "Missing or invalid field: $key")

    private fun JSONObject.requiredPositiveLong(key: String): Long = optLong(key, -1)
        .takeIf { it > 0 }
        ?: throw ConnectorApiException(200, "INVALID_RESPONSE", "Missing or invalid field: $key")

    private fun JSONObject.requiredInstantMillis(key: String): Long = optString(key)
        .takeIf(String::isNotBlank)
        ?.let(::parseInstant)
        ?: throw ConnectorApiException(200, "INVALID_RESPONSE", "Missing or invalid time: $key")

    private fun String.safePathSegment(): String {
        require(NUMERIC_ID.matches(this)) { "Server job id is invalid." }
        return this
    }

    private fun parseInstant(value: String): Long = runCatching { Instant.parse(value).toEpochMilli() }
        .getOrElse { throw ConnectorApiException(200, "INVALID_RESPONSE", "Invalid server timestamp.") }

    private fun readLimited(reader: java.io.Reader): String {
        val output = StringBuilder(minOf(MAX_RESPONSE_CHARS, 16_384))
        val buffer = CharArray(8_192)
        while (true) {
            val read = reader.read(buffer)
            if (read < 0) break
            if (output.length + read > MAX_RESPONSE_CHARS) {
                throw ConnectorApiException(200, "RESPONSE_TOO_LARGE", "Connector API response exceeded limit.")
            }
            output.append(buffer, 0, read)
        }
        return output.toString()
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 15_000
        const val MAX_RESPONSE_CHARS = 1_000_000
        val NUMERIC_ID = Regex("^[1-9][0-9]{0,38}$")
        val SHA256 = Regex("^[0-9a-f]{64}$")
    }
}
