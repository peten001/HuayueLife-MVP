using System.Text.Json;
using System.Text.Json.Serialization;
using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Core.Queue;

public sealed record PendingPrintReport(
    string JobId,
    string MerchantId,
    string PrinterId,
    string ReceiptType,
    string Source,
    string ContentHash,
    RouteIdentity Route,
    string Adapter,
    int AttemptNo,
    long LeaseVersion,
    int BytesWritten,
    ExecutionState State,
    bool Retryable,
    string? ErrorCode,
    string? ErrorMessage,
    DateTimeOffset CreatedAt);

public sealed class PendingReportStore
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public PendingReportStore(string path) => _path = path;

    public async Task AddAsync(PendingPrintReport report, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var values = await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false);
            values.RemoveAll(item => item.JobId == report.JobId && item.AttemptNo == report.AttemptNo);
            values.Add(report);
            await WriteUnsafeAsync(values, cancellationToken).ConfigureAwait(false);
        }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<PendingPrintReport>> ReadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { return await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false); }
        finally { _gate.Release(); }
    }

    public async Task RemoveAsync(string jobId, int attemptNo, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var values = await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false);
            values.RemoveAll(item => item.JobId == jobId && item.AttemptNo == attemptNo);
            await WriteUnsafeAsync(values, cancellationToken).ConfigureAwait(false);
        }
        finally { _gate.Release(); }
    }

    private async Task<List<PendingPrintReport>> ReadUnsafeAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return [];
        await using var input = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, 16_384, true);
        return await JsonSerializer.DeserializeAsync<List<PendingPrintReport>>(input, _json, cancellationToken).ConfigureAwait(false) ?? [];
    }

    private async Task WriteUnsafeAsync(List<PendingPrintReport> values, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporary = _path + ".tmp";
        await using (var output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 16_384, true))
            await JsonSerializer.SerializeAsync(output, values, _json, cancellationToken).ConfigureAwait(false);
        File.Move(temporary, _path, true);
    }
}
