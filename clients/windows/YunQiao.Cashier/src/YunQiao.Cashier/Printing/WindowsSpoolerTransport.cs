using System.ComponentModel;
using System.Runtime.InteropServices;
using YunQiao.Cashier.Core.Printing;
using YunQiao.Cashier.Core.Protocol;

namespace YunQiao.Cashier.Printing;

public sealed class WindowsSpoolerTransport(string printerName) : IPrinterTransport
{
    private const uint BlockingStatusMask =
        0x00000001 | // PRINTER_STATUS_PAUSED
        0x00000002 | // PRINTER_STATUS_ERROR
        0x00000004 | // PRINTER_STATUS_PENDING_DELETION
        0x00000008 | // PRINTER_STATUS_PAPER_JAM
        0x00000010 | // PRINTER_STATUS_PAPER_OUT
        0x00000020 | // PRINTER_STATUS_MANUAL_FEED
        0x00000040 | // PRINTER_STATUS_PAPER_PROBLEM
        0x00000080 | // PRINTER_STATUS_OFFLINE
        0x00000800 | // PRINTER_STATUS_OUTPUT_BIN_FULL
        0x00001000 | // PRINTER_STATUS_NOT_AVAILABLE
        0x00040000 | // PRINTER_STATUS_NO_TONER
        0x00100000 | // PRINTER_STATUS_USER_INTERVENTION
        0x00200000 | // PRINTER_STATUS_OUT_OF_MEMORY
        0x00400000 | // PRINTER_STATUS_DOOR_OPEN
        0x00800000;  // PRINTER_STATUS_SERVER_UNKNOWN

    public Task<TransportResult> SendAsync(ReadOnlyMemory<byte> bytes, CancellationToken cancellationToken)
    {
        if (bytes.IsEmpty) return Task.FromResult(TransportResult.Failure("EMPTY_PRINT_DATA", "Print bytes are empty.", false));
        if (string.IsNullOrWhiteSpace(printerName)) return Task.FromResult(TransportResult.Failure("CONFIG_INVALID", "Windows printer is not configured.", false));
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => Send(bytes.ToArray()), CancellationToken.None);
    }

    public static IReadOnlyList<string> InstalledPrinterNames()
    {
        const int flags = 0x00000002 | 0x00000004; // PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS
        _ = EnumPrinters(flags, null, 4, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0) return [];
        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!EnumPrinters(flags, null, 4, buffer, needed, out _, out var count))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var size = Marshal.SizeOf<PrinterInfo4>();
            var result = new List<string>((int)count);
            for (var index = 0; index < count; index++)
            {
                var info = Marshal.PtrToStructure<PrinterInfo4>(IntPtr.Add(buffer, index * size));
                var name = Marshal.PtrToStringUni(info.PrinterName);
                if (!string.IsNullOrWhiteSpace(name)) result.Add(name);
            }
            return result.Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.CurrentCultureIgnoreCase).ToArray();
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    public static WindowsSpoolerEvidence Probe(string? configuredPrinterName)
    {
        if (string.IsNullOrWhiteSpace(configuredPrinterName)) return WindowsSpoolerEvidence.NotConfigured();
        if (!OpenPrinter(configuredPrinterName, out var printer, IntPtr.Zero))
            return new WindowsSpoolerEvidence(false, false, false, false, $"OPEN_FAILED_{Marshal.GetLastWin32Error()}");
        try
        {
            var buffer = Marshal.AllocHGlobal(sizeof(uint));
            try
            {
                if (!GetPrinter(printer, 6, buffer, sizeof(uint), out _))
                    return new WindowsSpoolerEvidence(true, true, false, false, $"STATUS_FAILED_{Marshal.GetLastWin32Error()}");
                var status = unchecked((uint)Marshal.ReadInt32(buffer));
                var ready = IsReadyStatus(status);
                return new WindowsSpoolerEvidence(
                    true,
                    true,
                    ready,
                    ready,
                    ready ? "READY" : $"BLOCKED_0x{status:X8}");
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { _ = ClosePrinter(printer); }
    }

    public static bool IsReadyStatus(uint status) => (status & BlockingStatusMask) == 0;

    private TransportResult Send(byte[] bytes)
    {
        if (!OpenPrinter(printerName, out var printer, IntPtr.Zero))
            return TransportResult.Failure("PRINTER_OFFLINE", $"OpenPrinter failed: {Marshal.GetLastWin32Error()}");
        var documentStarted = false;
        var pageStarted = false;
        TransportResult result;
        try
        {
            var info = new DocInfo1 { DocumentName = "YunQiao Receipt", DataType = "RAW", OutputFile = null };
            if (StartDocPrinter(printer, 1, ref info) == 0)
                return TransportResult.Failure("USB_WRITE_FAILED", $"StartDocPrinter failed: {Marshal.GetLastWin32Error()}");
            documentStarted = true;
            if (!StartPagePrinter(printer))
                return TransportResult.Failure("USB_WRITE_FAILED", $"StartPagePrinter failed: {Marshal.GetLastWin32Error()}");
            pageStarted = true;

            var unmanaged = Marshal.AllocHGlobal(bytes.Length);
            try
            {
                Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                if (!WritePrinter(printer, unmanaged, bytes.Length, out var written))
                    result = TransportResult.Uncertain((int)written, "USB_WRITE_FAILED", $"WritePrinter outcome is unknown: {Marshal.GetLastWin32Error()}");
                else if (written != bytes.Length)
                    result = TransportResult.Uncertain((int)written, "USB_WRITE_FAILED", "WritePrinter accepted only part of the receipt.");
                else
                    result = TransportResult.Success((int)written);
            }
            finally { Marshal.FreeHGlobal(unmanaged); }

            if (!EndPagePrinter(printer) && result.Outcome == TransportOutcome.Succeeded)
                result = TransportResult.Uncertain(result.BytesWritten, "USB_WRITE_FAILED", $"EndPagePrinter outcome is unknown: {Marshal.GetLastWin32Error()}");
            pageStarted = false;
            if (!EndDocPrinter(printer) && result.Outcome == TransportOutcome.Succeeded)
                result = TransportResult.Uncertain(result.BytesWritten, "USB_WRITE_FAILED", $"EndDocPrinter outcome is unknown: {Marshal.GetLastWin32Error()}");
            documentStarted = false;
            return result;
        }
        finally
        {
            if (pageStarted) _ = EndPagePrinter(printer);
            if (documentStarted) _ = EndDocPrinter(printer);
            _ = ClosePrinter(printer);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo1
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string DocumentName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? OutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string DataType;
    }

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct PrinterInfo4
    {
        public readonly IntPtr PrinterName;
        public readonly IntPtr ServerName;
        public readonly uint Attributes;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClosePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr printer, int level, ref DocInfo1 documentInfo);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WritePrinter(IntPtr printer, IntPtr bytes, int count, out uint written);

    [DllImport("winspool.drv", EntryPoint = "EnumPrintersW", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumPrinters(int flags, string? name, int level, IntPtr buffer, uint bufferSize, out uint needed, out uint returned);

    [DllImport("winspool.drv", EntryPoint = "GetPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetPrinter(IntPtr printer, int level, IntPtr buffer, int bufferSize, out int needed);
}
