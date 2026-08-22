using System.Text.Json;
using System.Text.Json.Serialization;

namespace YunQiao.Cashier.Core.Queue;

public enum ExecutionState { Claimed, Printing, Succeeded, Failed, Uncertain }

public sealed record ExecutionEntry(
    string MerchantId,
    string JobId,
    int AttemptNo,
    string ContentHash,
    ExecutionState State,
    int PlannedBytes,
    int BytesWritten,
    bool IoAttempted,
    bool ServerReported,
    DateTimeOffset UpdatedAt,
    string? ErrorCode = null);

public enum RegistrationDisposition { Ready, DuplicateBlocked, RequiresOperator }

public sealed record LedgerRegistration(RegistrationDisposition Disposition, ExecutionEntry Entry);

/// <summary>Small durable idempotency ledger. Writes use temp + atomic replace in one process.</summary>
public sealed class ExecutionLedger
{
    private readonly string _path;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public ExecutionLedger(string path) => _path = path;

    public async Task<LedgerRegistration> RegisterAsync(
        string merchantId,
        string jobId,
        int attemptNo,
        string contentHash,
        CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var entries = await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false);
            var existing = entries.LastOrDefault(value =>
                value.MerchantId == merchantId && value.JobId == jobId && value.AttemptNo == attemptNo);
            if (existing is not null)
            {
                if (!string.Equals(existing.ContentHash, contentHash, StringComparison.Ordinal))
                    throw new InvalidDataException("A print attempt cannot change contentHash.");
                var disposition = existing.State switch
                {
                    ExecutionState.Succeeded => RegistrationDisposition.DuplicateBlocked,
                    ExecutionState.Printing or ExecutionState.Uncertain => RegistrationDisposition.RequiresOperator,
                    _ => RegistrationDisposition.Ready,
                };
                return new LedgerRegistration(disposition, existing);
            }

            var created = new ExecutionEntry(
                merchantId, jobId, attemptNo, contentHash, ExecutionState.Claimed,
                0, 0, false, false, DateTimeOffset.UtcNow);
            entries.Add(created);
            await WriteUnsafeAsync(entries, cancellationToken).ConfigureAwait(false);
            return new LedgerRegistration(RegistrationDisposition.Ready, created);
        }
        finally { _gate.Release(); }
    }

    public async Task<ExecutionEntry> UpdateAsync(ExecutionEntry value, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var entries = await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false);
            var index = entries.FindLastIndex(entry => entry.MerchantId == value.MerchantId
                && entry.JobId == value.JobId && entry.AttemptNo == value.AttemptNo);
            if (index < 0) throw new InvalidOperationException("Print execution entry is not registered.");
            var updated = value with { UpdatedAt = DateTimeOffset.UtcNow };
            entries[index] = updated;
            if (entries.Count > 2_000) entries.RemoveRange(0, entries.Count - 2_000);
            await WriteUnsafeAsync(entries, cancellationToken).ConfigureAwait(false);
            return updated;
        }
        finally { _gate.Release(); }
    }

    public async Task<IReadOnlyList<ExecutionEntry>> PendingReportsAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var entries = await ReadUnsafeAsync(cancellationToken).ConfigureAwait(false);
            return entries.Where(value => !value.ServerReported && value.State is ExecutionState.Succeeded or ExecutionState.Failed or ExecutionState.Uncertain).ToArray();
        }
        finally { _gate.Release(); }
    }

    private async Task<List<ExecutionEntry>> ReadUnsafeAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_path)) return [];
        await using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, 16_384, true);
        return await JsonSerializer.DeserializeAsync<List<ExecutionEntry>>(stream, _json, cancellationToken).ConfigureAwait(false) ?? [];
    }

    private async Task WriteUnsafeAsync(List<ExecutionEntry> entries, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path) ?? throw new InvalidOperationException("Ledger path has no directory."));
        var temporary = _path + ".tmp";
        await using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 16_384, true))
        {
            await JsonSerializer.SerializeAsync(stream, entries, _json, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        File.Move(temporary, _path, true);
    }
}
