using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Core.Tests;

public sealed class PrintDocumentParserTests
{
    private const string GoldenDocument = """
        {
          "documentType":"PRINT_DOCUMENT",
          "schemaVersion":3,
          "paperWidth":"MM80",
          "copies":2,
          "blocks":[
            {"type":"TEXT","text":"云桥 结账单 厨房 桌号08","align":"CENTER","bold":true,"fontSize":"LARGE","underline":false,"overflow":"FIT"},
            {"type":"COLUMNS","gapDots":8,"cells":[
              {"text":"Cơm rang / Bún xào / Mì xào","weight":70,"align":"LEFT","bold":false,"fontSize":"NORMAL","overflow":"ELLIPSIS","paddingDots":0},
              {"text":"123.456 ₫","weight":30,"align":"RIGHT","bold":true,"fontSize":"NORMAL","overflow":"FIT","paddingDots":0}
            ]},
            {"type":"TEXT","text":"Đã thanh toán · Giao hàng · Tự lấy tại cửa hàng","align":"LEFT","bold":false,"fontSize":"SMALL","underline":false},
            {"type":"CUT","mode":"HALF"}
          ]
        }
        """;

    [Fact]
    public void ParsesAndroidV3GoldenDocumentAndAllRequiredCharacters()
    {
        var document = PrintDocumentParser.Parse(GoldenDocument);

        Assert.Equal(3, document.SchemaVersion);
        Assert.Equal(PrintPaperWidth.MM80, document.PaperWidth);
        Assert.Equal(576, document.WidthDots);
        Assert.Equal(2, document.Copies);
        Assert.Equal(PrintCutMode.HALF, document.CutMode);
        Assert.Contains(document.Blocks, value => value is PrintBlock.Text text && text.Value.Contains("云桥", StringComparison.Ordinal));
        Assert.Contains(document.Blocks, value => value is PrintBlock.Text text && text.Value.Contains("Đã thanh toán", StringComparison.Ordinal));
    }

    [Fact]
    public void RejectsBusinessFieldsAndRawCommands()
    {
        var invalid = GoldenDocument.Replace("\"blocks\":[", "\"orderId\":\"8\",\"blocks\":[", StringComparison.Ordinal);
        var error = Assert.Throws<PrintDocumentException>(() => PrintDocumentParser.Parse(invalid));
        Assert.Contains("unsupported fields", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RequiresCutToBeTheFinalBlock()
    {
        const string invalid = """
            {"documentType":"PRINT_DOCUMENT","schemaVersion":2,"paperWidth":"MM58","copies":1,
             "blocks":[{"type":"CUT","mode":"HALF"},{"type":"DIVIDER"}]}
            """;
        var error = Assert.Throws<PrintDocumentException>(() => PrintDocumentParser.Parse(invalid));
        Assert.Equal("CUT must be the final print block.", error.Message);
    }
}
