using System.Globalization;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using YunQiao.Cashier.Core.Printing;
using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Printing;

public sealed record RenderedReceipt(int Width, int Height, int Stride, byte[] BgraPixels, byte[] EscPosBytes);

/// <summary>WPF port of Android PrintDocumentV2Renderer. Text always becomes raster pixels.</summary>
public sealed class WpfReceiptRenderer
{
    private const double MarginRatio = 0.052;
    private const int MaximumHeight = 8_000;
    private static readonly Typeface Normal = new(new FontFamily("Microsoft YaHei UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
    private static readonly Typeface Bold = new(new FontFamily("Microsoft YaHei UI"), FontStyles.Normal, FontWeights.Bold, FontStretches.Normal);
    private readonly double _pixelsPerDip;

    public WpfReceiptRenderer(double pixelsPerDip = 1.0) => _pixelsPerDip = pixelsPerDip;

    public RenderedReceipt Render(PrintDocument document)
    {
        var width = document.WidthDots;
        var scale = width / 576d;
        var margin = Math.Max(14d, width * MarginRatio);
        var contentWidth = width - margin * 2;
        var compact = document.SchemaVersion >= 3;
        var rows = BuildRows(document, scale, contentWidth, compact);
        var rowGap = compact ? Math.Max(3, 4 * scale) : Math.Max(4, 6 * scale);
        var cut = document.CutMode switch
        {
            PrintCutMode.NONE => CutMode.None,
            PrintCutMode.HALF => CutMode.Half,
            PrintCutMode.FULL => CutMode.Full,
            _ => throw new ArgumentOutOfRangeException(),
        };
        return RenderRows(width, margin, rows, rowGap, document.Copies, cut);
    }

    public RenderedReceipt RenderLegacy(ReceiptDocumentV1 receipt, PrintPaperWidth paperWidth, DateTimeOffset printedAt)
    {
        var width = paperWidth == PrintPaperWidth.MM58 ? 384 : 576;
        var scale = width / 576d;
        var margin = Math.Max(14d, width * MarginRatio);
        var contentWidth = width - margin * 2;
        var normal = LegacyStyle(false, false, scale);
        var bold = LegacyStyle(true, false, scale);
        var title = LegacyStyle(true, true, scale);
        var divider = new string('-', width <= 384 ? 30 : 44);
        var rows = new List<RenderRow>();
        AddLegacyWrapped(rows, receipt.Merchant.Name, title, contentWidth, true);
        if (!string.IsNullOrWhiteSpace(receipt.Merchant.NameVi) && receipt.Merchant.NameVi != receipt.Merchant.Name)
            AddLegacyWrapped(rows, receipt.Merchant.NameVi, normal, contentWidth, true);
        if (!string.IsNullOrWhiteSpace(receipt.Merchant.Address)) AddLegacyWrapped(rows, receipt.Merchant.Address, normal, contentWidth, true);
        if (!string.IsNullOrWhiteSpace(receipt.Merchant.Phone)) AddLegacyWrapped(rows, receipt.Merchant.Phone, normal, contentWidth, true);
        rows.Add(new TextRow(divider, normal, PrintAlignment.LEFT));
        if (receipt.ReceiptType == ReceiptType.ORDER_CUSTOMER)
        {
            var order = receipt.Order ?? throw new ReceiptSchemaException("Order context is missing.");
            rows.Add(new TextRow($"订单 / Đơn: {order.OrderNo}", bold, PrintAlignment.LEFT));
            if (!string.IsNullOrWhiteSpace(order.TableName)) AddLegacyWrapped(rows, $"桌台 / Bàn: {order.TableName}", normal, contentWidth);
            rows.Add(new TextRow($"类型 / Loại: {order.OrderType}", normal, PrintAlignment.LEFT));
            if (order.GuestCount is not null) rows.Add(new TextRow($"人数 / Khách: {order.GuestCount}", normal, PrintAlignment.LEFT));
            rows.Add(new TextRow($"下单 / Đặt lúc: {FormatTime(order.CreatedAt)}", normal, PrintAlignment.LEFT));
        }
        else
        {
            var table = receipt.TableSession ?? throw new ReceiptSchemaException("Table context is missing.");
            AddLegacyWrapped(rows, $"桌账 / Hóa đơn bàn: {table.TableName}", bold, contentWidth);
            rows.Add(new TextRow($"Session: {table.SessionNo}", normal, PrintAlignment.LEFT));
            rows.Add(new TextRow($"开台 / Mở bàn: {FormatTime(table.OpenedAt)}", normal, PrintAlignment.LEFT));
            if (table.OrderNos.Count > 0) AddLegacyWrapped(rows, $"订单 / Đơn: {string.Join(", ", table.OrderNos)}", normal, contentWidth);
        }
        rows.Add(new TextRow(divider, normal, PrintAlignment.LEFT));
        for (var index = 0; index < receipt.Items.Count; index++)
        {
            var item = receipt.Items[index];
            AddLegacyWrapped(rows, $"{index + 1}. {item.Name}", bold, contentWidth);
            if (!string.IsNullOrWhiteSpace(item.NameVi) && item.NameVi != item.Name) AddLegacyWrapped(rows, $"   {item.NameVi}", normal, contentWidth);
            if (!string.IsNullOrWhiteSpace(item.NameEn) && item.NameEn != item.Name && item.NameEn != item.NameVi) AddLegacyWrapped(rows, $"   {item.NameEn}", normal, contentWidth);
            if (!string.IsNullOrWhiteSpace(item.Specification)) AddLegacyWrapped(rows, $"   规格 / Quy cách: {item.Specification}", normal, contentWidth);
            AddLegacyWrapped(rows, $"   数量 / Số lượng: {item.Quantity}", normal, contentWidth);
            AddLegacyWrapped(rows, $"   单价 / Đơn giá: {Vnd(item.UnitPrice)} VND", normal, contentWidth);
            AddLegacyWrapped(rows, $"   金额 / Thành tiền: {Vnd(item.LineTotal)} VND", normal, contentWidth);
            if (!string.IsNullOrWhiteSpace(item.Note)) AddLegacyWrapped(rows, $"   备注 / Ghi chú: {item.Note}", normal, contentWidth);
        }
        rows.Add(new TextRow(divider, normal, PrintAlignment.LEFT));
        rows.Add(new TextRow($"小计 / Tạm tính: {Vnd(receipt.Totals.Subtotal)} VND", normal, PrintAlignment.LEFT));
        if (receipt.Totals.Discount is not null) rows.Add(new TextRow($"优惠 / Giảm giá: {Vnd(receipt.Totals.Discount.Value)} VND", normal, PrintAlignment.LEFT));
        if (receipt.Totals.ServiceFee is not null) rows.Add(new TextRow($"服务费 / Phí dịch vụ: {Vnd(receipt.Totals.ServiceFee.Value)} VND", normal, PrintAlignment.LEFT));
        rows.Add(new TextRow($"合计 / Tổng cộng: {Vnd(receipt.Totals.Total)} VND", bold, PrintAlignment.LEFT));
        if (receipt.Totals.OriginalAmount is not null) rows.Add(new TextRow($"原金额 / Tổng tiền ban đầu: {Vnd(receipt.Totals.OriginalAmount.Value)} VND", normal, PrintAlignment.LEFT));
        if (receipt.Totals.RoundingAmount is > 0) rows.Add(new TextRow($"抹零 / Làm tròn: {Vnd(receipt.Totals.RoundingAmount.Value)} VND", normal, PrintAlignment.LEFT));
        if (receipt.Totals.ReceivedAmount is not null) rows.Add(new TextRow($"实收 / Thực thu: {Vnd(receipt.Totals.ReceivedAmount.Value)} VND", bold, PrintAlignment.LEFT));
        if (!string.IsNullOrWhiteSpace(receipt.Note)) AddLegacyWrapped(rows, $"订单备注 / Ghi chú: {receipt.Note}", normal, contentWidth);
        rows.Add(new TextRow(divider, normal, PrintAlignment.LEFT));
        rows.Add(new TextRow($"生成 / Tạo: {FormatTime(receipt.GeneratedAt)}", normal, PrintAlignment.LEFT));
        rows.Add(new TextRow($"打印 / In: {FormatTime(printedAt)}", normal, PrintAlignment.LEFT));
        var footer = receipt.Footer ?? new ReceiptFooter("谢谢惠顾，欢迎再次光临", "Cảm ơn quý khách, hẹn gặp lại!");
        rows.Add(new TextRow(divider, normal, PrintAlignment.LEFT));
        rows.Add(new TextRow(footer.Zh, normal, PrintAlignment.CENTER));
        rows.Add(new TextRow(footer.Vi, normal, PrintAlignment.CENTER));
        return RenderRows(width, margin, rows, Math.Max(4, 6 * scale), 1, CutMode.Half);
    }

    private RenderedReceipt RenderRows(int width, double margin, IReadOnlyList<RenderRow> rows, double rowGap, int copies, CutMode cut)
    {
        var height = (int)(margin * 2 + rows.Sum(value => Math.Ceiling(value.Height + rowGap)));
        if (height is < 1 or > MaximumHeight) throw new PrintDocumentException("Print document exceeds raster height limit.");
        var contentWidth = width - margin * 2;

        var visual = new DrawingVisual();
        using (var drawing = visual.RenderOpen())
        {
            drawing.DrawRectangle(Brushes.White, null, new Rect(0, 0, width, height));
            var top = margin;
            foreach (var row in rows)
            {
                row.Draw(drawing, margin, contentWidth, top);
                top += row.Height + rowGap;
            }
        }

        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var stride = width * 4;
        var pixels = new byte[stride * height];
        bitmap.CopyPixels(pixels, stride, 0);
        var oneCopy = EscPosRasterEncoder.EncodeBgra32(width, height, pixels, stride, 160, cut);
        var bytes = new byte[oneCopy.Length * copies];
        for (var copy = 0; copy < copies; copy++) Buffer.BlockCopy(oneCopy, 0, bytes, copy * oneCopy.Length, oneCopy.Length);
        return new RenderedReceipt(width, height, stride, pixels, bytes);
    }

    private TextStyle LegacyStyle(bool bold, bool title, double scale)
    {
        var fontSize = title ? Math.Max(25, 34 * scale) : Math.Max(18, 24 * scale);
        var typeface = bold ? Bold : Normal;
        var probe = CreateText("Hg", new TextStyle(typeface, fontSize, false, 1, fontSize * 1.24));
        return new TextStyle(typeface, fontSize, false, 1, Math.Max(fontSize * 1.24, probe.Height));
    }

    private void AddLegacyWrapped(List<RenderRow> rows, string value, TextStyle style, double width, bool centered = false)
    {
        foreach (var line in Wrap(value, style, width))
            rows.Add(new TextRow(line, style, centered ? PrintAlignment.CENTER : PrintAlignment.LEFT));
    }

    private static string Vnd(long value) => value.ToString("N0", CultureInfo.GetCultureInfo("vi-VN"));
    private static string FormatTime(DateTimeOffset value) => value.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private List<RenderRow> BuildRows(PrintDocument document, double scale, double contentWidth, bool compact)
    {
        var result = new List<RenderRow>();
        foreach (var block in document.Blocks)
        {
            switch (block)
            {
                case PrintBlock.Text text:
                    var textStyle = Style(text.Bold, text.FontSize, text.Underline, scale, compact);
                    if (compact && text.Overflow is not null)
                    {
                        result.Add(new TextRow(ResolveOverflow(text.Value, textStyle, contentWidth, text.Overflow.Value), textStyle, text.Align));
                    }
                    else
                    {
                        foreach (var line in Wrap(text.Value, textStyle, contentWidth)) result.Add(new TextRow(line, textStyle, text.Align));
                    }
                    break;
                case PrintBlock.Row row:
                    AddPairRows(result, row, scale, contentWidth, compact);
                    break;
                case PrintBlock.Columns columns:
                    result.Add(CreateColumnsRow(columns, scale, contentWidth, compact));
                    break;
                case PrintBlock.BoxedTitle box:
                    result.Add(CreateBoxRow(box, scale, contentWidth, compact));
                    break;
                case PrintBlock.Divider:
                    result.Add(compact
                        ? new DividerRow(Math.Max(6, 9 * scale))
                        : new TextRow(new string('-', document.WidthDots <= 384 ? 30 : 44), Style(false, PrintFontSize.NORMAL, false, scale, compact), PrintAlignment.LEFT));
                    break;
                case PrintBlock.Feed feed:
                    for (var line = 0; line < feed.Lines; line++) result.Add(new TextRow(" ", Style(false, PrintFontSize.NORMAL, false, scale, compact), PrintAlignment.LEFT));
                    break;
                case PrintBlock.Cut:
                    break;
            }
        }
        return result;
    }

    private void AddPairRows(List<RenderRow> rows, PrintBlock.Row row, double scale, double width, bool compact)
    {
        var leftStyle = Style(row.Bold, PrintFontSize.NORMAL, false, scale, compact);
        var rightStyle = Style(row.Bold, PrintFontSize.NORMAL, false, scale, compact);
        var rightLines = Wrap(row.Right, rightStyle, width * 0.45);
        var rightWidth = rightLines.Count == 0 ? 0 : rightLines.Max(value => Measure(value, rightStyle));
        var leftLines = Wrap(row.Left, leftStyle, Math.Max(1, width - rightWidth - 12));
        for (var index = 0; index < Math.Max(leftLines.Count, rightLines.Count); index++)
            rows.Add(new TextRow(index < leftLines.Count ? leftLines[index] : " ", leftStyle, PrintAlignment.LEFT,
                index < rightLines.Count ? rightLines[index] : null, rightStyle));
    }

    private ColumnsRow CreateColumnsRow(PrintBlock.Columns block, double scale, double width, bool compact)
    {
        var gapTotal = block.GapDots * (block.Cells.Count - 1d);
        if (width <= gapTotal) throw new PrintDocumentException("Column gaps exceed receipt width.");
        var weightedWidth = width - gapTotal;
        var totalWeight = block.Cells.Sum(value => value.Weight);
        var cells = new List<RenderedCell>(block.Cells.Count);
        var left = 0d;
        var allocated = 0d;
        for (var index = 0; index < block.Cells.Count; index++)
        {
            var cell = block.Cells[index];
            var cellWidth = index == block.Cells.Count - 1 ? weightedWidth - allocated : weightedWidth * cell.Weight / totalWeight;
            var padding = Math.Min(cell.PaddingDots, cellWidth / 2);
            var style = Style(cell.Bold, cell.FontSize, false, scale, compact);
            var contentWidth = cellWidth - padding * 2;
            cells.Add(new RenderedCell(ResolveOverflow(cell.Text, style, contentWidth, cell.Overflow), style, cell.Align, left + padding, left + cellWidth - padding));
            allocated += cellWidth;
            left += cellWidth + block.GapDots;
        }
        return new ColumnsRow(cells);
    }

    private BoxRow CreateBoxRow(PrintBlock.BoxedTitle block, double scale, double width, bool compact)
    {
        var boxWidth = (width - block.GapDots) * block.BoxWeight / 100d;
        var rightWidth = width - block.GapDots - boxWidth;
        var boxStyle = FitStyle(block.BoxText, Style(true, PrintFontSize.LARGE, false, scale, compact), boxWidth - 8);
        var titleStyle = FitStyle(block.Title, Style(true, block.FontSize, false, scale, compact), rightWidth);
        var subtitleStyle = FitStyle(block.Subtitle, Style(true, PrintFontSize.SMALL, false, scale, compact), rightWidth);
        var textHeight = titleStyle.LineHeight + subtitleStyle.LineHeight + Math.Max(2, 2 * scale);
        return new BoxRow(block, boxWidth, rightWidth, block.GapDots, boxStyle, titleStyle, subtitleStyle, Math.Max(Math.Max(42, 58 * scale), textHeight));
    }

    private TextStyle Style(bool bold, PrintFontSize size, bool underline, double scale, bool compact)
    {
        var minimum = compact ? 14 : 16;
        var baseSize = size switch { PrintFontSize.SMALL => 20, PrintFontSize.NORMAL => 24, PrintFontSize.LARGE => 34, _ => 24 };
        var fontSize = Math.Max(minimum, baseSize * scale);
        var typeface = bold ? Bold : Normal;
        var probe = CreateText("Hg", new TextStyle(typeface, fontSize, underline, 1, fontSize * 1.24));
        return new TextStyle(typeface, fontSize, underline, 1, Math.Max(fontSize * 1.24, probe.Height));
    }

    private TextStyle FitStyle(string text, TextStyle style, double maxWidth)
    {
        var measured = Measure(text, style);
        return measured > maxWidth && measured > 0 ? style with { ScaleX = Math.Max(0.1, maxWidth / measured) } : style;
    }

    private string ResolveOverflow(string text, TextStyle style, double maxWidth, PrintColumnOverflow overflow)
    {
        if (overflow == PrintColumnOverflow.FIT) return text;
        if (Measure(text, style) <= maxWidth) return text;
        const string suffix = "…";
        var available = Math.Max(1, maxWidth - Measure(suffix, style));
        var count = CountThatFits(text, style, available);
        return text[..count].TrimEnd() + suffix;
    }

    private List<string> Wrap(string value, TextStyle style, double maxWidth)
    {
        if (value.Length == 0) return [" "];
        var result = new List<string>();
        var remaining = value;
        while (remaining.Length > 0)
        {
            var count = Math.Max(1, CountThatFits(remaining, style, maxWidth));
            result.Add(remaining[..count]);
            remaining = remaining[count..];
        }
        return result;
    }

    private int CountThatFits(string value, TextStyle style, double maxWidth)
    {
        var low = 0;
        var high = value.Length;
        while (low < high)
        {
            var middle = (low + high + 1) / 2;
            if (Measure(value[..middle], style) <= maxWidth) low = middle; else high = middle - 1;
        }
        return low;
    }

    private double Measure(string value, TextStyle style) => CreateText(value, style).WidthIncludingTrailingWhitespace * style.ScaleX;

    private FormattedText CreateText(string value, TextStyle style)
    {
        var formatted = new FormattedText(value, CultureInfo.GetCultureInfo("zh-CN"), FlowDirection.LeftToRight,
            style.Typeface, style.FontSize, Brushes.Black, _pixelsPerDip);
        if (style.Underline) formatted.SetTextDecorations(TextDecorations.Underline);
        return formatted;
    }

    private sealed record TextStyle(Typeface Typeface, double FontSize, bool Underline, double ScaleX, double LineHeight);
    private sealed record RenderedCell(string Text, TextStyle Style, PrintAlignment Alignment, double Left, double Right);

    private abstract class RenderRow { public abstract double Height { get; } public abstract void Draw(DrawingContext drawing, double margin, double width, double top); }

    private sealed class TextRow(string text, TextStyle style, PrintAlignment alignment, string? right = null, TextStyle? rightStyle = null) : RenderRow
    {
        public override double Height => Math.Max(style.LineHeight, rightStyle?.LineHeight ?? 0);
        public override void Draw(DrawingContext drawing, double margin, double width, double top)
        {
            DrawAligned(drawing, text, style, alignment, margin, margin + width, top, Height);
            if (right is not null && rightStyle is not null) DrawAligned(drawing, right, rightStyle, PrintAlignment.RIGHT, margin, margin + width, top, Height);
        }
    }

    private sealed class ColumnsRow(IReadOnlyList<RenderedCell> cells) : RenderRow
    {
        public override double Height => cells.Max(value => value.Style.LineHeight);
        public override void Draw(DrawingContext drawing, double margin, double width, double top)
        {
            foreach (var cell in cells)
            {
                drawing.PushClip(new RectangleGeometry(new Rect(margin + cell.Left, top, cell.Right - cell.Left, Height)));
                DrawAligned(drawing, cell.Text, cell.Style, cell.Alignment, margin + cell.Left, margin + cell.Right, top, Height);
                drawing.Pop();
            }
        }
    }

    private sealed class DividerRow(double height) : RenderRow
    {
        public override double Height => height;
        public override void Draw(DrawingContext drawing, double margin, double width, double top) =>
            drawing.DrawLine(new Pen(Brushes.Black, 1.5), new Point(margin, top + Height / 2), new Point(margin + width, top + Height / 2));
    }

    private sealed class BoxRow(PrintBlock.BoxedTitle block, double boxWidth, double rightWidth, double gap, TextStyle boxStyle, TextStyle titleStyle, TextStyle subtitleStyle, double height) : RenderRow
    {
        public override double Height => height;
        public override void Draw(DrawingContext drawing, double margin, double width, double top)
        {
            drawing.DrawRectangle(null, new Pen(Brushes.Black, 2), new Rect(margin, top, boxWidth, Height));
            DrawAligned(drawing, block.BoxText, boxStyle, PrintAlignment.CENTER, margin, margin + boxWidth, top, Height);
            var rightLeft = margin + boxWidth + gap;
            var innerGap = 2d;
            var textHeight = titleStyle.LineHeight + innerGap + subtitleStyle.LineHeight;
            var textTop = top + (Height - textHeight) / 2;
            DrawAligned(drawing, block.Title, titleStyle, PrintAlignment.CENTER, rightLeft, rightLeft + rightWidth, textTop, titleStyle.LineHeight);
            DrawAligned(drawing, block.Subtitle, subtitleStyle, PrintAlignment.CENTER, rightLeft, rightLeft + rightWidth, textTop + titleStyle.LineHeight + innerGap, subtitleStyle.LineHeight);
        }
    }

    private static void DrawAligned(DrawingContext drawing, string text, TextStyle style, PrintAlignment alignment, double left, double right, double top, double rowHeight)
    {
        var formatted = new FormattedText(text, CultureInfo.GetCultureInfo("zh-CN"), FlowDirection.LeftToRight,
            style.Typeface, style.FontSize, Brushes.Black, 1);
        if (style.Underline) formatted.SetTextDecorations(TextDecorations.Underline);
        var unscaledWidth = formatted.WidthIncludingTrailingWhitespace;
        var scaledWidth = unscaledWidth * style.ScaleX;
        var x = alignment switch
        {
            PrintAlignment.LEFT => left,
            PrintAlignment.CENTER => left + ((right - left) - scaledWidth) / 2,
            PrintAlignment.RIGHT => right - scaledWidth,
            _ => left,
        };
        var y = top + (rowHeight - formatted.Height) / 2;
        if (Math.Abs(style.ScaleX - 1) > 0.0001)
        {
            drawing.PushTransform(new ScaleTransform(style.ScaleX, 1, x, y));
            drawing.DrawText(formatted, new Point(x, y));
            drawing.Pop();
        }
        else drawing.DrawText(formatted, new Point(x, y));
    }
}
