using System.Net;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using System.Net.Http.Headers;
using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Core.Tests;

public sealed class TerminalApiClientTests
{
    [Fact]
    public void ReadsMerchantIdentityFromCashierJwt()
    {
        var payload = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"merchantId\":\"18\"}"))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        Assert.Equal("18", TerminalApiClient.MerchantIdFromJwt($"e30.{payload}.signature"));
    }

    [Fact]
    public async Task SendsExplicitWindowsSpoolerEvidenceDuringBindingSync()
    {
        string? requestJson = null;
        var handler = new StubHandler(async request =>
        {
            requestJson = await request.Content!.ReadAsStringAsync();
            return new HttpResponseMessage(HttpStatusCode.Created)
            {
                Content = new StringContent(
                    "{\"code\":\"OK\",\"data\":{\"printerId\":\"41\",\"localBindingId\":\"windows-front-desk\",\"bindingVersion\":1,\"enabled\":false,\"status\":\"ONLINE\"}}",
                    Encoding.UTF8,
                    "application/json"),
            };
        });
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.test/api/v1/") };
        using var api = new TerminalApiClient(http, http.BaseAddress);
        var profile = new LocalPrinterProfile(
            "windows-front-desk",
            "前台收银机",
            PrinterTransportKind.WindowsSpooler,
            PrintPaperWidth.MM80,
            "FRONT_DESK",
            true,
            WindowsPrinterName: "Receipt Printer");
        var evidence = new WindowsSpoolerEvidence(true, true, true, true, "READY");

        var result = await api.SyncBindingAsync(
            $"yt1.1.{new string('A', 43)}",
            profile,
            evidence,
            CancellationToken.None);

        Assert.Equal("41", result.PrinterId);
        using var body = JsonDocument.Parse(Assert.IsType<string>(requestJson));
        var root = body.RootElement;
        Assert.Equal("CONNECTED", root.GetProperty("status").GetString());
        var capabilities = root.GetProperty("capabilities");
        Assert.Equal("WINDOWS", capabilities.GetProperty("platform").GetString());
        Assert.Equal("WINDOWS_RAW_SPOOLER", capabilities.GetProperty("adapter").GetString());
        Assert.True(capabilities.GetProperty("spoolerQueueFound").GetBoolean());
        Assert.True(capabilities.GetProperty("spoolerOpenSucceeded").GetBoolean());
        Assert.True(capabilities.GetProperty("spoolerQueueReady").GetBoolean());
        Assert.True(capabilities.GetProperty("appExecutionReady").GetBoolean());
    }

    [Fact]
    public async Task ReportsBinaryArtifactCapabilityInHeartbeat()
    {
        string? requestJson = null;
        var handler = new StubHandler(async request =>
        {
            requestJson = await request.Content!.ReadAsStringAsync();
            return JsonResponse("{\"code\":\"OK\",\"data\":{}}");
        });
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.test/api/v1/") };
        using var api = new TerminalApiClient(http, http.BaseAddress);

        await api.HeartbeatAsync(new string('t', 24), 1, 2, [], CancellationToken.None);

        using var body = JsonDocument.Parse(Assert.IsType<string>(requestJson));
        Assert.True(body.RootElement.GetProperty("capabilities")
            .GetProperty("BINARY_PRINT_ARTIFACT_V1").GetBoolean());
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(5)]
    [InlineData(10)]
    public async Task StreamsAndVerifiesLargeBinaryArtifactsToPrivateTempFiles(int megabytes)
    {
        var payload = Enumerable.Range(0, megabytes * 1024 * 1024)
            .Select(value => (byte)(value % 251)).ToArray();
        var sha = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
        var requests = new List<HttpRequestMessage>();
        var handler = new StubHandler(request =>
        {
            requests.Add(request);
            return Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/artifact", StringComparison.Ordinal)
                ? BinaryResponse(payload, sha)
                : JsonResponse(BinaryClaim(payload.Length, sha)));
        });
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.test/api/v1/") };
        using var api = new TerminalApiClient(http, http.BaseAddress);
        var route = new RouteIdentity("37", "windows-front-desk", 4, PrinterTransportKind.WindowsSpooler);
        var cache = Path.Combine(Path.GetTempPath(), $"yq-windows-artifact-{Guid.NewGuid():N}");
        try
        {
            var job = Assert.IsType<ClaimedPrintJob>(await api.ClaimJobAsync(
                new string('t', 24), route, false, CancellationToken.None));
            Assert.Equal("BINARY_PRINT_ARTIFACT_V1", job.PayloadTransport);
            Assert.Equal(payload.Length, job.RenderedPayloadByteLength);
            Assert.Equal(sha, job.RenderedPayloadSha256);

            using (var artifact = await api.DownloadArtifactAsync(
                new string('t', 24), job, cache, 0, CancellationToken.None))
            {
                Assert.Equal(payload.Length, artifact.ByteLength);
                Assert.Equal(sha, artifact.Sha256);
                Assert.Equal(payload, await File.ReadAllBytesAsync(artifact.Path));
                Assert.Equal(Path.GetFullPath(cache), Path.GetDirectoryName(Path.GetFullPath(artifact.Path)));
            }

            Assert.Empty(Directory.GetFiles(cache));
            Assert.Equal("ResponseHeadersRead", nameof(HttpCompletionOption.ResponseHeadersRead));
            Assert.Equal("0", requests[1].Headers.GetValues("X-YunQiao-Artifact-Retry-Count").Single());
        }
        finally
        {
            if (Directory.Exists(cache)) Directory.Delete(cache, true);
        }
    }

    [Fact]
    public async Task ShaMismatchRefusesPrintArtifactAndDeletesTempFile()
    {
        var expected = Enumerable.Repeat((byte)0x2a, 1024 * 1024).ToArray();
        var actual = expected.ToArray();
        actual[^1] = 0x2b;
        var sha = Convert.ToHexString(SHA256.HashData(expected)).ToLowerInvariant();
        var handler = new StubHandler(request => Task.FromResult(
            request.RequestUri!.AbsolutePath.EndsWith("/artifact", StringComparison.Ordinal)
                ? BinaryResponse(actual, sha)
                : JsonResponse(BinaryClaim(expected.Length, sha))));
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.test/api/v1/") };
        using var api = new TerminalApiClient(http, http.BaseAddress);
        var route = new RouteIdentity("37", "windows-front-desk", 4, PrinterTransportKind.WindowsSpooler);
        var cache = Path.Combine(Path.GetTempPath(), $"yq-windows-artifact-{Guid.NewGuid():N}");
        try
        {
            var job = Assert.IsType<ClaimedPrintJob>(await api.ClaimJobAsync(
                new string('t', 24), route, false, CancellationToken.None));
            var error = await Assert.ThrowsAsync<TerminalApiException>(() =>
                api.DownloadArtifactAsync(new string('t', 24), job, cache, 0, CancellationToken.None));
            Assert.Equal("PAYLOAD_SHA_MISMATCH", error.ErrorCode);
            Assert.Empty(Directory.GetFiles(cache));
        }
        finally
        {
            if (Directory.Exists(cache)) Directory.Delete(cache, true);
        }
    }

    [Fact]
    public async Task PartialArtifactDownloadCanRetryWithoutStartingAPrintAttempt()
    {
        var payload = Enumerable.Range(0, 5 * 1024 * 1024)
            .Select(value => (byte)(value % 197)).ToArray();
        var sha = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
        var artifactRequests = 0;
        var paths = new List<string>();
        var handler = new StubHandler(request =>
        {
            paths.Add(request.RequestUri!.AbsolutePath);
            if (!request.RequestUri.AbsolutePath.EndsWith("/artifact", StringComparison.Ordinal))
                return Task.FromResult(JsonResponse(BinaryClaim(payload.Length, sha)));
            artifactRequests++;
            return Task.FromResult(artifactRequests == 1
                ? BinaryResponse(payload[..(payload.Length / 2)], sha, payload.Length)
                : BinaryResponse(payload, sha));
        });
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://example.test/api/v1/") };
        using var api = new TerminalApiClient(http, http.BaseAddress);
        var route = new RouteIdentity("37", "windows-front-desk", 4, PrinterTransportKind.WindowsSpooler);
        var cache = Path.Combine(Path.GetTempPath(), $"yq-windows-retry-{Guid.NewGuid():N}");
        try
        {
            var job = Assert.IsType<ClaimedPrintJob>(await api.ClaimJobAsync(
                new string('t', 24), route, false, CancellationToken.None));
            var first = await Assert.ThrowsAsync<TerminalApiException>(() =>
                api.DownloadArtifactAsync(new string('t', 24), job, cache, 0, CancellationToken.None));
            Assert.Equal("PAYLOAD_LENGTH_MISMATCH", first.ErrorCode);

            using var artifact = await api.DownloadArtifactAsync(
                new string('t', 24), job, cache, 1, CancellationToken.None);
            Assert.Equal(payload.Length, artifact.ByteLength);
            Assert.Equal(sha, artifact.Sha256);
            Assert.Equal(3, paths.Count);
            Assert.DoesNotContain(paths, path => path.EndsWith("/printing", StringComparison.Ordinal));
        }
        finally
        {
            if (Directory.Exists(cache)) Directory.Delete(cache, true);
        }
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };

    private static HttpResponseMessage BinaryResponse(byte[] payload, string sha, int? declaredLength = null)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(payload),
        };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        response.Content.Headers.ContentLength = declaredLength ?? payload.Length;
        response.Headers.TryAddWithoutValidation("X-YunQiao-Payload-SHA256", sha);
        response.Headers.TryAddWithoutValidation("X-YunQiao-Render-Protocol", "ESC_POS_RASTER_V1");
        response.Headers.CacheControl = new CacheControlHeaderValue { Private = true, NoStore = true };
        return response;
    }

    private static string BinaryClaim(int byteLength, string sha) => JsonSerializer.Serialize(new
    {
        code = "OK",
        data = new
        {
            job = new
            {
                id = "267",
                jobId = "267",
                merchantId = "11",
                printerId = "37",
                status = "CLAIMED",
                receiptType = "ORDER_CUSTOMER",
                source = "TEST",
                attemptCount = 0,
                leaseVersion = 1,
                leaseExpiresAt = "2030-01-01T00:00:00Z",
                contentHash = new string('a', 64),
                canonicalTemplateVersion = "YQ_CANONICAL_RECEIPT_V1",
                renderProtocol = "ESC_POS_RASTER_V1",
                payloadTransport = "BINARY_PRINT_ARTIFACT_V1",
                payloadByteLength = byteLength,
                payloadSha256 = sha,
                artifactPath = "/terminal/jobs/267/artifact",
                paperWidthMm = 80,
                widthDots = 576,
                route = new
                {
                    printerId = "37",
                    localBindingId = "windows-front-desk",
                    bindingVersion = 4,
                    adapter = "WINDOWS_RAW_SPOOLER",
                },
            },
        },
    });

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            handler(request);
    }
}
