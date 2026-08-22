using System.Text.Json;

namespace YunQiao.Cashier.Core.Protocol;

public enum ReceiptType { ORDER_CUSTOMER, TABLE_BILL }

public sealed record ReceiptMerchant(string Id, string Name, string? NameVi, string? Address, string? Phone);
public sealed record ReceiptOrder(string Id, string OrderNo, string OrderType, string? TableName, int? GuestCount, DateTimeOffset CreatedAt, DateTimeOffset? CompletedAt);
public sealed record ReceiptTableSession(string Id, string SessionNo, string TableName, DateTimeOffset OpenedAt, DateTimeOffset? ClosedAt, IReadOnlyList<string> OrderNos);
public sealed record ReceiptItem(string Name, string? NameVi, string? NameEn, int Quantity, long UnitPrice, long LineTotal, string? Specification, string? Note);
public sealed record ReceiptTotals(long Subtotal, long? Discount, long? OriginalAmount, long? RoundingAmount, long? ReceivedAmount, long? ServiceFee, long Total, string Currency);
public sealed record ReceiptFooter(string Zh, string Vi);
public sealed record ReceiptDocumentV1(
    ReceiptType ReceiptType,
    DateTimeOffset GeneratedAt,
    ReceiptMerchant Merchant,
    ReceiptOrder? Order,
    ReceiptTableSession? TableSession,
    IReadOnlyList<ReceiptItem> Items,
    ReceiptTotals Totals,
    string? Note,
    string? VerificationCode,
    ReceiptFooter? Footer);

