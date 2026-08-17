using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using YunQiao.Cashier.Core.Protocol;
using YunQiao.Cashier.Settings;

namespace YunQiao.Cashier.Security;

public sealed record StoredTerminalCredential(
    string MerchantId,
    string TerminalId,
    string TerminalBearer,
    long TokenVersion,
    DateTimeOffset TokenExpiresAt);

public sealed class DpapiCredentialStore
{
    private readonly string _secretPath = Path.Combine(SettingsService.RootDirectory, "terminal-secret.bin");
    private readonly string _credentialPath = Path.Combine(SettingsService.RootDirectory, "terminal-credential.bin");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("YunQiao.Cashier.Terminal.V2");

    public string GetOrCreateTerminalSecret()
    {
        var existing = ReadProtected(_secretPath);
        if (existing is { Length: 43 } && existing.All(value => char.IsAsciiLetterOrDigit(value) || value is '_' or '-')) return existing;
        var bytes = RandomNumberGenerator.GetBytes(32);
        var value = Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        SaveProtected(_secretPath, value);
        return value;
    }

    public void SaveCredential(TerminalBootstrap value) => SaveProtected(
        _credentialPath,
        JsonSerializer.Serialize(new StoredTerminalCredential(
            value.MerchantId, value.TerminalId, value.TerminalBearer, value.TokenVersion, value.TokenExpiresAt)));

    public StoredTerminalCredential? ReadCredential()
    {
        var text = ReadProtected(_credentialPath);
        if (text is null) return null;
        try { return JsonSerializer.Deserialize<StoredTerminalCredential>(text); }
        catch (JsonException) { return null; }
    }

    public void ClearCredential()
    {
        if (File.Exists(_credentialPath)) File.Delete(_credentialPath);
    }

    private static void SaveProtected(string path, string plaintext)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var protectedBytes = Protect(Encoding.UTF8.GetBytes(plaintext));
        var temporary = path + ".tmp";
        File.WriteAllBytes(temporary, protectedBytes);
        File.Move(temporary, path, true);
    }

    private static string? ReadProtected(string path)
    {
        if (!File.Exists(path)) return null;
        try { return Encoding.UTF8.GetString(Unprotect(File.ReadAllBytes(path))); }
        catch (CryptographicException) { return null; }
    }

    private static byte[] Protect(byte[] plaintext) => Crypt(plaintext, protect: true);
    private static byte[] Unprotect(byte[] ciphertext) => Crypt(ciphertext, protect: false);

    private static byte[] Crypt(byte[] input, bool protect)
    {
        var inputBlob = DataBlob.From(input);
        var entropyBlob = DataBlob.From(Entropy);
        try
        {
            DataBlob output;
            var ok = protect
                ? CryptProtectData(ref inputBlob, null, ref entropyBlob, IntPtr.Zero, IntPtr.Zero, 0, out output)
                : CryptUnprotectData(ref inputBlob, IntPtr.Zero, ref entropyBlob, IntPtr.Zero, IntPtr.Zero, 0, out output);
            if (!ok) throw new CryptographicException(Marshal.GetLastWin32Error());
            try
            {
                var result = new byte[output.Size];
                Marshal.Copy(output.Data, result, 0, output.Size);
                return result;
            }
            finally { LocalFree(output.Data); }
        }
        finally
        {
            inputBlob.Free();
            entropyBlob.Free();
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int Size;
        public IntPtr Data;

        public static DataBlob From(byte[] value)
        {
            var data = Marshal.AllocHGlobal(value.Length);
            Marshal.Copy(value, 0, data, value.Length);
            return new DataBlob { Size = value.Length, Data = data };
        }

        public readonly void Free() => Marshal.FreeHGlobal(Data);
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(ref DataBlob input, string? description, ref DataBlob entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(ref DataBlob input, IntPtr description, ref DataBlob entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}
