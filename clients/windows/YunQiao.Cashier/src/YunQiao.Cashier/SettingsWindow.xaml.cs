using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using YunQiao.Cashier.Core.Printing;
using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Logging;
using YunQiao.Cashier.Printing;
using YunQiao.Cashier.Settings;

namespace YunQiao.Cashier;

public partial class SettingsWindow : Window
{
    private readonly SettingsService _settingsService;
    private readonly TestPrintService _testPrintService;
    private readonly ObservableCollection<LocalPrinterProfile> _profiles = [];
    private AppSettings? _settings;

    public SettingsWindow(SettingsService settingsService, TestPrintService testPrintService)
    {
        _settingsService = settingsService;
        _testPrintService = testPrintService;
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        TransportBox.ItemsSource = Enum.GetValues<PrinterTransportKind>();
        PaperBox.ItemsSource = Enum.GetValues<PrintPaperWidth>();
        RoleBox.ItemsSource = new[] { "FRONT_DESK", "KITCHEN", "BAR", "LABEL" };
        try { WindowsPrinterBox.ItemsSource = WindowsSpoolerTransport.InstalledPrinterNames(); }
        catch (Exception error) { AppLog.Error("PRINTER_ENUM_FAILED", error); }
        _settings = await _settingsService.LoadAsync();
        foreach (var profile in _settings.Printers) _profiles.Add(profile);
        ProfilesList.ItemsSource = _profiles;
        ProfilesList.SelectedIndex = 0;
    }

    private void ProfilesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ProfilesList.SelectedItem is not LocalPrinterProfile value) return;
        EnabledBox.IsChecked = value.Enabled;
        DisplayNameBox.Text = value.DisplayName;
        TransportBox.SelectedItem = value.Transport;
        WindowsPrinterBox.Text = value.WindowsPrinterName ?? string.Empty;
        HostBox.Text = value.Host ?? string.Empty;
        PortBox.Text = value.Port.ToString();
        PaperBox.SelectedItem = value.PaperWidth;
        RoleBox.SelectedItem = value.Role;
        var windows = value.Transport == PrinterTransportKind.WindowsSpooler;
        WindowsPrinterBox.IsEnabled = windows;
        HostBox.IsEnabled = PortBox.IsEnabled = !windows;
    }

    private void ApplyEditor_Click(object sender, RoutedEventArgs e) => ApplyEditor();

    private bool ApplyEditor()
    {
        if (ProfilesList.SelectedItem is not LocalPrinterProfile current) return false;
        if (string.IsNullOrWhiteSpace(DisplayNameBox.Text) || DisplayNameBox.Text.Trim().Length > 80)
        {
            ResultText.Text = "请输入 1–80 字符的打印机名称。";
            return false;
        }
        if (!int.TryParse(PortBox.Text, out var port) || port is < 1 or > 65_535)
        {
            ResultText.Text = "LAN Port 必须为 1–65535。";
            return false;
        }
        var transport = (PrinterTransportKind)(TransportBox.SelectedItem ?? current.Transport);
        var host = HostBox.Text.Trim();
        if (transport == PrinterTransportKind.Lan && !TcpPrinterTransport.TryPrivateIpv4(host, out _))
        {
            ResultText.Text = "LAN IP 必须是私有 IPv4 地址。";
            return false;
        }
        var enabled = EnabledBox.IsChecked == true;
        if (enabled && transport == PrinterTransportKind.WindowsSpooler && string.IsNullOrWhiteSpace(WindowsPrinterBox.Text))
        {
            ResultText.Text = "请选择 Windows 已安装的打印机。";
            return false;
        }
        var updated = current with
        {
            DisplayName = DisplayNameBox.Text.Trim(),
            Enabled = enabled,
            WindowsPrinterName = transport == PrinterTransportKind.WindowsSpooler ? WindowsPrinterBox.Text.Trim() : null,
            Host = transport == PrinterTransportKind.Lan ? host : null,
            Port = port,
            PaperWidth = (PrintPaperWidth)(PaperBox.SelectedItem ?? PrintPaperWidth.MM80),
            Role = (string)(RoleBox.SelectedItem ?? "FRONT_DESK"),
        };
        var index = _profiles.IndexOf(current);
        _profiles[index] = updated;
        ProfilesList.SelectedIndex = index;
        ResultText.Text = "当前编辑已应用。";
        return true;
    }

    private void AddWindows_Click(object sender, RoutedEventArgs e) => AddProfile(PrinterTransportKind.WindowsSpooler, "Windows 打印机");
    private void AddLan_Click(object sender, RoutedEventArgs e) => AddProfile(PrinterTransportKind.Lan, "LAN 打印机");

    private void AddProfile(PrinterTransportKind transport, string name)
    {
        if (_profiles.Count >= 16) { ResultText.Text = "最多配置 16 个本地打印机条目。"; return; }
        var profile = new LocalPrinterProfile(
            $"windows-{Guid.NewGuid():N}", name, transport, PrintPaperWidth.MM80, "FRONT_DESK", false,
            Port: 9100);
        _profiles.Add(profile);
        ProfilesList.SelectedItem = profile;
    }

    private void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (ProfilesList.SelectedItem is not LocalPrinterProfile selected || _profiles.Count <= 1) return;
        _profiles.Remove(selected);
        ProfilesList.SelectedIndex = 0;
    }

    private async void TestPrint_Click(object sender, RoutedEventArgs e)
    {
        if (!ApplyEditor() || ProfilesList.SelectedItem is not LocalPrinterProfile profile) return;
        ResultText.Text = "正在发送测试打印…";
        try
        {
            var result = await _testPrintService.PrintAsync(profile, CancellationToken.None);
            ResultText.Text = result.Outcome == TransportOutcome.Succeeded
                ? $"测试数据已发送：{result.BytesWritten} bytes（请继续检查实际出纸）"
                : $"测试失败：{result.ErrorCode} {result.ErrorMessage}";
        }
        catch (Exception error)
        {
            AppLog.Error("TEST_PRINT_FAILED", error);
            ResultText.Text = $"测试失败：{error.GetType().Name}";
        }
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!ApplyEditor() || _settings is null) return;
        if (_profiles.Count(value => value.Enabled && value.Transport == PrinterTransportKind.WindowsSpooler) > 1)
        {
            ResultText.Text = "当前后端协议每台终端只允许启用一个 Windows/USB binding；其余请使用 LAN。";
            return;
        }
        try
        {
            await _settingsService.SaveAsync(_settings with { Printers = _profiles.ToArray() });
            DialogResult = true;
        }
        catch (Exception error)
        {
            AppLog.Error("SETTINGS_SAVE_FAILED", error);
            ResultText.Text = "设置保存失败，请查看日志。";
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
}
