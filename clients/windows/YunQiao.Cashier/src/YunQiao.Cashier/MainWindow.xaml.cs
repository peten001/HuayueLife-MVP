using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Logging;
using YunQiao.Cashier.Printing;
using YunQiao.Cashier.Security;
using YunQiao.Cashier.Settings;
using YunQiao.Cashier.Web;

namespace YunQiao.Cashier;

public partial class MainWindow : Window
{
    private readonly SettingsService _settingsService = new();
    private readonly DpapiCredentialStore _credentialStore = new();
    private readonly WpfReceiptRenderer _renderer = new();
    private readonly TerminalApiClient _api = new();
    private readonly SemaphoreSlim _sessionRefresh = new(1, 1);
    private WebViewHost? _webHost;
    private ConnectorService? _connector;
    private AppSettings? _settings;
    private bool _closingPersisted;
    private bool _webReady;
    private bool _webFailed;
    private bool _connectorFailed;
    private bool _connectorPaused;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;
        Closed += OnClosed;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            _settings = await _settingsService.LoadAsync();
            var workArea = SystemParameters.WorkArea;
            Width = Math.Clamp(_settings.Window.Width, MinWidth, Math.Max(MinWidth, workArea.Width));
            Height = Math.Clamp(_settings.Window.Height, MinHeight, Math.Max(MinHeight, workArea.Height));
            if (_settings.Window.Maximized) WindowState = WindowState.Maximized;

            _connector = new ConnectorService(_settingsService, _credentialStore, _api, _renderer);
            _connector.StatusChanged += (_, value) => Dispatcher.InvokeAsync(() => UpdateConnectorStatus(value));
            _webHost = new WebViewHost(CashierWebView);
            _webHost.StatusChanged += (_, value) => Dispatcher.InvokeAsync(() => UpdateWebStatus(value));
            _webHost.OpenPrinterDevicesRequested += (_, _) => Dispatcher.InvokeAsync(OpenSettings);
            _webHost.SessionChanged += (_, _) => _ = RefreshSessionAsync();
            _webHost.SignedOut += (_, _) => _ = SetSignedOutAsync();
            await _webHost.InitializeAsync();
        }
        catch (WebView2RuntimeNotFoundException error)
        {
            AppLog.Error("WEBVIEW2_RUNTIME_MISSING", error);
            var result = MessageBox.Show(
                "此电脑缺少 Microsoft Edge WebView2 Runtime。是否立即打开微软安装程序？",
                "云桥收银",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (result == MessageBoxResult.Yes)
                Process.Start(new ProcessStartInfo("https://go.microsoft.com/fwlink/p/?LinkId=2124703") { UseShellExecute = true });
            Close();
        }
        catch (Exception error)
        {
            AppLog.Error("APP_INITIALIZATION_FAILED", error);
            ShowShellStatus("启动失败", "请重新打开云桥收银；如果问题持续，请联系服务人员", "DangerBrush", showReload: false);
            MessageBox.Show("云桥收银暂时无法启动。请重新打开应用；如果问题持续，请联系服务人员。", "云桥收银", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async Task RefreshSessionAsync()
    {
        if (_webHost is null || _connector is null) return;
        await _sessionRefresh.WaitAsync();
        try
        {
            var token = await Dispatcher.InvokeAsync(_webHost.ReadMerchantAccessTokenAsync).Task.Unwrap();
            await _connector.UpdateSessionAsync(token);
        }
        catch (Exception error) { AppLog.Error("SESSION_REFRESH_FAILED", error); }
        finally { _sessionRefresh.Release(); }
    }

    private async Task SetSignedOutAsync()
    {
        if (_connector is not null) await _connector.UpdateSessionAsync(null);
    }

    private async void OpenSettings()
    {
        var dialog = new SettingsWindow(_settingsService, new TestPrintService(_renderer)) { Owner = this };
        if (dialog.ShowDialog() == true)
        {
            _settings = await _settingsService.LoadAsync();
            _ = _connector?.RefreshSettingsAsync();
            _connectorFailed = false;
            _connectorPaused = false;
            RenderShellStatus();
        }
    }

    private void Reload_Click(object sender, RoutedEventArgs e)
    {
        _webFailed = false;
        _webReady = false;
        ShowShellStatus("正在重新连接…", null, "WarningBrush", showReload: false);
        _webHost?.Reload();
    }

    private void UpdateWebStatus(string value)
    {
        if (value.StartsWith("页面连接失败", StringComparison.Ordinal) || value.Contains("进程异常", StringComparison.Ordinal))
        {
            _webReady = false;
            _webFailed = true;
            ShowShellStatus("页面加载失败", "请检查网络连接后重试", "DangerBrush", showReload: true);
            return;
        }

        _webFailed = false;
        _webReady = value.Contains("已连接", StringComparison.Ordinal);
        if (!_webReady)
        {
            ShowShellStatus("正在连接…", null, "WarningBrush", showReload: false);
            return;
        }
        RenderShellStatus();
    }

    private void UpdateConnectorStatus(string value)
    {
        _connectorFailed = value.Contains("暂时不可用", StringComparison.Ordinal)
            || value.Contains("凭据失效", StringComparison.Ordinal)
            || value.Contains("身份冲突", StringComparison.Ordinal)
            || value.Contains("已停止", StringComparison.Ordinal);
        _connectorPaused = value.Contains("已暂停", StringComparison.Ordinal);
        RenderShellStatus();
    }

    private void RenderShellStatus()
    {
        if (_webFailed) return;
        if (!_webReady)
        {
            ShowShellStatus("正在连接…", null, "WarningBrush", showReload: false);
            return;
        }
        if (_connectorFailed)
        {
            ShowShellStatus("打印服务异常", "请检查网络连接或重新登录", "DangerBrush", showReload: false);
            return;
        }
        if (_connectorPaused)
        {
            ShowShellStatus("打印服务已暂停", "请在商家后台确认打印设置", "WarningBrush", showReload: false);
            return;
        }
        ShowShellStatus("设备正常", null, "SuccessBrush", showReload: false);
    }

    private void ShowShellStatus(string title, string? detail, string brushKey, bool showReload)
    {
        var brush = (Brush)FindResource(brushKey);
        StatusDot.Fill = brush;
        DeviceStatusText.Text = title;
        DeviceStatusText.Foreground = brush;
        StatusDetailText.Text = detail ?? string.Empty;
        StatusDetailText.Visibility = string.IsNullOrWhiteSpace(detail) ? Visibility.Collapsed : Visibility.Visible;
        ReloadButton.Visibility = showReload ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_closingPersisted) return;
        e.Cancel = true;
        var state = WindowState == WindowState.Maximized ? RestoreBounds : new Rect(Left, Top, ActualWidth, ActualHeight);
        try
        {
            var latest = await _settingsService.LoadAsync();
            _settings = latest with
            {
                Window = new WindowPreferences(WindowState == WindowState.Maximized, Math.Max(MinWidth, state.Width), Math.Max(MinHeight, state.Height)),
            };
            await _settingsService.SaveAsync(_settings);
        }
        catch (Exception error) { AppLog.Error("WINDOW_STATE_SAVE_FAILED", error); }
        finally
        {
            _closingPersisted = true;
            Close();
        }
    }

    private async void OnClosed(object? sender, EventArgs e)
    {
        if (_connector is not null) await _connector.DisposeAsync();
        _sessionRefresh.Dispose();
        AppLog.Info("APP_STOP");
    }
}
