using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using YunQiao.Cashier.Core.Printing;
using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Logging;
using YunQiao.Cashier.Printing;
using YunQiao.Cashier.Settings;

namespace YunQiao.Cashier;

public partial class SettingsWindow : Window
{
    private static readonly Choice<PrintPaperWidth>[] PaperChoices =
    [
        new(PrintPaperWidth.MM58, "58mm 小票纸"),
        new(PrintPaperWidth.MM80, "80mm 小票纸"),
    ];

    private static readonly Choice<string>[] UsageChoices =
    [
        new("FRONT_DESK", "前台收银"),
        new("KITCHEN", "后厨"),
        new("BAR", "水吧"),
        new("LABEL", "标签打印"),
    ];

    private readonly SettingsService _settingsService;
    private readonly DeviceDiagnosticPrintService _testPrintService;
    private readonly ObservableCollection<LocalPrinterProfile> _profiles = [];
    private AppSettings? _settings;
    private LocalPrinterProfile? _selectedProfile;
    private bool _loadingEditor;
    private bool _printerEnumerationFailed;

    public SettingsWindow(SettingsService settingsService, DeviceDiagnosticPrintService testPrintService)
    {
        _settingsService = settingsService;
        _testPrintService = testPrintService;
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        FitToWorkArea();
        PaperBox.ItemsSource = PaperChoices;
        PaperBox.DisplayMemberPath = nameof(Choice<PrintPaperWidth>.Label);
        PaperBox.SelectedValuePath = nameof(Choice<PrintPaperWidth>.Value);
        RoleBox.ItemsSource = UsageChoices;
        RoleBox.DisplayMemberPath = nameof(Choice<string>.Label);
        RoleBox.SelectedValuePath = nameof(Choice<string>.Value);

        try { WindowsPrinterBox.ItemsSource = WindowsSpoolerTransport.InstalledPrinterNames(); }
        catch (Exception error)
        {
            _printerEnumerationFailed = true;
            AppLog.Error("PRINTER_ENUM_FAILED", error);
        }

        try
        {
            _settings = await _settingsService.LoadAsync();
            foreach (var profile in _settings.Printers) _profiles.Add(profile);
            ProfilesList.ItemsSource = _profiles;
            UpdateProfileCount();
            ProfilesList.SelectedIndex = 0;
            if (_printerEnumerationFailed)
                ShowResult(ResultKind.Warning, "无法读取打印机", "请确认 Windows 打印服务正常后重试");
        }
        catch (Exception error)
        {
            AppLog.Error("SETTINGS_LOAD_FAILED", error);
            ShowResult(ResultKind.Danger, "无法读取打印设备", "请关闭此窗口后重试");
        }
    }

    private void FitToWorkArea()
    {
        var workArea = SystemParameters.WorkArea;
        MaxWidth = Math.Max(MinWidth, workArea.Width - 24);
        MaxHeight = Math.Max(MinHeight, workArea.Height - 24);
        Width = Math.Min(Width, MaxWidth);
        Height = Math.Min(Height, MaxHeight);
        if (Owner is not null)
        {
            var centeredLeft = Owner.Left + (Owner.ActualWidth - Width) / 2;
            var centeredTop = Owner.Top + (Owner.ActualHeight - Height) / 2;
            Left = Math.Clamp(centeredLeft, workArea.Left, Math.Max(workArea.Left, workArea.Right - Width));
            Top = Math.Clamp(centeredTop, workArea.Top, Math.Max(workArea.Top, workArea.Bottom - Height));
        }
    }

