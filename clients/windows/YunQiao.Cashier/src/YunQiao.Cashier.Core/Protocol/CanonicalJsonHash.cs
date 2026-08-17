using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace YunQiao.Cashier.Core.Protocol;

/// <summary>Mirrors apps/api snapshot-hash.ts and Android CanonicalReceiptHash.</summary>
public static class CanonicalJsonHash
{
    private const int MaxDepth = 64;
    private const int MaxNodes = 25_000;
    private const long MaxSafeInteger = 9_007_199_254_740_991;

    public static string Compute(string json)
    {
        using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = MaxDepth });
        var nodes = 0;
        var canonical = Encode(document.RootElement, 0, ref nodes);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    public static bool Matches(string json, string expectedLowerHex)
    {
        if (expectedLowerHex.Length != 64 || expectedLowerHex.Any(value => !Uri.IsHexDigit(value)) || expectedLowerHex != expectedLowerHex.ToLowerInvariant())
            return false;
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(Compute(json)),
            Encoding.ASCII.GetBytes(expectedLowerHex));
    }

    public static string Canonicalize(string json)
    {
        using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = MaxDepth });
        var nodes = 0;
        return Encode(document.RootElement, 0, ref nodes);
    }

    private static string Encode(JsonElement value, int depth, ref int nodes)
    {
        if (depth > MaxDepth) throw new InvalidDataException("Receipt snapshot nesting is too deep.");
        nodes++;
        if (nodes > MaxNodes) throw new InvalidDataException("Receipt snapshot contains too many values.");
        return value.ValueKind switch
        {
            JsonValueKind.Object => EncodeObject(value, depth, ref nodes),
            JsonValueKind.Array => EncodeArray(value, depth, ref nodes),
            JsonValueKind.String => Quote(value.GetString() ?? string.Empty),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => "null",
            JsonValueKind.Number => EncodeInteger(value),
            _ => throw new InvalidDataException($"Unsupported receipt snapshot value: {value.ValueKind}"),
        };
    }

    private static string EncodeObject(JsonElement value, int depth, ref int nodes)
    {
        var parts = new List<string>();
        foreach (var property in value.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal))
        {
            var name = Quote(property.Name);
            parts.Add($"{name}:{Encode(property.Value, depth + 1, ref nodes)}");
        }
        return $"{{{string.Join(',', parts)}}}";
    }

    private static string EncodeArray(JsonElement value, int depth, ref int nodes)
    {
        var parts = new List<string>();
        foreach (var item in value.EnumerateArray()) parts.Add(Encode(item, depth + 1, ref nodes));
        return $"[{string.Join(',', parts)}]";
    }

    private static string EncodeInteger(JsonElement value)
    {
        var raw = value.GetRawText();
        if (!decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) || number != decimal.Truncate(number))
            throw new InvalidDataException("Receipt numbers must be integers.");
        if (number is < -MaxSafeInteger or > MaxSafeInteger)
            throw new InvalidDataException("Receipt number exceeds the JavaScript safe integer range.");
        return decimal.Truncate(number).ToString("0", CultureInfo.InvariantCulture);
    }

    private static string Quote(string value)
    {
        var output = new StringBuilder(value.Length + 2).Append('"');
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            switch (character)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break;
                case '\f': output.Append("\\f"); break;
                case '\n': output.Append("\\n"); break;
                case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if (character < 0x20 || (char.IsSurrogate(character)
                        && !(char.IsHighSurrogate(character) && index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))))
                    {
                        output.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        output.Append(character);
                        if (char.IsHighSurrogate(character)) output.Append(value[++index]);
                    }
                    break;
            }
        }
        return output.Append('"').ToString();
    }
}
