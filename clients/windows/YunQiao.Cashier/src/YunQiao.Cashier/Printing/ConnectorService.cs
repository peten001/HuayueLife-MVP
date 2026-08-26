using YunQiao.Cashier.Core.Printing;
using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Core.Queue;
using YunQiao.Cashier.Logging;
using YunQiao.Cashier.Security;
using YunQiao.Cashier.Settings;

namespace YunQiao.Cashier.Printing;

public sealed class ConnectorService : IAsyncDisposable
{
    private readonly SettingsService _settingsService;
    private readonly DpapiCredentialStore _credentialStore;
    private readonly TerminalApiClient _api;
    private readonly ExecutionLedger _ledger;
    private readonly PendingReportStore _pendingReports;
    private readonly SemaphoreSlim _sessionGate = new(1, 1);
    private readonly SemaphoreSlim _settingsRefresh = new(0, 1);
    private CancellationTokenSource? _runCancellation;
    private Task? _runTask;
    private string? _merchantJwtFingerprint;
    private string? _activeMerchantId;
    private string? _lastStatus;
    public event EventHandler<string>? StatusChanged;

    public ConnectorService(
        SettingsService settingsService,
        DpapiCredentialStore credentialStore,
        TerminalApiClient api)
    {
        _settingsService = settingsService;
        _credentialStore = credentialStore;
        _api = api;
        var state = Path.Combine(SettingsService.RootDirectory, "state");
        _ledger = new ExecutionLedger(Path.Combine(state, "execution-ledger.json"));
        _pendingReports = new PendingReportStore(Path.Combine(state, "pending-operations.json"));
    }

