using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Core.Tests;

public sealed class CanonicalServerPayloadPolicyTests
{
    [Fact]
    public void CanonicalJobReturnsAnExactCopyWithoutLocalLayout()
    {
        var payload = new byte[] { 0x1b, 0x40, 0x1d, 0x56, 0x01 };
        var received = CanonicalServerPayload.ForJob(Job("ESC_POS_RASTER_V1", payload), 576);

        Assert.Equal(payload, received);
        Assert.NotSame(payload, received);
    }

    [Fact]
    public void LegacyIsTheOnlyProtocolAllowedToReachTheLegacyRenderer()
    {
        Assert.Null(CanonicalServerPayload.ForJob(Job(null), 576));
        Assert.Throws<InvalidDataException>(() =>
            CanonicalServerPayload.ForJob(Job("FUTURE_LAYOUT_V9"), 576));
        Assert.Throws<InvalidDataException>(() =>
            CanonicalServerPayload.ForJob(Job("ESC_POS_RASTER_V1", [1]), 384));
    }

    private static ClaimedPrintJob Job(string? protocol, byte[]? payload = null) => new(
        "1", "18", "43", "CLAIMED", "TABLE_BILL", "AUTOMATIC", 0, null, 1,
        DateTimeOffset.UtcNow.AddMinutes(1), new string('a', 64), 3, "{}",
        new RouteIdentity("43", "binding", 1, PrinterTransportKind.WindowsSpooler),
        "ANDROID_USB_ESCPOS", protocol, "YQ_CANONICAL_RECEIPT_V1", payload,
        new string('b', 64), payload?.Length, 80, 576);
}
