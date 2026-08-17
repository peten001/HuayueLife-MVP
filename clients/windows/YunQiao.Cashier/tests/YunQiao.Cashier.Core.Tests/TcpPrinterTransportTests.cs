using System.Net;
using System.Net.Sockets;
using YunQiao.Cashier.Core.Printing;

namespace YunQiao.Cashier.Core.Tests;

public sealed class TcpPrinterTransportTests
{
    [Fact]
    public async Task SendsRendererBytesUnchangedToFakeTcpPrinter()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            byte[] expected = [0x1b, 0x40, 0x1d, 0x76, 0x30, 0x00, 0xaa, 0x1d, 0x56, 0x01];
            var receive = Task.Run(async () =>
            {
                using var client = await listener.AcceptTcpClientAsync();
                using var output = new MemoryStream();
                await client.GetStream().CopyToAsync(output);
                return output.ToArray();
            });
            var transport = new TcpPrinterTransport("127.0.0.1", port);
            var result = await transport.SendAsync(expected, CancellationToken.None);
            Assert.Equal(TransportOutcome.Succeeded, result.Outcome);
            Assert.Equal(expected.Length, result.BytesWritten);
            Assert.Equal(expected, await receive.WaitAsync(TimeSpan.FromSeconds(2)));
        }
        finally { listener.Stop(); }
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("example.com")]
    [InlineData("2001:db8::1")]
    public async Task RejectsNonPrivateOrNonIpv4TargetsBeforeIo(string host)
    {
        var result = await new TcpPrinterTransport(host).SendAsync(new byte[] { 1 }, CancellationToken.None);
        Assert.Equal(TransportOutcome.Failed, result.Outcome);
        Assert.False(result.IoAttempted);
        Assert.Equal("LAN_HOST_INVALID", result.ErrorCode);
    }
}
