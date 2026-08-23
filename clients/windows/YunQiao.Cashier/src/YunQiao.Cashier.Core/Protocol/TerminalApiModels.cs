namespace YunQiao.Cashier.Core.Protocol;

public static class TerminalCompatibility
{
    // The server feature gate accepts only this Android-compatible syntax.
    public const string AppVersion = "2.0.0-rc13";
    public const int AppVersionCode = 101;
}

public sealed record TerminalBootstrap(
    string MerchantId,
    string TerminalId,
    string TerminalBearer,
    long TokenVersion,
    DateTimeOffset TokenExpiresAt);

public sealed record TerminalConfig(
    bool MerchantPrintingEnabled,
    bool TerminalEnabled,
    bool ExecutionEnabled,
    bool AutomaticCreationEnabled,
    int HeartbeatSeconds,
    int PollIntervalSeconds,
    long ConfigVersion)
{
    public bool CanClaimJobs => MerchantPrintingEnabled && TerminalEnabled && ExecutionEnabled;
}

public sealed record LanTerminalConfig(bool TerminalEnabled, bool LanPrintingEnabled);

public enum PrinterTransportKind { WindowsSpooler, Lan }

public sealed record LocalPrinterProfile(
    string Id,
    string DisplayName,
    PrinterTransportKind Transport,
    PrintPaperWidth PaperWidth,
    string Role,
    bool Enabled,
    string? WindowsPrinterName = null,
    string? Host = null,
    int Port = 9100,
    int VendorId = 0,
    int ProductId = 0,
    string? PrinterId = null,
    long BindingVersion = 0);

public sealed record RouteIdentity(
    string PrinterId,
    string LocalBindingId,
    long BindingVersion,
    PrinterTransportKind Transport);

public sealed record BindingSyncResult(
    string PrinterId,
    string LocalBindingId,
    long BindingVersion,
    bool Enabled,
    string Status);

public sealed record WindowsSpoolerEvidence(
    bool SpoolerQueueFound,
    bool SpoolerOpenSucceeded,
    bool SpoolerQueueReady,
    bool AppExecutionReady,
    string StatusReason)
{
    public bool Ready => SpoolerQueueFound && SpoolerOpenSucceeded && SpoolerQueueReady && AppExecutionReady;

    public static WindowsSpoolerEvidence NotConfigured() =>
        new(false, false, false, false, "NOT_CONFIGURED");
}

public sealed record ClaimedPrintJob(
    string Id,
    string MerchantId,
    string PrinterId,
    string Status,
    string ReceiptType,
    string Source,
    int AttemptCount,
    int? CurrentAttemptNo,
    long LeaseVersion,
    DateTimeOffset LeaseExpiresAt,
    string ContentHash,
    int SnapshotSchemaVersion,
    string ReceiptSnapshotJson,
    RouteIdentity Route,
    string Adapter,
    string? RenderProtocol = null,
    string? CanonicalTemplateVersion = null,
    byte[]? RenderedPayload = null,
    string? RenderedPayloadSha256 = null,
    int? RenderedPayloadByteLength = null,
    int? PaperWidthMm = null,
    int? WidthDots = null)
{
    public int ExpectedAttemptNo => CurrentAttemptNo ?? AttemptCount + 1;
}

public sealed record LeaseResult(long LeaseVersion, DateTimeOffset LeaseExpiresAt);
public sealed record StartPrintingResult(int AttemptNo, long LeaseVersion, DateTimeOffset LeaseExpiresAt);

public sealed class TerminalApiException(
    int statusCode,
    string errorCode,
    string message,
    Exception? innerException = null) : Exception(message, innerException)
{
    public int StatusCode { get; } = statusCode;
    public string ErrorCode { get; } = errorCode;
    public bool CredentialInvalid => StatusCode == 401 || ErrorCode is "TERMINAL_AUTH_INVALID" or "TERMINAL_CREDENTIAL_EXPIRED" or "TERMINAL_DISABLED";
}
