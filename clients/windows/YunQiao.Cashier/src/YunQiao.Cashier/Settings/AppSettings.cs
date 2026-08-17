using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Settings;

public sealed record WindowPreferences(bool Maximized = true, double Width = 1280, double Height = 800);

public sealed record AppSettings(
    string TerminalInstanceId,
    IReadOnlyList<LocalPrinterProfile> Printers,
    WindowPreferences Window)
{
    public static AppSettings CreateDefault() => new(
        Guid.NewGuid().ToString(),
        [new LocalPrinterProfile(
            "windows-front-desk",
            "Windows 前台打印机",
            PrinterTransportKind.WindowsSpooler,
            PrintPaperWidth.MM80,
            "FRONT_DESK",
            false)],
        new WindowPreferences());
}
