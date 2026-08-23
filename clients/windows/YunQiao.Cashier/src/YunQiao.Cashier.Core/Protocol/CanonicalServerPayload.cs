namespace YunQiao.Cashier.Core.Protocol;

public static class CanonicalServerPayload
{
    private const string Protocol = "ESC_POS_RASTER_V1";
    private const string Template = "YQ_CANONICAL_RECEIPT_V1";

    public static byte[]? ForJob(ClaimedPrintJob job, int expectedWidthDots)
    {
        if (job.RenderProtocol is null) return null;
        if (job.RenderProtocol != Protocol)
            throw new InvalidDataException($"Unsupported server render protocol: {job.RenderProtocol}");
        if (job.CanonicalTemplateVersion != Template || job.WidthDots != expectedWidthDots)
            throw new InvalidDataException("Canonical payload profile mismatch.");
        return job.RenderedPayload?.ToArray()
            ?? throw new InvalidDataException("Canonical payload is missing.");
    }
}
