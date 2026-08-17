using System.Text.Json;

namespace YunQiao.Cashier.Core.Protocol;

public enum PrintPaperWidth { MM58, MM80 }
public enum PrintAlignment { LEFT, CENTER, RIGHT }
public enum PrintFontSize { SMALL, NORMAL, LARGE }
public enum PrintCutMode { NONE, HALF, FULL }
public enum PrintColumnOverflow { ELLIPSIS, FIT }

public sealed record PrintColumnCell(
    string Text,
    int Weight,
    PrintAlignment Align,
    bool Bold,
    PrintFontSize FontSize,
    PrintColumnOverflow Overflow,
    int PaddingDots);

public abstract record PrintBlock
{
    public sealed record Text(
        string Value,
        PrintAlignment Align,
        bool Bold,
        PrintFontSize FontSize,
        bool Underline,
        PrintColumnOverflow? Overflow) : PrintBlock;

    public sealed record Row(string Left, string Right, bool Bold) : PrintBlock;
    public sealed record Columns(int GapDots, IReadOnlyList<PrintColumnCell> Cells) : PrintBlock;
    public sealed record BoxedTitle(
        string BoxText,
        string Title,
        string Subtitle,
        int BoxWeight,
        int GapDots,
        PrintFontSize FontSize) : PrintBlock;
    public sealed record Divider : PrintBlock;
    public sealed record Feed(int Lines) : PrintBlock;
    public sealed record Cut(PrintCutMode Mode) : PrintBlock;
}

public sealed record PrintDocument(
    int SchemaVersion,
    PrintPaperWidth PaperWidth,
    int Copies,
    IReadOnlyList<PrintBlock> Blocks)
{
    public int WidthDots => PaperWidth == PrintPaperWidth.MM58 ? 384 : 576;

    public PrintCutMode CutMode => Blocks.LastOrDefault() is PrintBlock.Cut cut
        ? cut.Mode
        : PrintCutMode.NONE;
}

/// <summary>Strict port of Android PrintDocumentV2Parser. Business fields and raw commands are rejected.</summary>
public static class PrintDocumentParser
{
    public const int MaxJsonChars = 512_000;

    public static PrintDocument Parse(string json)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(json);
        if (json.Length is < 2 or > MaxJsonChars)
            throw new PrintDocumentException("Print document size is invalid.");

