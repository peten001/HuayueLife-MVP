using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Core.Tests;

public sealed class ReceiptDocumentV1ParserTests
{
    private const string LegacyReceipt = """
        {
          "schemaVersion":1,
          "receiptType":"ORDER_CUSTOMER",
          "generatedAt":"2026-08-17T12:00:00Z",
          "merchant":{"id":"4","name":"云桥餐厅","nameVi":"Nhà hàng YunQiao","address":null,"phone":null},
          "order":{"id":"8","orderNo":"YQ-0008","orderType":"DINE_IN","tableName":"桌号08","guestCount":2,"createdAt":"2026-08-17T11:30:00Z","completedAt":null},
          "tableSession":null,
          "items":[
            {"name":"炒饭","nameVi":"Cơm rang","nameEn":null,"quantity":1,"unitPrice":50000,"lineTotal":50000,"specification":null,"note":"少辣"},
            {"name":"炒面","nameVi":"Mì xào","nameEn":null,"quantity":1,"unitPrice":45000,"lineTotal":45000,"specification":null,"note":null}
          ],
          "totals":{"subtotal":95000,"discount":5000,"originalAmount":95000,"roundingAmount":null,"receivedAmount":90000,"serviceFee":null,"total":90000,"currency":"VND"},
          "note":"Đã thanh toán · Giao hàng · Tự lấy tại cửa hàng",
          "verificationCode":null,
          "footer":{"zh":"谢谢惠顾","vi":"Cảm ơn quý khách"}
        }
        """;

    [Fact]
    public void ParsesTheAndroidSchemaOneFallback()
    {
        var receipt = ReceiptDocumentV1Parser.Parse(LegacyReceipt);
        Assert.Equal(ReceiptType.ORDER_CUSTOMER, receipt.ReceiptType);
        Assert.Equal("云桥餐厅", receipt.Merchant.Name);
        Assert.Equal("Cơm rang", receipt.Items[0].NameVi);
        Assert.Equal(90_000, receipt.Totals.Total);
    }

    [Fact]
    public void RejectsUnknownLegacyFields()
    {
        var invalid = LegacyReceipt.Replace("\"verificationCode\":null", "\"printerBytes\":\"raw\",\"verificationCode\":null", StringComparison.Ordinal);
        var error = Assert.Throws<ReceiptSchemaException>(() => ReceiptDocumentV1Parser.Parse(invalid));
        Assert.Contains("unsupported fields", error.Message, StringComparison.OrdinalIgnoreCase);
    }
}