    private void ProfilesList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loadingEditor) return;
        var next = ProfilesList.SelectedItem as LocalPrinterProfile;
        if (_selectedProfile is not null && next != _selectedProfile && _profiles.Contains(_selectedProfile))
        {
            if (!TryApplyEditor(_selectedProfile, announce: false, selectUpdated: false))
            {
                _loadingEditor = true;
                ProfilesList.SelectedItem = _selectedProfile;
                _loadingEditor = false;
                return;
            }
        }
        _selectedProfile = next;
        if (next is not null) LoadEditor(next);
    }

    private void LoadEditor(LocalPrinterProfile value)
    {
        _loadingEditor = true;
        EnabledBox.IsChecked = value.Enabled;
        DisplayNameBox.Text = value.DisplayName;
        WindowsPrinterBox.Text = value.WindowsPrinterName ?? string.Empty;
        HostBox.Text = value.Host ?? string.Empty;
        PortBox.Text = value.Port.ToString();
        PaperBox.SelectedValue = value.PaperWidth;
        RoleBox.SelectedValue = value.Role;
        EditorTitleText.Text = value.DisplayName;

        var usb = value.Transport == PrinterTransportKind.WindowsSpooler;
        ConnectionTypeText.Text = usb ? "USB 打印机" : "网络打印机";
        UsbPrinterFields.Visibility = usb ? Visibility.Visible : Visibility.Collapsed;
        NetworkPrinterFields.Visibility = usb ? Visibility.Collapsed : Visibility.Visible;
        _loadingEditor = false;
    }

    private bool TryApplySelected(bool announce = false)
    {
        return _selectedProfile is not null
            && TryApplyEditor(_selectedProfile, announce, selectUpdated: true);
    }

    private bool TryApplyEditor(LocalPrinterProfile current, bool announce, bool selectUpdated)
    {
        var displayName = DisplayNameBox.Text.Trim();
        if (displayName.Length is < 1 or > 80)
        {
            ShowResult(ResultKind.Danger, "请输入设备名称", "设备名称应为 1–80 个字符");
            return false;
        }

        var host = HostBox.Text.Trim();
        var port = current.Port;
        if (current.Transport == PrinterTransportKind.Lan)
        {
            if (!TcpPrinterTransport.TryPrivateIpv4(host, out _))
            {
                ShowResult(ResultKind.Danger, "打印机 IP 无效", "请输入局域网地址，例如 192.168.1.120");
                return false;
            }
            if (!int.TryParse(PortBox.Text, out port) || port is < 1 or > 65_535)
            {
                ShowResult(ResultKind.Danger, "端口无效", "请输入 1–65535 之间的端口号");
                return false;
            }
        }

        var enabled = EnabledBox.IsChecked == true;
        var windowsPrinter = WindowsPrinterBox.Text.Trim();
        if (enabled && current.Transport == PrinterTransportKind.WindowsSpooler && string.IsNullOrWhiteSpace(windowsPrinter))
        {
            ShowResult(ResultKind.Danger, "请选择打印机", "请选择这台电脑已经安装的打印机");
            return false;
        }

        var paper = PaperBox.SelectedValue is PrintPaperWidth selectedPaper
            ? selectedPaper
            : PrintPaperWidth.MM80;
        var usage = RoleBox.SelectedValue as string ?? "FRONT_DESK";
        var updated = current with
        {
            DisplayName = displayName,
            Enabled = enabled,
            WindowsPrinterName = current.Transport == PrinterTransportKind.WindowsSpooler ? windowsPrinter : null,
            Host = current.Transport == PrinterTransportKind.Lan ? host : null,
            Port = port,
            PaperWidth = paper,
            Role = usage,
        };

        var index = _profiles.IndexOf(current);
        if (index < 0) return false;
        _loadingEditor = true;
        _profiles[index] = updated;
        if (selectUpdated)
        {
            ProfilesList.SelectedItem = updated;
            _selectedProfile = updated;
        }
        _loadingEditor = false;
        EditorTitleText.Text = updated.DisplayName;
        if (announce) ShowResult(ResultKind.Success, "修改已应用");
        return true;
    }

    private void AddWindows_Click(object sender, RoutedEventArgs e) => AddProfile(PrinterTransportKind.WindowsSpooler, "USB 打印机");
    private void AddLan_Click(object sender, RoutedEventArgs e) => AddProfile(PrinterTransportKind.Lan, "网络打印机");

    private void AddProfile(PrinterTransportKind transport, string name)
    {
        if (_selectedProfile is not null && !TryApplySelected()) return;
        if (_profiles.Count >= 16)
        {
            ShowResult(ResultKind.Warning, "无法继续添加", "最多可以添加 16 台打印设备");
            return;
        }

        var profile = new LocalPrinterProfile(
            $"windows-{Guid.NewGuid():N}", name, transport, PrintPaperWidth.MM80, "FRONT_DESK", false,
            Port: 9100);
        _profiles.Add(profile);
        UpdateProfileCount();
        ProfilesList.SelectedItem = profile;
        ProfilesList.ScrollIntoView(profile);
    }

    private void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedProfile is null) return;
        if (_profiles.Count <= 1)
        {
            ShowResult(ResultKind.Warning, "无法删除", "至少需要保留一台打印设备");
            return;
        }

        var result = MessageBox.Show(
            $"确定删除“{_selectedProfile.DisplayName}”吗？",
            "删除打印设备",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);
        if (result != MessageBoxResult.Yes) return;

        var index = _profiles.IndexOf(_selectedProfile);
        _loadingEditor = true;
        _profiles.Remove(_selectedProfile);
        _selectedProfile = _profiles[Math.Min(index, _profiles.Count - 1)];
        ProfilesList.SelectedItem = _selectedProfile;
        _loadingEditor = false;
        LoadEditor(_selectedProfile);
        UpdateProfileCount();
        ShowResult(ResultKind.Success, "打印设备已删除");
    }

    private async void TestPrint_Click(object sender, RoutedEventArgs e)
    {
        if (!TryApplySelected() || _selectedProfile is null) return;
        TestPrintButton.IsEnabled = false;
        TestPrintButton.Content = "正在发送…";
        ShowResult(ResultKind.Info, "正在发送测试打印");
        try
        {
            var result = await _testPrintService.PrintAsync(_selectedProfile, CancellationToken.None);
            if (result.Outcome == TransportOutcome.Succeeded)
            {
                ShowResult(ResultKind.Success, "测试打印已发送", "请确认打印机已正常出纸");
            }
            else
            {
                AppLog.Warn("TEST_PRINT_NOT_SENT", $"outcome={result.Outcome} code={result.ErrorCode}");
                ShowResult(ResultKind.Danger, "打印失败", "请检查打印机连接后重试");
            }
        }
        catch (Exception error)
        {
            AppLog.Error("TEST_PRINT_FAILED", error);
            ShowResult(ResultKind.Danger, "打印失败", "请检查打印机连接后重试");
        }
        finally
        {
            TestPrintButton.Content = "测试打印";
            TestPrintButton.IsEnabled = true;
        }
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!TryApplySelected() || _settings is null) return;
        if (_profiles.Count(value => value.Enabled && value.Transport == PrinterTransportKind.WindowsSpooler) > 1)
        {
            ShowResult(ResultKind.Danger, "只能启用一台 USB 打印机", "如需连接更多打印机，请将其他设备设为网络打印机");
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
            ShowResult(ResultKind.Danger, "保存失败", "请稍后重试；如果问题持续，请联系服务人员");
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;

    private void UpdateProfileCount() => ProfilesCountText.Text = $"{_profiles.Count} 台";

    private void ShowResult(ResultKind kind, string title, string? detail = null)
    {
        var (backgroundKey, foregroundKey) = kind switch
        {
            ResultKind.Success => ("SuccessSoftBrush", "SuccessBrush"),
            ResultKind.Warning => ("WarningSoftBrush", "WarningBrush"),
            ResultKind.Danger => ("DangerSoftBrush", "DangerBrush"),
            _ => ("PrimarySoftBrush", "PrimaryPressedBrush"),
        };
        ResultBanner.Background = (Brush)FindResource(backgroundKey);
        ResultTitleText.Foreground = (Brush)FindResource(foregroundKey);
        ResultTitleText.Text = title;
        ResultText.Text = detail ?? string.Empty;
        ResultText.Visibility = string.IsNullOrWhiteSpace(detail) ? Visibility.Collapsed : Visibility.Visible;
        ResultBanner.Visibility = Visibility.Visible;
    }

    private sealed record Choice<T>(T Value, string Label);

    private enum ResultKind
    {
        Info,
        Success,
        Warning,
        Danger,
    }
}