        using var parsed = JsonDocument.Parse(json, new JsonDocumentOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = 64,
        });
        var root = parsed.RootElement;
        RequireObject(root, "$");
        RequireOnly(root, "$", "documentType", "schemaVersion", "paperWidth", "copies", "blocks");
        if (RequiredText(root, "documentType", 32) != "PRINT_DOCUMENT")
            throw new PrintDocumentException("Unsupported print document type.");

        var schema = RequiredInt(root, "schemaVersion", 2, 3);
        var paper = RequiredEnum<PrintPaperWidth>(root, "paperWidth", 8);
        var copies = RequiredInt(root, "copies", 1, 10);
        if (!root.TryGetProperty("blocks", out var blocksJson) || blocksJson.ValueKind != JsonValueKind.Array)
            throw new PrintDocumentException("Print blocks are missing.");
        if (blocksJson.GetArrayLength() is < 1 or > 2_000)
            throw new PrintDocumentException("Print block count is invalid.");

        var blocks = new List<PrintBlock>(blocksJson.GetArrayLength());
        var index = 0;
        foreach (var item in blocksJson.EnumerateArray())
        {
            var path = $"$.blocks[{index}]";
            RequireObject(item, path);
            var type = RequiredText(item, "type", 16);
            blocks.Add(type switch
            {
                "TEXT" => ParseText(item, path, schema),
                "ROW" => ParseRow(item, path),
                "COLUMNS" when schema == 3 => ParseColumns(item, path),
                "BOXED_TITLE" when schema == 3 => ParseBoxedTitle(item, path),
                "DIVIDER" => ParseDivider(item, path),
                "FEED" => ParseFeed(item, path),
                "CUT" => ParseCut(item, path),
                "COLUMNS" or "BOXED_TITLE" => throw new PrintDocumentException($"{type} requires print document schema 3."),
                _ => throw new PrintDocumentException($"Unsupported print block type: {type}"),
            });
            index++;
        }

        var cutIndexes = blocks.Select((value, blockIndex) => (value, blockIndex))
            .Where(value => value.value is PrintBlock.Cut)
            .Select(value => value.blockIndex)
            .ToArray();
        if (cutIndexes.Length > 1) throw new PrintDocumentException("Only one CUT block is supported.");
        if (cutIndexes.Length == 1 && cutIndexes[0] != blocks.Count - 1)
            throw new PrintDocumentException("CUT must be the final print block.");

        return new PrintDocument(schema, paper, copies, blocks);
    }

    private static PrintBlock ParseText(JsonElement value, string path, int schema)
    {
        RequireOnly(value, path, schema == 3
            ? ["type", "text", "align", "bold", "fontSize", "underline", "overflow"]
            : ["type", "text", "align", "bold", "fontSize", "underline"]);
        PrintColumnOverflow? overflow = null;
        if (schema == 3 && value.TryGetProperty("overflow", out var overflowJson))
            overflow = ParseEnum<PrintColumnOverflow>(RequiredStringValue(overflowJson, "overflow", 16));
        return new PrintBlock.Text(
            RequiredTextAllowEmpty(value, "text", 2_000),
            RequiredEnum<PrintAlignment>(value, "align", 16),
            RequiredBoolean(value, "bold"),
            RequiredEnum<PrintFontSize>(value, "fontSize", 16),
            RequiredBoolean(value, "underline"),
            overflow);
    }

    private static PrintBlock ParseRow(JsonElement value, string path)
    {
        RequireOnly(value, path, "type", "left", "right", "bold");
        return new PrintBlock.Row(
            RequiredTextAllowEmpty(value, "left", 1_000),
            RequiredTextAllowEmpty(value, "right", 1_000),
            RequiredBoolean(value, "bold"));
    }

    private static PrintBlock ParseColumns(JsonElement value, string path)
    {
        RequireOnly(value, path, "type", "gapDots", "cells");
        if (!value.TryGetProperty("cells", out var cellsJson) || cellsJson.ValueKind != JsonValueKind.Array)
            throw new PrintDocumentException("Column cells are missing.");
        if (cellsJson.GetArrayLength() is < 2 or > 4)
            throw new PrintDocumentException("Column cell count is invalid.");
        var cells = new List<PrintColumnCell>(cellsJson.GetArrayLength());
        var index = 0;
        foreach (var cell in cellsJson.EnumerateArray())
        {
            var cellPath = $"{path}.cells[{index}]";
            RequireObject(cell, cellPath);
            RequireOnly(cell, cellPath, "text", "weight", "align", "bold", "fontSize", "overflow", "paddingDots");
            cells.Add(new PrintColumnCell(
                RequiredTextAllowEmpty(cell, "text", 2_000),
                RequiredInt(cell, "weight", 1, 100),
                RequiredEnum<PrintAlignment>(cell, "align", 16),
                RequiredBoolean(cell, "bold"),
                RequiredEnum<PrintFontSize>(cell, "fontSize", 16),
                RequiredEnum<PrintColumnOverflow>(cell, "overflow", 16),
                RequiredInt(cell, "paddingDots", 0, 24)));
            index++;
        }
        return new PrintBlock.Columns(RequiredInt(value, "gapDots", 0, 40), cells);
    }

    private static PrintBlock ParseBoxedTitle(JsonElement value, string path)
    {
        RequireOnly(value, path, "type", "boxText", "title", "subtitle", "boxWeight", "gapDots", "fontSize");
        return new PrintBlock.BoxedTitle(
            RequiredText(value, "boxText", 64),
            RequiredText(value, "title", 200),
            RequiredText(value, "subtitle", 64),
            RequiredInt(value, "boxWeight", 10, 50),
            RequiredInt(value, "gapDots", 0, 40),
            RequiredEnum<PrintFontSize>(value, "fontSize", 16));
    }

    private static PrintBlock ParseDivider(JsonElement value, string path)
    {
        RequireOnly(value, path, "type");
        return new PrintBlock.Divider();
    }

    private static PrintBlock ParseFeed(JsonElement value, string path)
    {
        RequireOnly(value, path, "type", "lines");
        return new PrintBlock.Feed(RequiredInt(value, "lines", 1, 20));
    }

    private static PrintBlock ParseCut(JsonElement value, string path)
    {
        RequireOnly(value, path, "type", "mode");
        return new PrintBlock.Cut(RequiredEnum<PrintCutMode>(value, "mode", 8));
    }

    private static void RequireObject(JsonElement value, string path)
    {
        if (value.ValueKind != JsonValueKind.Object)
            throw new PrintDocumentException($"Print document value at {path} must be an object.");
    }

    private static void RequireOnly(JsonElement value, string path, params string[] allowed)
    {
        var accepted = allowed.ToHashSet(StringComparer.Ordinal);
        var unsupported = value.EnumerateObject().Select(property => property.Name)
            .Where(name => !accepted.Contains(name)).Order(StringComparer.Ordinal).ToArray();
        if (unsupported.Length > 0)
            throw new PrintDocumentException($"Print document contains unsupported fields at {path}: {string.Join(',', unsupported)}.");
    }

    private static string RequiredText(JsonElement owner, string key, int max) =>
        owner.TryGetProperty(key, out var value) ? RequiredStringValue(value, key, max) : throw Invalid(key);

    private static string RequiredStringValue(JsonElement value, string key, int max)
    {
        var text = RequiredStringValueAllowEmpty(value, key, max);
        if (text.Length == 0) throw Invalid(key);
        return text;
    }

    private static string RequiredTextAllowEmpty(JsonElement owner, string key, int max) =>
        owner.TryGetProperty(key, out var value) ? RequiredStringValueAllowEmpty(value, key, max) : throw Invalid(key);

    private static string RequiredStringValueAllowEmpty(JsonElement value, string key, int max)
    {
        if (value.ValueKind != JsonValueKind.String) throw Invalid(key);
        var text = value.GetString() ?? string.Empty;
        if (text.Length > max || text.Contains('\0')) throw Invalid(key);
        return text;
    }

    private static bool RequiredBoolean(JsonElement owner, string key)
    {
        if (!owner.TryGetProperty(key, out var value) || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw Invalid(key);
        return value.GetBoolean();
    }

    private static int RequiredInt(JsonElement owner, string key, int minimum, int maximum)
    {
        if (!owner.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number))
            throw Invalid(key);
        if (number < minimum || number > maximum) throw new PrintDocumentException($"Print integer is out of range: {key}");
        return number;
    }

    private static T RequiredEnum<T>(JsonElement owner, string key, int max) where T : struct, Enum =>
        ParseEnum<T>(RequiredText(owner, key, max));

    private static T ParseEnum<T>(string value) where T : struct, Enum =>
        Enum.TryParse<T>(value, ignoreCase: false, out var parsed) && Enum.IsDefined(parsed)
            ? parsed
            : throw new PrintDocumentException($"Invalid {typeof(T).Name}: {value}");

    private static PrintDocumentException Invalid(string key) => new($"Invalid print field: {key}");
}

public sealed class PrintDocumentException(string message) : Exception(message);
