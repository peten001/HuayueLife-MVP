using YunQiao.Cashier.Core.Printing;

namespace YunQiao.Cashier.Core.Tests;

public sealed class EscPosRasterEncoderTests
{
    [Fact]
    public void MatchesAndroidRasterHeaderPackingFeedAndHalfCut()
    {
        var raster = new MonochromeRaster(8, 1, [true, false, true, false, true, false, true, false]);
        var bytes = EscPosRasterEncoder.Encode(raster, CutMode.Half);
        byte[] expected =
        [
            0x1b, 0x40, 0x1b, 0x61, 0x01,
            0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00,
            0xaa,
            0x0a, 0x0a, 0x0a,
            0x1d, 0x56, 0x01,
        ];
        Assert.Equal(expected, bytes);
    }

    [Fact]
    public void SplitsLargeRasterAtTheSame256RowBoundaryAsAndroid()
    {
        var raster = new MonochromeRaster(8, 257, new bool[8 * 257]);
        var bytes = EscPosRasterEncoder.Encode(raster, CutMode.None);

        Assert.Equal(0x00, bytes[11]);
        Assert.Equal(0x01, bytes[12]); // first strip: 256 rows
        var secondHeader = 13 + 256;
        Assert.Equal(new byte[] { 0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00 }, bytes[secondHeader..(secondHeader + 8)]);
        Assert.Equal(new byte[] { 0x0a, 0x0a, 0x0a }, bytes[^3..]);
    }
}
