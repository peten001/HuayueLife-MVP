using System.Security.Cryptography;

namespace YunQiao.Cashier.Core.Protocol;

public static class ServerPayloadIntegrity
{
    public static byte[] DecodeBase64(string encoded, int declaredLength, string? expectedSha256)
    {
        byte[] payload;
        try { payload = Convert.FromBase64String(encoded); }
        catch (FormatException error)
        {
            throw new TerminalApiException(200, "PAYLOAD_INTEGRITY_FAIL", "Server payload base64 is invalid.", error);
        }
        var actual = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
        if (payload.Length != declaredLength || expectedSha256?.Length != 64 ||
            !string.Equals(actual, expectedSha256, StringComparison.Ordinal))
            throw new TerminalApiException(200, "PAYLOAD_INTEGRITY_FAIL", "Server payload hash mismatch.");
        return payload;
    }
}
