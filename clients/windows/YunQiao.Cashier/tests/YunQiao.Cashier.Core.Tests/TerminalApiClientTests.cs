using System.Net;
using System.Text;
using System.Text.Json;
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

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handler) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            handler(request);
    }
}
