using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Printing;

namespace YunQiao.Cashier.Windows.Tests;

public sealed class DiagnosticTestPrintRasterBuilderTests
{
    [Fact]
    public void RendersChineseVietnameseAmountsAndAndroidEscPosEnvelope()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                var document = new PrintDocument(
                    3,
                    PrintPaperWidth.MM58,
                    1,
                    [
                        new PrintBlock.Text("云桥 结账单 厨房 桌号08", PrintAlignment.CENTER, true, PrintFontSize.LARGE, false, PrintColumnOverflow.FIT),
                        new PrintBlock.Text("Cơm rang · Bún xào · Mì xào", PrintAlignment.LEFT, false, PrintFontSize.NORMAL, false, null),
                        new PrintBlock.Text("Đã thanh toán · Giao hàng", PrintAlignment.LEFT, false, PrintFontSize.NORMAL, false, null),
                        new PrintBlock.Text("Tự lấy tại cửa hàng · 123.456 ₫", PrintAlignment.LEFT, false, PrintFontSize.NORMAL, false, null),
                        new PrintBlock.Cut(PrintCutMode.HALF),
                    ]);

                var result = new DiagnosticTestPrintRasterBuilder().Render(document);

                Assert.Equal(384, result.Width);
                Assert.InRange(result.Height, 1, 8_000);
                Assert.Contains(result.BgraPixels.Chunk(4), pixel => pixel[0] < 160 && pixel[1] < 160 && pixel[2] < 160);
                Assert.Equal(new byte[] { 0x1b, 0x40, 0x1b, 0x61, 0x01 }, result.EscPosBytes[..5]);
                Assert.Equal(new byte[] { 0x1d, 0x56, 0x01 }, result.EscPosBytes[^3..]);
            }
            catch (Exception error) { failure = error; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(10)), "WPF renderer test timed out.");
        if (failure is not null) throw failure;
    }

}
