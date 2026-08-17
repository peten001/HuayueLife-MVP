using System.Net;
using System.Net.Sockets;

namespace YunQiao.Cashier.Core.Printing;

public enum TransportOutcome { Succeeded, Failed, Uncertain }

public sealed record TransportResult(
    TransportOutcome Outcome,
    int BytesWritten,
    bool IoAttempted,
    bool Retryable,
    string? ErrorCode = null,
    string? ErrorMessage = null)
{
    public static TransportResult Success(int bytes) => new(TransportOutcome.Succeeded, bytes, true, false);
    public static TransportResult Failure(string code, string message, bool retryable = true) =>
        new(TransportOutcome.Failed, 0, false, retryable, code, message);
    public static TransportResult Uncertain(int bytes, string code, string message) =>
        new(TransportOutcome.Uncertain, Math.Max(0, bytes), true, false, code, message);
}

public interface IPrinterTransport
{
    Task<TransportResult> SendAsync(ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken);
}

public sealed class TcpPrinterTransport(
    string host,
    int port = 9100,
    TimeSpan? connectTimeout = null,
    TimeSpan? writeTimeout = null) : IPrinterTransport
{
    private readonly TimeSpan _connectTimeout = connectTimeout ?? TimeSpan.FromSeconds(2);
    private readonly TimeSpan _writeTimeout = writeTimeout ?? TimeSpan.FromSeconds(8);

    public async Task<TransportResult> SendAsync(ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken)
    {
        if (bytes.IsEmpty) return TransportResult.Failure("EMPTY_PRINT_DATA", "Print bytes are empty.", false);
        if (!TryPrivateIpv4(host, out var address))
            return TransportResult.Failure("LAN_HOST_INVALID", "LAN printer must use a private IPv4 address.", false);
        if (port is < 1 or > 65_535)
            return TransportResult.Failure("LAN_PORT_INVALID", "LAN printer port is invalid.", false);

        using var client = new TcpClient(AddressFamily.InterNetwork) { NoDelay = true };
        try
        {
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                timeout.CancelAfter(_connectTimeout);
                await client.ConnectAsync(address, port, timeout.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return TransportResult.Failure("LAN_CONNECT_TIMEOUT", "LAN printer connection timed out.");
        }
        catch (SocketException error)
        {
            return TransportResult.Failure("LAN_CONNECT_FAILED", $"LAN connect failed: {error.SocketErrorCode}");
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(_writeTimeout);
            await client.GetStream().WriteAsync(bytes, timeout.Token).ConfigureAwait(false);
            await client.GetStream().FlushAsync(timeout.Token).ConfigureAwait(false);
            return TransportResult.Success(bytes.Length);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return TransportResult.Uncertain(0, "LAN_WRITE_TIMEOUT", "LAN write outcome is unknown after timeout.");
        }
        catch (IOException error)
        {
            return TransportResult.Uncertain(0, "LAN_WRITE_FAILED", $"LAN write outcome is unknown: {error.GetType().Name}");
        }
    }

    public static bool TryPrivateIpv4(string value, out IPAddress address)
    {
        address = IPAddress.None;
        if (!IPAddress.TryParse(value, out var parsed) || parsed.AddressFamily != AddressFamily.InterNetwork) return false;
        var bytes = parsed.GetAddressBytes();
        var isPrivate = bytes[0] == 10
            || bytes[0] == 127
            || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
            || (bytes[0] == 192 && bytes[1] == 168);
        if (!isPrivate) return false;
        address = parsed;
        return true;
    }
}
