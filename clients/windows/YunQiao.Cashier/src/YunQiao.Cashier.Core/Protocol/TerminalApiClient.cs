using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace YunQiao.Cashier.Core.Protocol;

public sealed class TerminalApiClient : IDisposable
{
    public static readonly Uri ProductionBaseUri = new("https://api.huayueyouxuan.com/api/v1/", UriKind.Absolute);
    private readonly HttpClient _http;
    private readonly bool _ownsClient;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly Regex Sha256Pattern = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private const string BinaryPrintArtifactV1 = "BINARY_PRINT_ARTIFACT_V1";
    private const int MaxBinaryArtifactBytes = 20 * 1024 * 1024;

    public TerminalApiClient(HttpClient? httpClient = null, Uri? baseUri = null)
    {
        _ownsClient = httpClient is null;
        _http = httpClient ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false });
        _http.BaseAddress = baseUri ?? ProductionBaseUri;
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public async Task<TerminalBootstrap> BootstrapAsync(
        string merchantJwt,
        string terminalInstanceId,
        string terminalSecret,
        string deviceModel,
        CancellationToken cancellationToken)
    {
        var body = new
        {
            terminalInstanceId,
            terminalSecret,
            terminalName = "YunQiao Cashier Windows",
            deviceModel = deviceModel[..Math.Min(deviceModel.Length, 80)],
            appVersion = TerminalCompatibility.AppVersion,
            appVersionCode = TerminalCompatibility.AppVersionCode,
        };
        using var data = await RequestAsync(HttpMethod.Post, "merchant/printing/connector/lan-terminal/bootstrap", merchantJwt, "Bearer", body, cancellationToken).ConfigureAwait(false);
        var terminalId = NumericString(data.RootElement, "terminalId");
        if (RequiredString(data.RootElement, "authorizationScheme", 16) != "Terminal")
            throw InvalidResponse("authorizationScheme");
        return new TerminalBootstrap(
            MerchantIdFromJwt(merchantJwt),
            terminalId,
            $"yt1.{terminalId}.{terminalSecret}",
            PositiveInt64(data.RootElement, "tokenVersion"),
            RequiredInstant(data.RootElement, "tokenExpiresAt"));
    }

    public async Task HeartbeatAsync(
        string terminalBearer,
        long heartbeatSequence,
        long appliedConfigVersion,
        IReadOnlyList<string> activeJobIds,
        CancellationToken cancellationToken)
    {
        var body = new
        {
            heartbeatSeq = Math.Max(0, heartbeatSequence),
            appliedConfigVersion = Math.Max(0, appliedConfigVersion),
            appVersion = TerminalCompatibility.AppVersion,
            buildRevision = "windows-wpf-v1",
            capabilities = new Dictionary<string, object?>
            {
                ["platform"] = "WINDOWS",
                ["SERVER_ESC_POS_PAYLOAD_V1"] = true,
                ["RAW_PAYLOAD_PASSTHROUGH"] = true,
                ["BINARY_PRINT_ARTIFACT_V1"] = true,
                ["windowsVersion"] = Environment.OSVersion.VersionString,
                ["channels"] = new[] { "LOCAL_USB_ESCPOS", "LOCAL_LAN_ESCPOS" },
            },
            activeJobIds = activeJobIds.Take(20).ToArray(),
        };
        using var ignored = await RequestAsync(HttpMethod.Post, "terminal/heartbeat", terminalBearer, "Terminal", body, cancellationToken).ConfigureAwait(false);
    }

    public async Task<TerminalConfig> GetConfigAsync(string terminalBearer, CancellationToken cancellationToken)
    {
        using var data = await RequestAsync(HttpMethod.Get, "terminal/config", terminalBearer, "Terminal", null, cancellationToken).ConfigureAwait(false);
        var root = data.RootElement;
        var terminal = RequiredObject(root, "terminal");
        return new TerminalConfig(
            RequiredBoolean(root, "merchantPrintingEnabled"),
            RequiredBoolean(root, "terminalEnabled"),
            RequiredBoolean(root, "executionEnabled"),
            RequiredBoolean(root, "automaticCreationEnabled"),
            BoundedInt32(root, "heartbeatIntervalSeconds", 5, 300),
            BoundedInt32(root, "pollIntervalSeconds", 2, 120),
            NonNegativeInt64(terminal, "configVersion"));
    }

    public async Task<LanTerminalConfig> GetLanConfigAsync(string terminalBearer, CancellationToken cancellationToken)
    {
        using var data = await RequestAsync(HttpMethod.Get, "terminal/lan/config", terminalBearer, "Terminal", null, cancellationToken).ConfigureAwait(false);
        return new LanTerminalConfig(
            RequiredBoolean(data.RootElement, "terminalEnabled"),
            RequiredBoolean(data.RootElement, "lanPrintingEnabled"));
    }

    public async Task<BindingSyncResult> SyncBindingAsync(
        string terminalBearer,
        LocalPrinterProfile profile,
        WindowsSpoolerEvidence? spoolerEvidence,
        CancellationToken cancellationToken)
    {
        if (profile.Transport == PrinterTransportKind.WindowsSpooler)
        {
            var evidence = spoolerEvidence ?? WindowsSpoolerEvidence.NotConfigured();
            var usbBody = new
            {
                localBindingId = profile.Id,
                vendorId = profile.VendorId,
                productId = profile.ProductId,
                name = profile.DisplayName,
                paperWidth = profile.PaperWidth.ToString(),
                enabled = profile.Enabled,
                appVersion = TerminalCompatibility.AppVersion,
                appVersionCode = TerminalCompatibility.AppVersionCode,
                status = profile.Enabled && evidence.Ready ? "CONNECTED" : "DISCONNECTED",
                capabilities = new
                {
                    platform = "WINDOWS",
                    adapter = "WINDOWS_RAW_SPOOLER",
                    role = profile.Role,
                    evidence.SpoolerQueueFound,
                    evidence.SpoolerOpenSucceeded,
                    evidence.SpoolerQueueReady,
                    evidence.AppExecutionReady,
                    spoolerStatus = evidence.StatusReason,
                },
            };
            using var data = await RequestAsync(HttpMethod.Post, "terminal/usb/bindings/sync", terminalBearer, "Terminal", usbBody, cancellationToken).ConfigureAwait(false);
            return ParseBinding(data.RootElement);
        }

        var lanBody = new
        {
            localBindingId = profile.Id,
            displayName = profile.DisplayName,
            host = profile.Host,
            port = profile.Port,
            paperWidth = profile.PaperWidth.ToString(),
            appVersion = TerminalCompatibility.AppVersion,
            appVersionCode = TerminalCompatibility.AppVersionCode,
            expectedBindingVersion = profile.BindingVersion,
            serviceRunning = true,
            executionEnabled = profile.Enabled,
            status = profile.Enabled ? "CONNECTED" : "DISCONNECTED",
            capabilities = new { platform = "WINDOWS", adapter = "WINDOWS_TCP_ESCPOS", role = profile.Role },
        };
        using var lanData = await RequestAsync(HttpMethod.Post, "terminal/lan/bindings/sync", terminalBearer, "Terminal", lanBody, cancellationToken).ConfigureAwait(false);
        return ParseBinding(lanData.RootElement);
    }

    public Task<ClaimedPrintJob?> GetActiveJobAsync(string bearer, RouteIdentity route, CancellationToken cancellationToken)
    {
        if (route.Transport == PrinterTransportKind.WindowsSpooler)
            return GetJobAsync(HttpMethod.Get, "terminal/jobs/active", bearer, null, route.Transport, cancellationToken);
        var query = $"printerId={Uri.EscapeDataString(route.PrinterId)}&localBindingId={Uri.EscapeDataString(route.LocalBindingId)}&bindingVersion={route.BindingVersion}";
        return GetJobAsync(HttpMethod.Get, $"terminal/lan/jobs/active?{query}", bearer, null, route.Transport, cancellationToken);
    }

    public Task<ClaimedPrintJob?> ClaimJobAsync(string bearer, RouteIdentity route, bool allowAutomatic, CancellationToken cancellationToken)
    {
        object body = route.Transport == PrinterTransportKind.Lan
            ? new { route.PrinterId, route.LocalBindingId, route.BindingVersion, allowAutomatic, leaseMs = 60_000 }
            : new { allowAutomatic, leaseMs = 60_000 };
        var path = route.Transport == PrinterTransportKind.Lan ? "terminal/lan/jobs/claim" : "terminal/jobs/claim";
        return GetJobAsync(HttpMethod.Post, path, bearer, body, route.Transport, cancellationToken);
    }

    public async Task<LeaseResult> ExtendLeaseAsync(string bearer, ClaimedPrintJob job, CancellationToken cancellationToken)
    {
        var route = job.Route;
        object body = route.Transport == PrinterTransportKind.Lan
            ? new { route.PrinterId, route.LocalBindingId, route.BindingVersion, leaseVersion = job.LeaseVersion, leaseMs = 60_000 }
            : new { leaseVersion = job.LeaseVersion, leaseMs = 60_000 };
        var action = route.Transport == PrinterTransportKind.Lan ? "extend" : "extend-lease";
        using var data = await RequestAsync(HttpMethod.Post, JobPath(job.Id, route.Transport, action), bearer, "Terminal", body, cancellationToken).ConfigureAwait(false);
        return new LeaseResult(PositiveInt64(data.RootElement, "leaseVersion"), RequiredInstant(data.RootElement, "leaseExpiresAt"));
    }

    public async Task<StartPrintingResult> MarkPrintingAsync(
        string bearer,
        ClaimedPrintJob job,
        long leaseVersion,
        CancellationToken cancellationToken)
    {
        var route = job.Route;
        object body = route.Transport == PrinterTransportKind.Lan
            ? new { route.PrinterId, route.LocalBindingId, route.BindingVersion, leaseVersion, contentHash = job.ContentHash, appVersion = TerminalCompatibility.AppVersion }
            : new { leaseVersion, contentHash = job.ContentHash, appVersion = TerminalCompatibility.AppVersion, adapter = job.Adapter };
        using var data = await RequestAsync(HttpMethod.Post, JobPath(job.Id, route.Transport, "printing"), bearer, "Terminal", body, cancellationToken).ConfigureAwait(false);
        var attempt = RequiredObject(data.RootElement, "attempt");
        var returnedJob = RequiredObject(data.RootElement, "job");
        return new StartPrintingResult(
            BoundedInt32(attempt, "attemptNo", 1, int.MaxValue),
            PositiveInt64(returnedJob, "leaseVersion"),
            RequiredInstant(returnedJob, "leaseExpiresAt"));
    }

    public async Task ReportSucceededAsync(
        string bearer,
        ClaimedPrintJob job,
        int attemptNo,
        long leaseVersion,
        int bytesWritten,
        CancellationToken cancellationToken)
    {
        var body = FinishBody(job, attemptNo, leaseVersion, bytesWritten);
        body["printerResponse"] = job.Route.Transport == PrinterTransportKind.Lan
            ? "WINDOWS_TCP_ESCPOS_WRITE_COMPLETE"
            : "WINDOWS_RAW_SPOOLER_WRITE_COMPLETE";
        using var ignored = await RequestAsync(HttpMethod.Post, JobPath(job.Id, job.Route.Transport, "succeeded"), bearer, "Terminal", body, cancellationToken).ConfigureAwait(false);
    }

    public async Task ReportFailedAsync(
        string bearer,
        ClaimedPrintJob job,
        int attemptNo,
        long leaseVersion,
        int bytesWritten,
        bool uncertain,
        bool retryable,
        string errorCode,
        string errorMessage,
        CancellationToken cancellationToken)
    {
        var body = FinishBody(job, attemptNo, leaseVersion, bytesWritten);
        body["retryable"] = retryable && !uncertain;
        body["errorCode"] = uncertain ? "PRINT_OUTCOME_UNKNOWN" : NormalizeErrorCode(errorCode);
        body["errorMessage"] = SanitizeError(errorMessage);
        body["outcome"] = uncertain ? "UNCERTAIN" : "FAILED";
        body["printerResponse"] = uncertain ? "LOCAL_WRITE_OUTCOME_UNKNOWN" : "LOCAL_WRITE_FAILED";
        using var ignored = await RequestAsync(HttpMethod.Post, JobPath(job.Id, job.Route.Transport, "failed"), bearer, "Terminal", body, cancellationToken).ConfigureAwait(false);
    }

    public async Task ReportPrinterStatusAsync(
        string bearer,
        RouteIdentity route,
        string status,
        string? errorCode,
        string? errorMessage,
        WindowsSpoolerEvidence? spoolerEvidence,
        CancellationToken cancellationToken)
    {
        if (status is not ("UNKNOWN" or "CONNECTED" or "DISCONNECTED" or "ERROR"))
            throw new ArgumentException("Printer status is invalid.", nameof(status));
        object body;
        string path;
        if (route.Transport == PrinterTransportKind.Lan)
        {
            path = "terminal/lan/printers/status";
            body = new
            {
                route.PrinterId,
                route.LocalBindingId,
                route.BindingVersion,
                status,
                serviceRunning = true,
                executionEnabled = true,
                capabilities = new { platform = "WINDOWS", adapter = "WINDOWS_TCP_ESCPOS" },
                lastError = errorMessage is null ? null : SanitizeError(errorMessage),
            };
        }
        else
        {
            var evidence = spoolerEvidence ?? WindowsSpoolerEvidence.NotConfigured();
            path = "terminal/printers/status";
            body = new
            {
                printerId = route.PrinterId,
                status,
                capabilities = new
                {
                    platform = "WINDOWS",
                    adapter = "WINDOWS_RAW_SPOOLER",
                    evidence.SpoolerQueueFound,
                    evidence.SpoolerOpenSucceeded,
                    evidence.SpoolerQueueReady,
                    evidence.AppExecutionReady,
                    spoolerStatus = evidence.StatusReason,
                },
                lastErrorCode = errorCode,
                lastErrorMessage = errorMessage is null ? null : SanitizeError(errorMessage),
            };
        }
        using var ignored = await RequestAsync(HttpMethod.Post, path, bearer, "Terminal", body, cancellationToken).ConfigureAwait(false);
    }

    private async Task<ClaimedPrintJob?> GetJobAsync(
        HttpMethod method,
        string path,
        string bearer,
        object? body,
        PrinterTransportKind transport,
        CancellationToken cancellationToken)
    {
        using var data = await RequestAsync(method, path, bearer, "Terminal", body, cancellationToken).ConfigureAwait(false);
        if (!data.RootElement.TryGetProperty("job", out var job) || job.ValueKind == JsonValueKind.Null) return null;
        return ParseJob(job, transport);
    }

    private static ClaimedPrintJob ParseJob(JsonElement job, PrinterTransportKind transport)
    {
        var id = NumericString(job, "id");
        var payloadTransport = RequiredString(job, "payloadTransport", 64);
        if (payloadTransport != BinaryPrintArtifactV1)
            throw new TerminalApiException(426, "CLIENT_UPGRADE_REQUIRED", "Binary print artifact is required.");
        var hash = RequiredString(job, "contentHash", 64).ToLowerInvariant();
        var routeJson = RequiredObject(job, "route");
        var route = new RouteIdentity(
            NumericString(routeJson, "printerId"),
            RequiredString(routeJson, "localBindingId", 128),
            PositiveInt64(routeJson, "bindingVersion"),
            transport);
        var currentAttempt = job.TryGetProperty("currentAttempt", out var current) && current.ValueKind == JsonValueKind.Object
            ? BoundedInt32(current, "attemptNo", 1, int.MaxValue)
            : (int?)null;
        var renderProtocol = RequiredString(job, "renderProtocol", 64);
        var payloadSha = RequiredString(job, "payloadSha256", 64).ToLowerInvariant();
        var parsed = new ClaimedPrintJob(
            id,
            NumericString(job, "merchantId"),
            NumericString(job, "printerId"),
            RequiredString(job, "status", 32),
            RequiredString(job, "receiptType", 32),
            RequiredString(job, "source", 32),
            BoundedInt32(job, "attemptCount", 0, int.MaxValue),
            currentAttempt,
            PositiveInt64(job, "leaseVersion"),
            RequiredInstant(job, "leaseExpiresAt"),
            hash,
            route,
            RequiredString(routeJson, "adapter", 80),
            renderProtocol,
            RequiredString(job, "canonicalTemplateVersion", 64),
            payloadSha,
            BoundedInt32(job, "payloadByteLength", 1, MaxBinaryArtifactBytes),
            OptionalInt32(job, "paperWidthMm"),
            OptionalInt32(job, "widthDots"),
            payloadTransport,
            RequiredString(job, "artifactPath", 256));
        if (parsed.PrinterId != route.PrinterId || parsed.Status is not ("CLAIMED" or "PRINTING"))
            throw InvalidResponse("job.route");
        if (
            parsed.ArtifactPath != $"/terminal/jobs/{id}/artifact" ||
            parsed.RenderProtocol != "ESC_POS_RASTER_V1" ||
            parsed.CanonicalTemplateVersion != "YQ_CANONICAL_RECEIPT_V1" ||
            parsed.RenderedPayloadByteLength is not (>= 1 and <= MaxBinaryArtifactBytes) ||
            !Sha256Pattern.IsMatch(parsed.RenderedPayloadSha256))
            throw InvalidResponse("binaryArtifact");
        return parsed;
    }

    public async Task<DownloadedPrintArtifact> DownloadArtifactAsync(
        string terminalBearer,
        ClaimedPrintJob job,
        string privateCacheDirectory,
        int retryCount,
        CancellationToken cancellationToken)
    {
        if (job.PayloadTransport != BinaryPrintArtifactV1 ||
            job.RenderedPayloadByteLength is not (>= 1 and <= MaxBinaryArtifactBytes) ||
            !Sha256Pattern.IsMatch(job.RenderedPayloadSha256))
            throw InvalidResponse("binaryArtifact");
        Directory.CreateDirectory(privateCacheDirectory);
        var temporary = System.IO.Path.Combine(
            privateCacheDirectory,
            $"yq-{job.Id}-{Guid.NewGuid():N}.escpos");
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            job.ArtifactPath.TrimStart('/'));
        request.Headers.Authorization = new AuthenticationHeaderValue("Terminal", terminalBearer);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/octet-stream"));
        request.Headers.Add("X-Terminal-App-Version", TerminalCompatibility.AppVersion);
        request.Headers.Add(
            "X-YunQiao-Artifact-Retry-Count",
            Math.Clamp(retryCount, 0, 20).ToString());
        try
        {
            using var response = await _http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);
            if ((int)response.StatusCode is >= 300 and < 400)
                throw new TerminalApiException((int)response.StatusCode, "REDIRECT_BLOCKED", "Artifact redirect blocked.");
            if (!response.IsSuccessStatusCode)
                throw new TerminalApiException((int)response.StatusCode, $"HTTP_{(int)response.StatusCode}", "Artifact request failed.");
            if (response.Content.Headers.ContentType?.MediaType != "application/octet-stream" ||
                response.Content.Headers.ContentEncoding.Count != 0)
                throw InvalidResponse("artifactHeaders");
            if (response.Content.Headers.ContentLength != job.RenderedPayloadByteLength)
                throw new TerminalApiException((int)response.StatusCode, "PAYLOAD_LENGTH_MISMATCH", "Artifact Content-Length mismatch.");
            var headerSha = Header(response, "X-YunQiao-Payload-SHA256")?.ToLowerInvariant();
            if (headerSha != job.RenderedPayloadSha256.ToLowerInvariant() ||
                Header(response, "X-YunQiao-Render-Protocol") != "ESC_POS_RASTER_V1")
                throw new TerminalApiException((int)response.StatusCode, "PAYLOAD_SHA_MISMATCH", "Artifact identity header mismatch.");

            await using var input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            await using var output = new FileStream(
                temporary,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            var buffer = new byte[64 * 1024];
            var actualLength = 0;
            while (true)
            {
                var count = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (count == 0) break;
                actualLength = checked(actualLength + count);
                if (actualLength > job.RenderedPayloadByteLength)
                    throw new TerminalApiException((int)response.StatusCode, "PAYLOAD_LENGTH_MISMATCH", "Artifact body exceeds declared length.");
                digest.AppendData(buffer, 0, count);
                await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
            }
            await output.FlushAsync(cancellationToken).ConfigureAwait(false);
            if (actualLength != job.RenderedPayloadByteLength)
                throw new TerminalApiException((int)response.StatusCode, "PAYLOAD_LENGTH_MISMATCH", "Artifact body length mismatch.");
            var actualSha = Convert.ToHexString(digest.GetHashAndReset()).ToLowerInvariant();
            if (actualSha != job.RenderedPayloadSha256.ToLowerInvariant())
                throw new TerminalApiException((int)response.StatusCode, "PAYLOAD_SHA_MISMATCH", "Artifact SHA-256 mismatch.");
            return new DownloadedPrintArtifact(temporary, actualLength, actualSha);
        }
        catch (Exception error) when (
            error is HttpRequestException or IOException ||
            error is OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            try { File.Delete(temporary); } catch { }
            throw new TerminalApiException(0, "NETWORK_IO_ERROR", error.GetType().Name, error);
        }
        catch
        {
            try { File.Delete(temporary); } catch { }
            throw;
        }
    }

    public async Task ReportArtifactFailureAsync(
        string terminalBearer,
        ClaimedPrintJob job,
        long leaseVersion,
        string errorCode,
        CancellationToken cancellationToken)
    {
        if (errorCode is not ("PAYLOAD_LENGTH_MISMATCH" or "PAYLOAD_SHA_MISMATCH"))
            throw new ArgumentException("Artifact error code is invalid.", nameof(errorCode));
        using var ignored = await RequestAsync(
            HttpMethod.Post,
            $"terminal/jobs/{job.Id}/artifact-failed",
            terminalBearer,
            "Terminal",
            new { leaseVersion, errorCode },
            cancellationToken).ConfigureAwait(false);
    }

    private static JsonObject FinishBody(ClaimedPrintJob job, int attemptNo, long leaseVersion, int bytesWritten)
    {
        var result = new JsonObject
        {
            ["attemptNo"] = attemptNo,
            ["leaseVersion"] = leaseVersion,
            ["bytesWritten"] = Math.Max(0, bytesWritten),
            ["contentHash"] = job.ContentHash,
            ["transport"] = job.Route.Transport == PrinterTransportKind.Lan
                ? "WINDOWS_TCP_ESCPOS"
                : "WINDOWS_RAW_SPOOLER",
        };
        if (!string.IsNullOrWhiteSpace(job.RenderedPayloadSha256))
            result["actualPayloadSha256"] = job.RenderedPayloadSha256;
        if (job.Route.Transport == PrinterTransportKind.Lan)
        {
            result["printerId"] = job.Route.PrinterId;
            result["localBindingId"] = job.Route.LocalBindingId;
            result["bindingVersion"] = job.Route.BindingVersion;
        }
        return result;
    }

    private async Task<JsonDocument> RequestAsync(
        HttpMethod method,
        string path,
        string credential,
        string scheme,
        object? body,
        CancellationToken cancellationToken)
    {
        if (credential.Length is < 24 or > 4_096 || credential.Any(char.IsWhiteSpace))
            throw new ArgumentException("Credential format is invalid.", nameof(credential));
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue(scheme, credential);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Add("X-Terminal-App-Version", TerminalCompatibility.AppVersion);
        if (body is not null)
            request.Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json");

        HttpResponseMessage response;
        try { response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false); }
        catch (HttpRequestException error) { throw new TerminalApiException(0, "NETWORK_IO_ERROR", error.GetType().Name, error); }
        using (response)
        {
            if ((int)response.StatusCode is >= 300 and < 400)
                throw new TerminalApiException((int)response.StatusCode, "REDIRECT_BLOCKED", "API redirect blocked.");
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            JsonDocument envelope;
            try { envelope = await JsonDocument.ParseAsync(stream, new JsonDocumentOptions { MaxDepth = 64 }, cancellationToken).ConfigureAwait(false); }
            catch (JsonException error) { throw new TerminalApiException((int)response.StatusCode, "INVALID_RESPONSE", "API response is not JSON.", error); }

            if (!response.IsSuccessStatusCode)
            {
                using (envelope)
                {
                    var code = OptionalString(envelope.RootElement, "code", 80) ?? $"HTTP_{(int)response.StatusCode}";
                    var message = SanitizeError(OptionalString(envelope.RootElement, "message", 500) ?? "Connector request failed.");
                    throw new TerminalApiException((int)response.StatusCode, code, message);
                }
            }
            if (OptionalString(envelope.RootElement, "code", 16) != "OK")
            {
                envelope.Dispose();
                throw new TerminalApiException((int)response.StatusCode, "INVALID_RESPONSE", "API envelope is invalid.");
            }
            if (!envelope.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object)
            {
                envelope.Dispose();
                throw InvalidResponse("data");
            }
            var result = JsonDocument.Parse(data.GetRawText());
            envelope.Dispose();
            return result;
        }
    }

    private static BindingSyncResult ParseBinding(JsonElement data) => new(
        NumericString(data, "printerId"),
        RequiredString(data, "localBindingId", 128),
        PositiveInt64(data, "bindingVersion"),
        RequiredBoolean(data, "enabled"),
        RequiredString(data, "status", 32));

    private static string? Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values)
            ? values.SingleOrDefault()
            : null;

    private static string JobPath(string jobId, PrinterTransportKind transport, string action)
    {
        if (!jobId.All(char.IsAsciiDigit) || jobId.StartsWith('0')) throw new ArgumentException("Job id is invalid.", nameof(jobId));
        if (action is not ("printing" or "extend" or "extend-lease" or "succeeded" or "failed")) throw new ArgumentException("Job action is invalid.", nameof(action));
        return transport == PrinterTransportKind.Lan
            ? $"terminal/lan/jobs/{jobId}/{action}"
            : $"terminal/jobs/{jobId}/{action}";
    }

    public static string MerchantIdFromJwt(string jwt)
    {
        var segment = jwt.Split('.').ElementAtOrDefault(1) ?? throw new TerminalApiException(200, "INVALID_MERCHANT_SESSION", "Merchant identity is missing.");
        segment = segment.Replace('-', '+').Replace('_', '/').PadRight(segment.Length + ((4 - segment.Length % 4) % 4), '=');
        try
        {
            using var payload = JsonDocument.Parse(Convert.FromBase64String(segment));
            return NumericString(payload.RootElement, "merchantId");
        }
        catch (Exception error) when (error is FormatException or JsonException)
        {
            throw new TerminalApiException(200, "INVALID_MERCHANT_SESSION", "Merchant identity is missing.", error);
        }
    }

    private static string NumericString(JsonElement owner, string key)
    {
        var value = RequiredString(owner, key, 20);
        if (value[0] == '0' || !value.All(char.IsAsciiDigit)) throw InvalidResponse(key);
        return value;
    }

    private static JsonElement RequiredObject(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Object ? value : throw InvalidResponse(key);

    private static bool RequiredBoolean(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : throw InvalidResponse(key);

    private static string RequiredString(JsonElement owner, string key, int max) =>
        OptionalString(owner, key, max) is { Length: > 0 } value ? value : throw InvalidResponse(key);

    private static string? OptionalString(JsonElement owner, string key, int max) =>
        owner.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String && value.GetString() is { } text && text.Length <= max ? text : null;

    private static int BoundedInt32(JsonElement owner, string key, int min, int max) =>
        owner.TryGetProperty(key, out var value) && value.TryGetInt32(out var number) && number >= min && number <= max ? number : throw InvalidResponse(key);

    private static int? OptionalInt32(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.TryGetInt32(out var number) ? number : null;

    private static long PositiveInt64(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.TryGetInt64(out var number) && number > 0 ? number : throw InvalidResponse(key);

    private static long NonNegativeInt64(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.TryGetInt64(out var number) && number >= 0 ? number : throw InvalidResponse(key);

    private static DateTimeOffset RequiredInstant(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(value.GetString(), out var instant) ? instant : throw InvalidResponse(key);

    private static TerminalApiException InvalidResponse(string key) => new(200, "INVALID_RESPONSE", $"Invalid API field: {key}");

    private static string NormalizeErrorCode(string value) => value switch
    {
        "TEMPLATE_INVALID" or "RECEIPT_SCHEMA_INVALID" or "RECEIPT_SCHEMA_UNSUPPORTED" or "CONTENT_HASH_MISMATCH" => "TEMPLATE_INVALID",
        "LAN_CONNECT_TIMEOUT" or "LAN_WRITE_TIMEOUT" => "NETWORK_TIMEOUT",
        "PRINTER_OFFLINE" or "CONFIG_INVALID" or "USB_WRITE_FAILED" or "PERMISSION_DENIED" => value,
        _ => "UNKNOWN",
    };

    private static string SanitizeError(string value)
    {
        var safe = value.Replace("Bearer ", "Bearer [redacted] ", StringComparison.OrdinalIgnoreCase);
        return safe[..Math.Min(safe.Length, 300)];
    }

    public void Dispose()
    {
        if (_ownsClient) _http.Dispose();
    }
}
