using System.Buffers;

namespace YunQiao.Cashier.Core.Printing;

public enum CutMode { None, Half, Full }

public sealed class MonochromeRaster
{
    public MonochromeRaster(int width, int height, IReadOnlyList<bool> blackPixels)
    {
        if (width is < 1 or > 1_024 || height is < 1 or > 8_000)
            throw new ArgumentOutOfRangeException(nameof(width), "Raster dimensions are outside the Android-compatible range.");
        if (blackPixels.Count != width * height)
            throw new ArgumentException("Raster pixel count does not match dimensions.", nameof(blackPixels));
        Width = width;
        Height = height;
        BlackPixels = blackPixels;
    }

    public int Width { get; }
    public int Height { get; }
    public IReadOnlyList<bool> BlackPixels { get; }
    public bool this[int x, int y] => BlackPixels[y * Width + x];
}

/// <summary>Byte-compatible port of Android EscPosRasterEncoder.</summary>
public static class EscPosRasterEncoder
{
    public const int RasterStripHeight = 256;
    private static readonly byte[] EscInit = [0x1b, 0x40];
    private static readonly byte[] AlignCenter = [0x1b, 0x61, 0x01];
    private static readonly byte[] FeedAfterDocument = [0x0a, 0x0a, 0x0a];

    public static byte[] Encode(MonochromeRaster raster, CutMode cutMode)
    {
        var bytesPerRow = (raster.Width + 7) / 8;
        using var output = new MemoryStream(16 + bytesPerRow * raster.Height);
        output.Write(EscInit);
        output.Write(AlignCenter);
        for (var stripStart = 0; stripStart < raster.Height; stripStart += RasterStripHeight)
        {
            var rows = Math.Min(RasterStripHeight, raster.Height - stripStart);
            WriteRasterHeader(output, bytesPerRow, rows);
            for (var y = stripStart; y < stripStart + rows; y++)
            {
                for (var byteIndex = 0; byteIndex < bytesPerRow; byteIndex++)
                {
                    var packed = 0;
                    for (var bit = 0; bit < 8; bit++)
                    {
                        var x = byteIndex * 8 + bit;
                        if (x < raster.Width && raster[x, y]) packed |= 0x80 >> bit;
                    }
                    output.WriteByte((byte)packed);
                }
            }
        }
        output.Write(FeedAfterDocument);
        output.Write(CutCommand(cutMode));
        return output.ToArray();
    }

    /// <summary>Memory-bounded encoder for Windows WPF BGRA pixels.</summary>
    public static byte[] EncodeBgra32(int width, int height, ReadOnlySpan<byte> pixels, int stride, int threshold, CutMode cutMode)
    {
        if (width is < 200 or > 1_024 || height is < 1 or > 8_000)
            throw new ArgumentOutOfRangeException(nameof(width), "Bitmap dimensions are outside the supported raster range.");
        if (threshold is < 0 or > 255) throw new ArgumentOutOfRangeException(nameof(threshold));
        if (stride < width * 4 || pixels.Length < stride * height) throw new ArgumentException("BGRA buffer is too small.", nameof(pixels));

        var bytesPerRow = (width + 7) / 8;
        using var output = new MemoryStream(16 + bytesPerRow * height);
        output.Write(EscInit);
        output.Write(AlignCenter);
        for (var stripStart = 0; stripStart < height; stripStart += RasterStripHeight)
        {
            var rows = Math.Min(RasterStripHeight, height - stripStart);
            WriteRasterHeader(output, bytesPerRow, rows);
            for (var y = stripStart; y < stripStart + rows; y++)
            {
                var rowOffset = y * stride;
                for (var byteIndex = 0; byteIndex < bytesPerRow; byteIndex++)
                {
                    var packed = 0;
                    for (var bit = 0; bit < 8; bit++)
                    {
                        var x = byteIndex * 8 + bit;
                        if (x >= width) continue;
                        var offset = rowOffset + x * 4;
                        var blue = pixels[offset];
                        var green = pixels[offset + 1];
                        var red = pixels[offset + 2];
                        var alpha = pixels[offset + 3];
                        red = CompositeOnWhite(red, alpha);
                        green = CompositeOnWhite(green, alpha);
                        blue = CompositeOnWhite(blue, alpha);
                        var luminance = (red * 299 + green * 587 + blue * 114) / 1_000;
                        if (luminance <= threshold) packed |= 0x80 >> bit;
                    }
                    output.WriteByte((byte)packed);
                }
            }
        }
        output.Write(FeedAfterDocument);
        output.Write(CutCommand(cutMode));
        return output.ToArray();
    }

    public static byte[] CutCommand(CutMode cutMode) => cutMode switch
    {
        CutMode.None => [],
        CutMode.Half => [0x1d, 0x56, 0x01],
        CutMode.Full => [0x1d, 0x56, 0x00],
        _ => throw new ArgumentOutOfRangeException(nameof(cutMode)),
    };

    private static byte CompositeOnWhite(byte channel, byte alpha) =>
        (byte)((channel * alpha + 255 * (255 - alpha)) / 255);

    private static void WriteRasterHeader(Stream output, int bytesPerRow, int rows)
    {
        Span<byte> header =
        [
            0x1d, 0x76, 0x30, 0x00,
            (byte)(bytesPerRow & 0xff), (byte)((bytesPerRow >> 8) & 0xff),
            (byte)(rows & 0xff), (byte)((rows >> 8) & 0xff),
        ];
        output.Write(header);
    }
}
