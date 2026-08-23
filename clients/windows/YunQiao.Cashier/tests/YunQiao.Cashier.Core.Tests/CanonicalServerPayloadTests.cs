using System.Security.Cryptography;
using System.Text.Json;

namespace YunQiao.Cashier.Core.Tests;

public sealed class CanonicalServerPayloadTests
{
    [Fact]
    public void WindowsVerifiesTheSharedServerPayloadWithoutRendering()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(SharedFixture()));
        var root = fixture.RootElement;
        var payload = Convert.FromBase64String(root.GetProperty("payloadBase64").GetString()!);
        var sha = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant();
        Assert.Equal(root.GetProperty("byteLength").GetInt32(), payload.Length);
        Assert.Equal(root.GetProperty("sha256").GetString(), sha);
        Assert.Equal("ESC_POS_RASTER_V1", root.GetProperty("renderProtocol").GetString());
    }

    private static string SharedFixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        for (var index = 0; index < 10 && current is not null; index++, current = current.Parent)
        {
            var candidate = Path.Combine(current.FullName, "fixtures", "printing", "server-esc-pos-payload-v1.json");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("Shared canonical payload fixture was not found.");
    }
}
