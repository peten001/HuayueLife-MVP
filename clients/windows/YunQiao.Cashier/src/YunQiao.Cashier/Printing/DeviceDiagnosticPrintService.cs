using YunQiao.Cashier.Core.Printing;
using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Printing;

/// <summary>Operator-initiated device diagnostic only; never used by ConnectorService.</summary>
public sealed class DeviceDiagnosticPrintService(DiagnosticTestPrintRasterBuilder renderer)
{
    public async Task<TransportResult> PrintAsync(LocalPrinterProfile profile, CancellationToken cancellationToken)
    {
        var document = new PrintDocument(
            3,
            profile.PaperWidth,
            1,
            [
                new PrintBlock.Text("YUNQIAO TEST PRINT", PrintAlignment.CENTER, true, PrintFontSize.LARGE, false, PrintColumnOverflow.FIT),
                new PrintBlock.Divider(),
                new PrintBlock.Text("云桥 · 结账单 · 厨房 · 桌号08", PrintAlignment.LEFT, true, PrintFontSize.NORMAL, false, null),
                new PrintBlock.Text("Cơm rang · Bún xào · Mì xào", PrintAlignment.LEFT, false, PrintFontSize.NORMAL, false, null),
                new PrintBlock.Text("Đã thanh toán · Giao hàng", PrintAlignment.LEFT, false, PrintFontSize.NORMAL, false, null),
                new PrintBlock.Text("Tự lấy tại cửa hàng · 123.456 ₫", PrintAlignment.LEFT, false, PrintFontSize.NORMAL, false, null),
                new PrintBlock.Row($"ROLE {profile.Role}", profile.PaperWidth.ToString(), false),
                new PrintBlock.Cut(PrintCutMode.HALF),
            ]);
        var bytes = renderer.Render(document).EscPosBytes;
        IPrinterTransport transport = profile.Transport switch
        {
            PrinterTransportKind.WindowsSpooler when !string.IsNullOrWhiteSpace(profile.WindowsPrinterName) => new WindowsSpoolerTransport(profile.WindowsPrinterName),
            PrinterTransportKind.Lan when !string.IsNullOrWhiteSpace(profile.Host) => new TcpPrinterTransport(profile.Host, profile.Port),
            _ => new InvalidTransport(),
        };
        return await transport.SendAsync(bytes, cancellationToken);
    }

    private sealed class InvalidTransport : IPrinterTransport
    {
        public Task<TransportResult> SendAsync(ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken) =>
            Task.FromResult(TransportResult.Failure("CONFIG_INVALID", "Printer configuration is incomplete.", false));
    }
}