    public async Task UpdateSessionAsync(string? merchantJwt)
    {
        var fingerprint = merchantJwt is null ? null : Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(merchantJwt))).ToLowerInvariant()[..12];
        await _sessionGate.WaitAsync();
        try
        {
            if (fingerprint == _merchantJwtFingerprint && _runTask is { IsCompleted: false }) return;
            await StopUnsafeAsync();
            string? merchantId;
            try { merchantId = merchantJwt is null ? null : TerminalApiClient.MerchantIdFromJwt(merchantJwt); }
            catch
            {
                if (_activeMerchantId is not null) _credentialStore.ClearCredential(_activeMerchantId);
                _activeMerchantId = null;
                _merchantJwtFingerprint = fingerprint;
                SetStatus("打印连接器等待有效商家登录");
                throw;
            }
            if (_activeMerchantId is not null && _activeMerchantId != merchantId)
                _credentialStore.ClearCredential(_activeMerchantId);
            _merchantJwtFingerprint = fingerprint;
            _activeMerchantId = merchantId;
            if (merchantJwt is null)
            {
                SetStatus("打印连接器等待商家登录");
                return;
            }
            _runCancellation = new CancellationTokenSource();
            _runTask = RunAsync(merchantJwt, merchantId!, _runCancellation.Token);
        }
        finally { _sessionGate.Release(); }
    }

    public Task RefreshSettingsAsync()
    {
        var running = _runTask;
        if (running is null || running.IsCompleted) return Task.CompletedTask;
        SetStatus("打印机设置已保存，将立即同步");
        if (_settingsRefresh.CurrentCount == 0) _settingsRefresh.Release();
        return Task.CompletedTask;
    }

    private async Task RunAsync(string merchantJwt, string merchantId, CancellationToken cancellationToken)
    {
        try
        {
            SetStatus("正在建立安全打印连接…");
            var settings = await _settingsService.LoadAsync(cancellationToken);
            var identity = _credentialStore.GetBootstrapIdentity(merchantId, settings.TerminalInstanceId);
            TerminalBootstrap bootstrap;
            try
            {
                bootstrap = await BootstrapAsync(merchantJwt, identity, cancellationToken);
            }
            catch (TerminalApiException error) when (
                error.ErrorCode == "TERMINAL_DEVICE_CONFLICT" && identity.CanReplaceOnDeviceConflict)
            {
                AppLog.Warn("LEGACY_TERMINAL_IDENTITY_CONFLICT", $"merchantId={merchantId}");
                SetStatus("正在为当前门店建立独立打印终端…");
                identity = _credentialStore.ReplaceLegacyIdentityAfterConflict(identity);
                bootstrap = await BootstrapAsync(merchantJwt, identity, cancellationToken);
            }
            _credentialStore.SaveCredential(identity, bootstrap);
            var bearer = bootstrap.TerminalBearer;
            var heartbeatSequence = 0L;
            var config = await _api.GetConfigAsync(bearer, cancellationToken);
            var lanConfig = new LanTerminalConfig(false, false);
            var lastSync = DateTimeOffset.MinValue;
            var routes = new Dictionary<string, RouteIdentity>(StringComparer.Ordinal);
            SetStatus("安全打印连接已建立");

            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    settings = await _settingsService.LoadAsync(cancellationToken);
                    await _api.HeartbeatAsync(bearer, heartbeatSequence++, config.ConfigVersion, [], cancellationToken);
                    config = await _api.GetConfigAsync(bearer, cancellationToken);
                    if (settings.Printers.Any(value => value.Enabled && value.Transport == PrinterTransportKind.Lan))
                        lanConfig = await _api.GetLanConfigAsync(bearer, cancellationToken);
                    await RecoverPendingReportsAsync(bearer, bootstrap.MerchantId, cancellationToken);

                    if (DateTimeOffset.UtcNow - lastSync >= TimeSpan.FromSeconds(30) || routes.Count == 0)
                    {
                        routes = await SyncBindingsAsync(bearer, settings, cancellationToken);
                        lastSync = DateTimeOffset.UtcNow;
                    }

                    if (config.CanClaimJobs)
                    {
                        foreach (var profile in settings.Printers.Where(value => value.Enabled))
                        {
                            if (profile.Transport == PrinterTransportKind.Lan && (!lanConfig.TerminalEnabled || !lanConfig.LanPrintingEnabled)) continue;
                            if (!routes.TryGetValue(profile.Id, out var route)) continue;
                            await PollAndExecuteAsync(
                                bearer,
                                profile,
                                route,
                                config.AutomaticCreationEnabled,
                                cancellationToken,
                                token => _api.HeartbeatAsync(
                                    bearer,
                                    heartbeatSequence++,
                                    config.ConfigVersion,
                                    [],
                                    token));
                        }
                    }
                    SetStatus(config.CanClaimJobs ? "打印连接器运行中" : "后台已暂停本终端打印");
                    _ = await _settingsRefresh.WaitAsync(TimeSpan.FromSeconds(config.PollIntervalSeconds), cancellationToken);
                }
                catch (TerminalApiException error) when (!error.CredentialInvalid)
                {
                    AppLog.Warn("CONNECTOR_API_RETRY", $"code={error.ErrorCode} status={error.StatusCode}");
                    SetStatus($"打印服务暂时不可用：{error.ErrorCode}");
                    await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (TerminalApiException error) when (error.CredentialInvalid)
        {
            _credentialStore.ClearCredential(merchantId);
            AppLog.Warn("CONNECTOR_CREDENTIAL_INVALID", $"code={error.ErrorCode}");
            SetStatus("打印终端凭据失效，请重新登录");
        }
        catch (TerminalApiException error) when (error.ErrorCode == "TERMINAL_DEVICE_CONFLICT")
        {
            AppLog.Warn("CONNECTOR_IDENTITY_CONFLICT", $"merchantId={merchantId}");
            SetStatus("打印终端身份冲突，请联系服务人员");
        }
        catch (Exception error)
        {
            AppLog.Error("CONNECTOR_STOPPED", error);
            SetStatus("打印连接器已停止，请刷新或重新登录");
        }
    }

    private Task<TerminalBootstrap> BootstrapAsync(
        string merchantJwt,
        TerminalBootstrapIdentity identity,
        CancellationToken cancellationToken) =>
        _api.BootstrapAsync(
            merchantJwt,
            identity.TerminalInstanceId,
            identity.TerminalSecret,
            $"Windows {Environment.OSVersion.Version}",
            cancellationToken);

    private async Task<Dictionary<string, RouteIdentity>> SyncBindingsAsync(
        string bearer,
        AppSettings settings,
        CancellationToken cancellationToken)
    {
        var routes = new Dictionary<string, RouteIdentity>(StringComparer.Ordinal);
        var profiles = settings.Printers.ToArray();
        var changed = false;
        for (var index = 0; index < profiles.Length; index++)
        {
            var profile = profiles[index];
            if (!profile.Enabled) continue;
            if (!ProfileReady(profile))
            {
                AppLog.Warn("BINDING_SKIPPED", $"profile={profile.Id} reason=incomplete");
                continue;
            }
            try
            {
                var spoolerEvidence = profile.Transport == PrinterTransportKind.WindowsSpooler
                    ? WindowsSpoolerTransport.Probe(profile.WindowsPrinterName)
                    : null;
                var synced = await _api.SyncBindingAsync(bearer, profile, spoolerEvidence, cancellationToken);
                var updated = profile with { PrinterId = synced.PrinterId, BindingVersion = synced.BindingVersion };
                profiles[index] = updated;
                changed |= updated != profile;
                if (spoolerEvidence is null || spoolerEvidence.Ready)
                    routes[profile.Id] = new RouteIdentity(synced.PrinterId, synced.LocalBindingId, synced.BindingVersion, profile.Transport);
                else
                    AppLog.Warn("SPOOLER_NOT_READY", $"profile={profile.Id} status={spoolerEvidence.StatusReason}");
                AppLog.Info("BINDING_SYNCED", $"profile={profile.Id} printerId={synced.PrinterId} version={synced.BindingVersion}");
            }
            catch (TerminalApiException error)
            {
                AppLog.Warn("BINDING_SYNC_FAILED", $"profile={profile.Id} code={error.ErrorCode}");
            }
        }
        if (changed) await _settingsService.SaveAsync(settings with { Printers = profiles }, cancellationToken);
        return routes;
    }

    private async Task PollAndExecuteAsync(
        string bearer,
        LocalPrinterProfile profile,
        RouteIdentity route,
        bool allowAutomatic,
        CancellationToken cancellationToken,
        Func<CancellationToken, Task> heartbeatDuringDownload)
    {
        var job = await _api.GetActiveJobAsync(bearer, route, cancellationToken)
            ?? await _api.ClaimJobAsync(bearer, route, allowAutomatic, cancellationToken);
        if (job is null) return;
        if (job.Route.PrinterId != route.PrinterId || job.Route.LocalBindingId != route.LocalBindingId || job.Route.BindingVersion != route.BindingVersion)
        {
            AppLog.Warn("JOB_ROUTE_REJECTED", $"jobId={job.Id}");
            return;
        }
        await ExecuteAsync(bearer, profile, job, cancellationToken, heartbeatDuringDownload);
    }

    private async Task ExecuteAsync(
        string bearer,
        LocalPrinterProfile profile,
        ClaimedPrintJob job,
        CancellationToken cancellationToken,
        Func<CancellationToken, Task> heartbeatDuringDownload)
    {
        if (job.PayloadTransport != "BINARY_PRINT_ARTIFACT_V1")
            throw new TerminalApiException(426, "CLIENT_UPGRADE_REQUIRED", "Binary print artifact is required.");
        PreparedArtifact preparedArtifact;
        try
        {
            preparedArtifact = await DownloadBinaryWithKeepAliveAsync(
                bearer,
                job,
                heartbeatDuringDownload,
                cancellationToken);
        }
        catch (ArtifactDownloadException failure)
        {
            var error = failure.ApiError;
            AppLog.Warn("PRINT_ARTIFACT_REFUSED", $"jobId={job.Id} code={error.ErrorCode}");
            if (error.ErrorCode is "PAYLOAD_LENGTH_MISMATCH" or "PAYLOAD_SHA_MISMATCH")
            {
                try
                {
                    await _api.ReportArtifactFailureAsync(
                        bearer,
                        job,
                        failure.LeaseVersion,
                        error.ErrorCode,
                        cancellationToken);
                }
                catch (TerminalApiException reportError)
                {
                    AppLog.Warn("PRINT_ARTIFACT_FAILURE_REPORT_PENDING", $"jobId={job.Id} code={reportError.ErrorCode}");
                }
            }
            return;
        }
        using var artifactCleanup = preparedArtifact.Artifact;
        var registration = await _ledger.RegisterAsync(job.MerchantId, job.Id, job.ExpectedAttemptNo, job.ContentHash, cancellationToken);
        if (registration.Disposition != RegistrationDisposition.Ready)
        {
            AppLog.Warn("DUPLICATE_BLOCKED", $"jobId={job.Id} disposition={registration.Disposition}");
            return;
        }

        var leaseJob = job with { LeaseVersion = preparedArtifact.LeaseVersion };
        var lease = await _api.ExtendLeaseAsync(bearer, leaseJob, cancellationToken);
        var started = job.Status == "PRINTING" && job.CurrentAttemptNo is not null
            ? new StartPrintingResult(job.CurrentAttemptNo.Value, lease.LeaseVersion, lease.LeaseExpiresAt)
            : await _api.MarkPrintingAsync(bearer, job, lease.LeaseVersion, cancellationToken);
        if (started.AttemptNo != registration.Entry.AttemptNo)
        {
            AppLog.Warn("ATTEMPT_MISMATCH", $"jobId={job.Id}");
            return;
        }

        var printing = await _ledger.UpdateAsync(registration.Entry with
        {
            State = ExecutionState.Printing,
            PlannedBytes = preparedArtifact.Artifact.ByteLength,
            IoAttempted = true,
        }, cancellationToken);
        var plannedBytes = preparedArtifact.Artifact.ByteLength;
        AppLog.Info("PRINT_EXECUTE_START", $"jobId={job.Id} attempt={started.AttemptNo} bytes={plannedBytes} transport={profile.Transport}");
        var transport = ResolveTransport(profile);
        TransportResult result;
        try
        {
            result = transport is IStreamPrinterTransport streaming
                ? await streaming.SendFileAsync(
                    preparedArtifact.Artifact.Path,
                    preparedArtifact.Artifact.ByteLength,
                    cancellationToken)
                : TransportResult.Failure("CONFIG_INVALID", "Binary artifact transport is not stream-capable.", false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            result = TransportResult.Uncertain(0, "PRINT_CANCELLED", "Print process stopped after I/O began.");
        }
        catch (Exception error)
        {
            result = TransportResult.Uncertain(0, "PRINT_EXECUTION_EXCEPTION", error.GetType().Name);
        }

        var finalState = result.Outcome switch
        {
            TransportOutcome.Succeeded => ExecutionState.Succeeded,
            TransportOutcome.Failed => ExecutionState.Failed,
            _ => ExecutionState.Uncertain,
        };
        var completed = await _ledger.UpdateAsync(printing with
        {
            State = finalState,
            BytesWritten = result.BytesWritten,
            IoAttempted = result.IoAttempted,
            ErrorCode = result.ErrorCode,
        }, CancellationToken.None);
        var report = CreatePending(job, started.AttemptNo, started.LeaseVersion, result, finalState);
        await ReportOrQueueAsync(bearer, report, completed, CancellationToken.None);
        try
        {
            var spoolerEvidence = profile.Transport == PrinterTransportKind.WindowsSpooler
                ? WindowsSpoolerTransport.Probe(profile.WindowsPrinterName)
                : null;
            await _api.ReportPrinterStatusAsync(
                bearer,
                job.Route,
                result.Outcome == TransportOutcome.Succeeded && (spoolerEvidence?.Ready ?? true) ? "CONNECTED" : "ERROR",
                result.ErrorCode,
                result.ErrorMessage,
                spoolerEvidence,
                CancellationToken.None);
        }
        catch (TerminalApiException error)
        {
            AppLog.Warn("PRINTER_STATUS_REPORT_FAILED", $"jobId={job.Id} code={error.ErrorCode}");
        }
        AppLog.Info("PRINT_EXECUTE_RESULT", $"jobId={job.Id} attempt={started.AttemptNo} outcome={finalState} bytes={result.BytesWritten}");
    }

    private async Task<PreparedArtifact> DownloadBinaryWithKeepAliveAsync(
        string bearer,
        ClaimedPrintJob job,
        Func<CancellationToken, Task> heartbeatDuringDownload,
        CancellationToken cancellationToken)
    {
        var leaseVersion = job.LeaseVersion;
        TerminalApiException? lastError = null;
        var cacheDirectory = Path.Combine(SettingsService.RootDirectory, "cache", "print-artifacts");
        for (var retryCount = 0; retryCount < 3; retryCount++)
        {
            if (retryCount > 0)
            {
                var renewed = await _api.ExtendLeaseAsync(
                    bearer,
                    job with { LeaseVersion = leaseVersion },
                    cancellationToken);
                leaseVersion = renewed.LeaseVersion;
            }
            var startedAt = DateTimeOffset.UtcNow;
            AppLog.Info("PRINT_ARTIFACT_DOWNLOAD_STARTED", $"jobId={job.Id} bytes={job.RenderedPayloadByteLength} retryCount={retryCount}");
            try
            {
                using var attemptCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var download = _api.DownloadArtifactAsync(
                    bearer,
                    job,
                    cacheDirectory,
                    retryCount,
                    attemptCancellation.Token);
                try
                {
                    while (!download.IsCompleted)
                    {
                        var completed = await Task.WhenAny(
                            download,
                            Task.Delay(TimeSpan.FromSeconds(15), cancellationToken));
                        if (completed == download) break;
                        await heartbeatDuringDownload(cancellationToken);
                        var renewed = await _api.ExtendLeaseAsync(
                            bearer,
                            job with { LeaseVersion = leaseVersion },
                            cancellationToken);
                        leaseVersion = renewed.LeaseVersion;
                    }
                }
                catch
                {
                    attemptCancellation.Cancel();
                    try { await download; } catch { }
                    throw;
                }
                var artifact = await download;
                AppLog.Info("PRINT_ARTIFACT_DOWNLOAD_COMPLETED", $"jobId={job.Id} bytes={artifact.ByteLength} durationMs={(DateTimeOffset.UtcNow - startedAt).TotalMilliseconds:F0} shaStatus=MATCH retryCount={retryCount}");
                return new PreparedArtifact(artifact, leaseVersion);
            }
            catch (TerminalApiException error)
            {
                lastError = error;
                AppLog.Warn("PRINT_ARTIFACT_DOWNLOAD_FAILED", $"jobId={job.Id} bytes={job.RenderedPayloadByteLength} durationMs={(DateTimeOffset.UtcNow - startedAt).TotalMilliseconds:F0} shaStatus={error.ErrorCode} retryCount={retryCount}");
                if (error.ErrorCode is not ("NETWORK_IO_ERROR" or "PAYLOAD_LENGTH_MISMATCH"))
                    throw new ArtifactDownloadException(error, leaseVersion);
            }
        }
        throw new ArtifactDownloadException(
            lastError ?? new TerminalApiException(0, "NETWORK_IO_ERROR", "Artifact download failed."),
            leaseVersion);
    }

    private async Task ReportOrQueueAsync(
        string bearer,
        PendingPrintReport report,
        ExecutionEntry ledgerEntry,
        CancellationToken cancellationToken)
    {
        try
        {
            await SendReportAsync(bearer, report, cancellationToken);
            await _ledger.UpdateAsync(ledgerEntry with { ServerReported = true }, cancellationToken);
            await _pendingReports.RemoveAsync(report.JobId, report.AttemptNo, cancellationToken);
        }
        catch (Exception error) when (error is TerminalApiException or HttpRequestException or OperationCanceledException)
        {
            await _pendingReports.AddAsync(report, CancellationToken.None);
            AppLog.Warn("PRINT_REPORT_PENDING", $"jobId={report.JobId} attempt={report.AttemptNo}");
        }
    }

    private async Task RecoverPendingReportsAsync(string bearer, string merchantId, CancellationToken cancellationToken)
    {
        foreach (var report in (await _pendingReports.ReadAsync(cancellationToken)).Where(value => value.MerchantId == merchantId))
        {
            try
            {
                await SendReportAsync(bearer, report, cancellationToken);
                await _pendingReports.RemoveAsync(report.JobId, report.AttemptNo, cancellationToken);
                AppLog.Info("PRINT_REPORT_RECOVERED", $"jobId={report.JobId} attempt={report.AttemptNo}");
            }
            catch (TerminalApiException) { break; }
        }
    }

    private Task SendReportAsync(string bearer, PendingPrintReport report, CancellationToken cancellationToken)
    {
        var job = new ClaimedPrintJob(
            report.JobId, report.MerchantId, report.PrinterId, "PRINTING", report.ReceiptType,
            report.Source, report.AttemptNo - 1, report.AttemptNo, report.LeaseVersion,
            DateTimeOffset.UtcNow.AddMinutes(1), report.ContentHash, report.Route, report.Adapter,
            "ESC_POS_RASTER_V1", "YQ_CANONICAL_RECEIPT_V1",
            report.RenderedPayloadSha256 ?? string.Empty, Math.Max(1, report.BytesWritten),
            null, null, "BINARY_PRINT_ARTIFACT_V1", $"/terminal/jobs/{report.JobId}/artifact");
        return report.State == ExecutionState.Succeeded
            ? _api.ReportSucceededAsync(bearer, job, report.AttemptNo, report.LeaseVersion, report.BytesWritten, cancellationToken)
            : _api.ReportFailedAsync(bearer, job, report.AttemptNo, report.LeaseVersion, report.BytesWritten,
                report.State == ExecutionState.Uncertain, report.Retryable, report.ErrorCode ?? "UNKNOWN", report.ErrorMessage ?? "Local print failure", cancellationToken);
    }

    private static PendingPrintReport CreatePending(
        ClaimedPrintJob job,
        int attemptNo,
        long leaseVersion,
        TransportResult result,
        ExecutionState state) => new(
            job.Id, job.MerchantId, job.PrinterId, job.ReceiptType, job.Source, job.ContentHash,
            job.Route, job.Adapter, attemptNo, leaseVersion, result.BytesWritten, state,
            result.Retryable, result.ErrorCode, result.ErrorMessage, DateTimeOffset.UtcNow,
            job.RenderedPayloadSha256);

    private static IPrinterTransport ResolveTransport(LocalPrinterProfile profile) => profile.Transport switch
    {
        PrinterTransportKind.WindowsSpooler when !string.IsNullOrWhiteSpace(profile.WindowsPrinterName) => new WindowsSpoolerTransport(profile.WindowsPrinterName),
        PrinterTransportKind.Lan when !string.IsNullOrWhiteSpace(profile.Host) => new TcpPrinterTransport(profile.Host, profile.Port),
        _ => new MissingTransport(),
    };

    private static bool ProfileReady(LocalPrinterProfile profile) => profile.Transport switch
    {
        PrinterTransportKind.WindowsSpooler => !string.IsNullOrWhiteSpace(profile.WindowsPrinterName),
        PrinterTransportKind.Lan => profile.Host is not null && TcpPrinterTransport.TryPrivateIpv4(profile.Host, out _),
        _ => false,
    };

    private void SetStatus(string value)
    {
        if (string.Equals(_lastStatus, value, StringComparison.Ordinal)) return;
        _lastStatus = value;
        StatusChanged?.Invoke(this, value);
        AppLog.Info("CONNECTOR_STATUS", value);
    }

    private async Task StopUnsafeAsync()
    {
        if (_runCancellation is null) return;
        _runCancellation.Cancel();
        try { if (_runTask is not null) await _runTask; } catch (OperationCanceledException) { }
        _runCancellation.Dispose();
        _runCancellation = null;
        _runTask = null;
    }

    public async ValueTask DisposeAsync()
    {
        await _sessionGate.WaitAsync();
        try { await StopUnsafeAsync(); }
        finally { _sessionGate.Release(); }
        _sessionGate.Dispose();
        _settingsRefresh.Dispose();
        _api.Dispose();
    }

    private sealed class MissingTransport : IPrinterTransport
    {
        public Task<TransportResult> SendAsync(ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken) =>
            Task.FromResult(TransportResult.Failure("CONFIG_INVALID", "Printer configuration is incomplete.", false));
    }

    private sealed record PreparedArtifact(
        DownloadedPrintArtifact Artifact,
        long LeaseVersion);

    private sealed class ArtifactDownloadException(
        TerminalApiException apiError,
        long leaseVersion) : Exception(apiError.Message, apiError)
    {
        public TerminalApiException ApiError { get; } = apiError;
        public long LeaseVersion { get; } = leaseVersion;
    }
}