/// <summary>Strict port of Android ReceiptDocumentParser for active schema 1 jobs.</summary>
public static class ReceiptDocumentV1Parser
{
    public static ReceiptDocumentV1 Parse(string json)
    {
        if (json.Length is < 2 or > PrintDocumentParser.MaxJsonChars) throw new ReceiptSchemaException("Receipt snapshot size is invalid.");
        using var parsed = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 64 });
        var root = parsed.RootElement;
        RequireObject(root, "$");
        RequireOnly(root, "$", "schemaVersion", "receiptType", "generatedAt", "merchant", "order", "tableSession", "items", "totals", "note", "verificationCode", "footer");
        if (RequiredInt(root, "schemaVersion", 1, 1) != 1) throw new ReceiptSchemaException("Unsupported receipt schema.");
        var receiptType = RequiredEnum<ReceiptType>(root, "receiptType", 32);
        var merchantJson = RequiredObject(root, "merchant");
        RequireOnly(merchantJson, "$.merchant", "id", "name", "nameVi", "address", "phone");
        var merchant = new ReceiptMerchant(
            RequiredNumericId(merchantJson, "id"),
            RequiredText(merchantJson, "name", 120),
            OptionalText(merchantJson, "nameVi", 120),
            OptionalText(merchantJson, "address", 300),
            OptionalText(merchantJson, "phone", 32));

        var order = OptionalObject(root, "order") is { } orderJson ? ParseOrder(orderJson) : null;
        var table = OptionalObject(root, "tableSession") is { } tableJson ? ParseTable(tableJson) : null;
        if ((receiptType == ReceiptType.ORDER_CUSTOMER && (order is null || table is not null))
            || (receiptType == ReceiptType.TABLE_BILL && (table is null || order is not null)))
            throw new ReceiptSchemaException("Receipt context does not match receipt type.");

        if (!root.TryGetProperty("items", out var itemsJson) || itemsJson.ValueKind != JsonValueKind.Array || itemsJson.GetArrayLength() is < 1 or > 500)
            throw new ReceiptSchemaException("Receipt item count is invalid.");
        var items = new List<ReceiptItem>(itemsJson.GetArrayLength());
        var index = 0;
        foreach (var item in itemsJson.EnumerateArray())
        {
            RequireObject(item, $"$.items[{index}]");
            RequireOnly(item, $"$.items[{index}]", "name", "nameVi", "nameEn", "quantity", "unitPrice", "lineTotal", "specification", "note");
            items.Add(new ReceiptItem(
                RequiredText(item, "name", 120), OptionalText(item, "nameVi", 120), OptionalText(item, "nameEn", 120),
                RequiredInt(item, "quantity", 1, int.MaxValue), RequiredLong(item, "unitPrice"), RequiredLong(item, "lineTotal"),
                OptionalText(item, "specification", 120), OptionalText(item, "note", 200)));
            index++;
        }

        var totalsJson = RequiredObject(root, "totals");
        RequireOnly(totalsJson, "$.totals", "subtotal", "discount", "originalAmount", "roundingAmount", "receivedAmount", "serviceFee", "total", "currency");
        var totals = new ReceiptTotals(
            RequiredLong(totalsJson, "subtotal"), OptionalLong(totalsJson, "discount"), OptionalLong(totalsJson, "originalAmount"),
            OptionalLong(totalsJson, "roundingAmount"), OptionalLong(totalsJson, "receivedAmount"), OptionalLong(totalsJson, "serviceFee"),
            RequiredLong(totalsJson, "total"), RequiredText(totalsJson, "currency", 8));
        if (totals.Currency != "VND") throw new ReceiptSchemaException("Unsupported receipt currency.");

        ReceiptFooter? footer = null;
        if (OptionalObject(root, "footer") is { } footerJson)
        {
            RequireOnly(footerJson, "$.footer", "zh", "vi");
            footer = new ReceiptFooter(RequiredText(footerJson, "zh", 60), RequiredText(footerJson, "vi", 60));
        }
        return new ReceiptDocumentV1(
            receiptType, RequiredInstant(root, "generatedAt"), merchant, order, table, items, totals,
            OptionalText(root, "note", 500), OptionalText(root, "verificationCode", 128), footer);
    }

    private static ReceiptOrder ParseOrder(JsonElement value)
    {
        RequireOnly(value, "$.order", "id", "orderNo", "orderType", "tableName", "guestCount", "createdAt", "completedAt");
        return new ReceiptOrder(
            RequiredNumericId(value, "id"), RequiredText(value, "orderNo", 32), RequiredText(value, "orderType", 32),
            OptionalText(value, "tableName", 64), OptionalInt(value, "guestCount"), RequiredInstant(value, "createdAt"), OptionalInstant(value, "completedAt"));
    }

    private static ReceiptTableSession ParseTable(JsonElement value)
    {
        RequireOnly(value, "$.tableSession", "id", "sessionNo", "tableName", "openedAt", "closedAt", "orderNos");
        if (!value.TryGetProperty("orderNos", out var orderNosJson) || orderNosJson.ValueKind != JsonValueKind.Array || orderNosJson.GetArrayLength() > 1_000)
            throw new ReceiptSchemaException("orderNos are invalid.");
        var orderNos = orderNosJson.EnumerateArray().Select(item =>
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: >= 1 and <= 32 } text)
                throw new ReceiptSchemaException("orderNo is invalid.");
            return text;
        }).ToArray();
        return new ReceiptTableSession(
            RequiredNumericId(value, "id"), RequiredText(value, "sessionNo", 32), RequiredText(value, "tableName", 64),
            RequiredInstant(value, "openedAt"), OptionalInstant(value, "closedAt"), orderNos);
    }

    private static void RequireOnly(JsonElement value, string path, params string[] allowed)
    {
        var accepted = allowed.ToHashSet(StringComparer.Ordinal);
        var unsupported = value.EnumerateObject().Select(item => item.Name).Where(item => !accepted.Contains(item)).Order(StringComparer.Ordinal).ToArray();
        if (unsupported.Length > 0) throw new ReceiptSchemaException($"Receipt contains unsupported fields at {path}: {string.Join(',', unsupported)}.");
    }

    private static void RequireObject(JsonElement value, string path)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new ReceiptSchemaException($"Receipt value at {path} must be an object.");
    }

    private static JsonElement RequiredObject(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Object ? value : throw Invalid(key);

    private static JsonElement? OptionalObject(JsonElement owner, string key) =>
        !owner.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null ? null
            : value.ValueKind == JsonValueKind.Object ? value : throw Invalid(key);

    private static string RequiredText(JsonElement owner, string key, int max) =>
        OptionalText(owner, key, max) is { Length: > 0 } value ? value : throw Invalid(key);

    private static string? OptionalText(JsonElement owner, string key, int max)
    {
        if (!owner.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        if (value.ValueKind != JsonValueKind.String || value.GetString() is not { } text || text.Length > max || text.Contains('\0')) throw Invalid(key);
        return text;
    }

    private static string RequiredNumericId(JsonElement owner, string key)
    {
        var value = RequiredText(owner, key, 40);
        if (!value.All(char.IsAsciiDigit)) throw Invalid(key);
        return value;
    }

    private static int RequiredInt(JsonElement owner, string key, int min, int max) =>
        owner.TryGetProperty(key, out var value) && value.TryGetInt32(out var result) && result >= min && result <= max ? result : throw Invalid(key);

    private static int? OptionalInt(JsonElement owner, string key)
    {
        if (!owner.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        return value.TryGetInt32(out var result) && result >= 0 ? result : throw Invalid(key);
    }

    private static long RequiredLong(JsonElement owner, string key) =>
        owner.TryGetProperty(key, out var value) && value.TryGetInt64(out var result) && result >= 0 ? result : throw Invalid(key);

    private static long? OptionalLong(JsonElement owner, string key)
    {
        if (!owner.TryGetProperty(key, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        return value.TryGetInt64(out var result) && result >= 0 ? result : throw Invalid(key);
    }

    private static DateTimeOffset RequiredInstant(JsonElement owner, string key) =>
        OptionalInstant(owner, key) ?? throw Invalid(key);

    private static DateTimeOffset? OptionalInstant(JsonElement owner, string key)
    {
        var text = OptionalText(owner, key, 40);
        if (text is null) return null;
        return DateTimeOffset.TryParse(text, out var result) ? result : throw Invalid(key);
    }

    private static T RequiredEnum<T>(JsonElement owner, string key, int max) where T : struct, Enum =>
        Enum.TryParse<T>(RequiredText(owner, key, max), false, out var result) && Enum.IsDefined(result) ? result : throw Invalid(key);

    private static ReceiptSchemaException Invalid(string key) => new($"Invalid receipt field: {key}");
}

public sealed class ReceiptSchemaException(string message) : Exception(message);
