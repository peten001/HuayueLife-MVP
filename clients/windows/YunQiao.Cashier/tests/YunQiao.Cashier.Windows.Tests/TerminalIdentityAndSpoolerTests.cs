using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Printing;
using YunQiao.Cashier.Security;
using YunQiao.Cashier.Settings;

namespace YunQiao.Cashier.Windows.Tests;

public sealed class TerminalIdentityAndSpoolerTests
{
    [Fact]
    public async Task FirstSettingsLoadPersistsAStableInstallationIdentity()
    {
        var root = TemporaryDirectory();
        try
        {
            var settings = new SettingsService(root);
            var first = await settings.LoadAsync();
            var second = await settings.LoadAsync();

            Assert.Equal(first.TerminalInstanceId, second.TerminalInstanceId);
            Assert.True(File.Exists(Path.Combine(root, "settings.json")));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public void KeepsTerminalIdentityAndCredentialIsolatedPerMerchant()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new DpapiCredentialStore(root);
            var legacyId = Guid.NewGuid().ToString();
            var merchant18 = store.GetBootstrapIdentity("18", legacyId);
            var merchant2 = store.GetBootstrapIdentity("2", legacyId);

            Assert.NotEqual(merchant18.TerminalInstanceId, merchant2.TerminalInstanceId);
            Assert.NotEqual(merchant18.TerminalSecret, merchant2.TerminalSecret);
            Assert.Equal(merchant18, store.GetBootstrapIdentity("18", legacyId));
            Assert.Equal(merchant2, store.GetBootstrapIdentity("2", legacyId));

            var bootstrap = new TerminalBootstrap(
                "18",
                "101",
                $"yt1.101.{merchant18.TerminalSecret}",
                1,
                DateTimeOffset.UtcNow.AddYears(1));
            store.SaveCredential(merchant18, bootstrap);
            Assert.Equal("101", store.ReadCredential("18")?.TerminalId);
            Assert.Null(store.ReadCredential("2"));

            store.ClearCredential("18");
            Assert.Null(store.ReadCredential("18"));
            Assert.Equal(merchant18, store.GetBootstrapIdentity("18", legacyId));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public void ReplacesOnlyAnUnmigratedLegacyIdentityAfterServerConflict()
    {
        var root = TemporaryDirectory();
        try
        {
            var store = new DpapiCredentialStore(root);
            var legacy = new TerminalBootstrapIdentity(
                "18",
                Guid.NewGuid().ToString(),
                new string('A', 43),
                CanReplaceOnDeviceConflict: true);

            var replacement = store.ReplaceLegacyIdentityAfterConflict(legacy);

            Assert.False(replacement.CanReplaceOnDeviceConflict);
            Assert.NotEqual(legacy.TerminalInstanceId, replacement.TerminalInstanceId);
            Assert.NotEqual(legacy.TerminalSecret, replacement.TerminalSecret);
            Assert.Equal(replacement, store.GetBootstrapIdentity("18", legacy.TerminalInstanceId));
            Assert.Throws<InvalidOperationException>(() =>
                store.ReplaceLegacyIdentityAfterConflict(replacement));
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Theory]
    [InlineData(0x00000000, true)]
    [InlineData(0x00000200, true)]
    [InlineData(0x00000400, true)]
    [InlineData(0x00000010, false)]
    [InlineData(0x00000080, false)]
    [InlineData(0x00100000, false)]
    public void ClassifiesWindowsSpoolerBlockingStatus(uint status, bool expectedReady)
    {
        Assert.Equal(expectedReady, WindowsSpoolerTransport.IsReadyStatus(status));
    }

    private static string TemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"yunqiao-cashier-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}
