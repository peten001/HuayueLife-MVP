using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
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
            Width = Math.Max(MinWidth, _settings.Window.Width);
            Height = Math.Max(MinHeight, _settings.Window.Height);
            if (_settings.Window.Maximized) WindowState = WindowState.Maximized;

            _connector = new ConnectorService(_settingsService, _credentialStore, _api, _renderer);
            _connector.StatusChanged += (_, value) => Dispatcher.InvokeAsync(() => ConnectorStatusText.Text = value);
            _webHost = new WebViewHost(CashierWebView);
            _webHost.StatusChanged += (_, value) => Dispatcher.InvokeAsync(() => StatusText.Text = value);
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
            StatusText.Text = "启动失败，请查看日志";
            MessageBox.Show("云桥收银启动失败，请查看本地日志。", "云桥收银", MessageBoxButton.OK, MessageBoxImage.Error);
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

    private void Settings_Click(object sender, RoutedEventArgs e) => OpenSettings();

    private async void OpenSettings()
    {
        var dialog = new SettingsWindow(_settingsService, new TestPrintService(_renderer)) { Owner = this };
        if (dialog.ShowDialog() == true)
        {
            _settings = await _settingsService.LoadAsync();
            _ = _connector?.RefreshSettingsAsync();
            ConnectorStatusText.Text = "打印机设置已更新";
        }
    }

    private void Reload_Click(object sender, RoutedEventArgs e) => _webHost?.Reload();

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
