using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using YunQiao.Cashier.Logging;
using YunQiao.Cashier.Settings;

namespace YunQiao.Cashier.Web;

public sealed class WebViewHost
{
    private readonly WebView2 _view;
    public event EventHandler? OpenPrinterDevicesRequested;
    public event EventHandler? SessionChanged;
    public event EventHandler? SignedOut;
    public event EventHandler<string>? StatusChanged;

    public WebViewHost(WebView2 view) => _view = view;

    public async Task InitializeAsync()
    {
        var profile = Path.Combine(SettingsService.RootDirectory, "WebView2");
        Directory.CreateDirectory(profile);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
        await _view.EnsureCoreWebView2Async(environment);
        var core = _view.CoreWebView2;
        core.Settings.UserAgent = OriginPolicy.UserAgentCompatibility;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        await core.AddScriptToExecuteOnDocumentCreatedAsync(AndroidBridgeCompatibility.InjectionScript);

        core.NavigationStarting += OnNavigationStarting;
        core.NavigationCompleted += OnNavigationCompleted;
        core.NewWindowRequested += OnNewWindowRequested;
        core.WebMessageReceived += OnWebMessageReceived;
        core.ProcessFailed += (_, args) =>
        {
            AppLog.Warn("WEBVIEW_PROCESS_FAILED", $"kind={args.ProcessFailedKind}");
            StatusChanged?.Invoke(this, "WebView2 进程异常，请刷新页面");
        };
        core.Navigate(OriginPolicy.CashierUri.AbsoluteUri);
        AppLog.Info("WEBVIEW_INITIALIZED", $"runtime={core.Environment.BrowserVersionString}");
    }

    public void Reload() => _view.CoreWebView2?.Reload();

    public async Task<string?> ReadMerchantAccessTokenAsync()
    {
        if (_view.CoreWebView2 is null || !OriginPolicy.IsTrustedTopLevel(_view.Source?.AbsoluteUri)) return null;
        const string script = """
            (() => {
              const key = 'yunqiao_cashier_access_token';
              const value = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
              return typeof value === 'string' && value.length >= 24 && value.length <= 4096 ? value : null;
            })()
            """;
        var encoded = await _view.CoreWebView2.ExecuteScriptAsync(script);
        if (encoded == "null") return null;
        try { return JsonSerializer.Deserialize<string>(encoded); }
        catch (JsonException) { return null; }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (OriginPolicy.IsTrustedTopLevel(e.Uri))
        {
            StatusChanged?.Invoke(this, "正在连接云桥收银…");
            return;
        }
        e.Cancel = true;
        AppLog.Warn("NAVIGATION_BLOCKED", Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) ? $"host={uri.Host}" : "invalid-uri");
        if (OriginPolicy.IsHttp(e.Uri)) OpenExternal(e.Uri);
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        var status = e.IsSuccess ? "云桥收银已连接" : $"页面连接失败：{e.WebErrorStatus}";
        StatusChanged?.Invoke(this, status);
        AppLog.Info("NAVIGATION_COMPLETED", $"success={e.IsSuccess} status={e.WebErrorStatus}");
        if (e.IsSuccess) SessionChanged?.Invoke(this, EventArgs.Empty);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (OriginPolicy.IsTrustedTopLevel(e.Uri)) _view.CoreWebView2.Navigate(e.Uri);
        else if (OriginPolicy.IsHttp(e.Uri)) OpenExternal(e.Uri);
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!OriginPolicy.IsTrustedTopLevel(_view.Source?.AbsoluteUri) || !OriginPolicy.IsTrustedTopLevel(e.Source)) return;
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var root = message.RootElement;
            var channel = root.GetProperty("channel").GetString();
            var payload = root.GetProperty("payload").GetString() ?? string.Empty;
            if (channel == "session" && AndroidBridgeCompatibility.IsSessionMessage(payload))
            {
                AppLog.Info("BRIDGE_SESSION", $"type={payload.Split(':')[0]}");
                if (payload == "SIGNED_OUT") SignedOut?.Invoke(this, EventArgs.Empty);
                else SessionChanged?.Invoke(this, EventArgs.Empty);
                return;
            }
            if (channel == "terminal" && AndroidBridgeCompatibility.IsOpenPrinterDevices(payload))
            {
                AppLog.Info("BRIDGE_TERMINAL", "type=OPEN_PRINTER_DEVICES");
                OpenPrinterDevicesRequested?.Invoke(this, EventArgs.Empty);
            }
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException)
        {
            AppLog.Warn("BRIDGE_REJECTED", error.GetType().Name);
        }
    }

    private static void OpenExternal(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch (Exception error) { AppLog.Error("EXTERNAL_NAVIGATION_FAILED", error); }
    }
}
