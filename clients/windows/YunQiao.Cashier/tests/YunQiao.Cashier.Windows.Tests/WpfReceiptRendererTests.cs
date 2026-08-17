using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Printing;

namespace YunQiao.Cashier.Windows.Tests;

public sealed class WpfReceiptRendererTests
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

                var result = new WpfReceiptRenderer().Render(document);

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

    [Fact]
    public void RendersLegacySchemaOneWithAndroidHalfCutFallback()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                const string json = """
                    {"schemaVersion":1,"receiptType":"ORDER_CUSTOMER","generatedAt":"2026-08-17T12:00:00Z",
                     "merchant":{"id":"4","name":"云桥餐厅","nameVi":"Nhà hàng YunQiao","address":null,"phone":null},
                     "order":{"id":"8","orderNo":"YQ-8","orderType":"DINE_IN","tableName":"桌号08","guestCount":2,"createdAt":"2026-08-17T11:30:00Z","completedAt":null},
                     "tableSession":null,
                     "items":[{"name":"炒饭","nameVi":"Cơm rang","nameEn":null,"quantity":1,"unitPrice":50000,"lineTotal":50000,"specification":null,"note":"少辣"}],
                     "totals":{"subtotal":50000,"discount":null,"originalAmount":null,"roundingAmount":null,"receivedAmount":50000,"serviceFee":null,"total":50000,"currency":"VND"},
                     "note":"Đã thanh toán","verificationCode":null,"footer":null}
                    """;
                var receipt = ReceiptDocumentV1Parser.Parse(json);
                var result = new WpfReceiptRenderer().RenderLegacy(receipt, PrintPaperWidth.MM80, DateTimeOffset.Parse("2026-08-17T12:01:00Z"));
                Assert.Equal(576, result.Width);
                Assert.Equal(new byte[] { 0x1d, 0x56, 0x01 }, result.EscPosBytes[^3..]);
                Assert.Contains(result.BgraPixels.Chunk(4), pixel => pixel[0] < 160 && pixel[1] < 160 && pixel[2] < 160);
            }
            catch (Exception error) { failure = error; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(10)), "Legacy WPF renderer test timed out.");
        if (failure is not null) throw failure;
    }
}
