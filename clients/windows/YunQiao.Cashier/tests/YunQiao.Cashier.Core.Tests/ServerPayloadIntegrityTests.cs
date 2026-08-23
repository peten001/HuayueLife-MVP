using System.Security.Cryptography;
using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Core.Tests;

public sealed class ServerPayloadIntegrityTests
{
    [Fact]
    public void AcceptsOnlyAnExactBase64LengthAndShaTuple()
    {
        byte[] payload = [0x1b, 0x40, 0x1d, 0x56, 0x01];
        var encoded = Convert.ToBase64String(payload);
        var sha = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();

        Assert.Equal(payload, ServerPayloadIntegrity.DecodeBase64(encoded, payload.Length, sha));
        Assert.Equal("PAYLOAD_INTEGRITY_FAIL", Assert.Throws<TerminalApiException>(() =>
            ServerPayloadIntegrity.DecodeBase64(encoded, payload.Length - 1, sha)).ErrorCode);
        Assert.Equal("PAYLOAD_INTEGRITY_FAIL", Assert.Throws<TerminalApiException>(() =>
            ServerPayloadIntegrity.DecodeBase64(encoded, payload.Length, new string('0', 64))).ErrorCode);
    }
}
