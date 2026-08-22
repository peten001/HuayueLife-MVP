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

public sealed record TerminalBootstrapIdentity(
    string MerchantId,
    string TerminalInstanceId,
    string TerminalSecret,
    bool CanReplaceOnDeviceConflict);

internal sealed record StoredMerchantTerminalProfile(
    string MerchantId,
    string TerminalInstanceId,
    string TerminalSecret,
    StoredTerminalCredential? Credential);

public sealed class DpapiCredentialStore
{
    private readonly string _rootDirectory;
    private readonly string _legacySecretPath;
    private readonly string _legacyCredentialPath;
    private readonly string _profilesDirectory;
    private readonly object _gate = new();
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("YunQiao.Cashier.Terminal.V2");

    public DpapiCredentialStore(string? rootDirectory = null)
    {
        _rootDirectory = rootDirectory ?? SettingsService.RootDirectory;
        _legacySecretPath = Path.Combine(_rootDirectory, "terminal-secret.bin");
        _legacyCredentialPath = Path.Combine(_rootDirectory, "terminal-credential.bin");
        _profilesDirectory = Path.Combine(_rootDirectory, "terminals");
    }

    public TerminalBootstrapIdentity GetBootstrapIdentity(string merchantId, string legacyTerminalInstanceId)
    {
        ValidateMerchantId(merchantId);
        lock (_gate)
        {
            if (ReadProfileUnsafe(merchantId) is { } existing)
                return Identity(existing, canReplaceOnDeviceConflict: false);

            var legacySecret = ReadProtected(_legacySecretPath);
            var legacyCredential = ReadLegacyCredentialUnsafe();
            if (Guid.TryParse(legacyTerminalInstanceId, out _)
                && IsValidSecret(legacySecret)
                && (legacyCredential is null || legacyCredential.MerchantId == merchantId))
            {
                return new TerminalBootstrapIdentity(
                    merchantId,
                    legacyTerminalInstanceId,
                    legacySecret!,
                    CanReplaceOnDeviceConflict: true);
            }

            return CreateProfileUnsafe(merchantId);
        }
    }

    public TerminalBootstrapIdentity ReplaceLegacyIdentityAfterConflict(TerminalBootstrapIdentity conflicted)
    {
        ValidateIdentity(conflicted);
        if (!conflicted.CanReplaceOnDeviceConflict)
            throw new InvalidOperationException("A merchant-scoped terminal identity cannot be replaced automatically.");
        lock (_gate)
        {
            return ReadProfileUnsafe(conflicted.MerchantId) is { } existing
                ? Identity(existing, canReplaceOnDeviceConflict: false)
                : CreateProfileUnsafe(conflicted.MerchantId);
        }
    }

    public void SaveCredential(TerminalBootstrapIdentity identity, TerminalBootstrap value)
    {
        ValidateIdentity(identity);
        if (value.MerchantId != identity.MerchantId)
            throw new ArgumentException("Terminal credential merchant does not match the bootstrap identity.", nameof(value));
        var credential = new StoredTerminalCredential(
            value.MerchantId, value.TerminalId, value.TerminalBearer, value.TokenVersion, value.TokenExpiresAt);
        var profile = new StoredMerchantTerminalProfile(
            identity.MerchantId, identity.TerminalInstanceId, identity.TerminalSecret, credential);
        lock (_gate) SaveProfileUnsafe(profile);
    }

    public StoredTerminalCredential? ReadCredential(string merchantId)
    {
        ValidateMerchantId(merchantId);
        lock (_gate) return ReadProfileUnsafe(merchantId)?.Credential;
    }

    public void ClearCredential(string merchantId)
    {
        ValidateMerchantId(merchantId);
        lock (_gate)
        {
            if (ReadProfileUnsafe(merchantId) is { } profile)
                SaveProfileUnsafe(profile with { Credential = null });
            var legacy = ReadLegacyCredentialUnsafe();
            if (legacy?.MerchantId == merchantId && File.Exists(_legacyCredentialPath))
                File.Delete(_legacyCredentialPath);
        }
    }

    private TerminalBootstrapIdentity CreateProfileUnsafe(string merchantId)
    {
        var profile = new StoredMerchantTerminalProfile(
            merchantId,
            Guid.NewGuid().ToString(),
            CreateSecret(),
            Credential: null);
        SaveProfileUnsafe(profile);
        return Identity(profile, canReplaceOnDeviceConflict: false);
    }

    private StoredMerchantTerminalProfile? ReadProfileUnsafe(string merchantId)
    {
        var text = ReadProtected(ProfilePath(merchantId));
        if (text is null) return null;
        try
        {
            var profile = JsonSerializer.Deserialize<StoredMerchantTerminalProfile>(text);
            return IsValidProfile(profile, merchantId) ? profile : null;
        }
        catch (JsonException) { return null; }
    }

    private StoredTerminalCredential? ReadLegacyCredentialUnsafe()
    {
        var text = ReadProtected(_legacyCredentialPath);
        if (text is null) return null;
        try
        {
            var credential = JsonSerializer.Deserialize<StoredTerminalCredential>(text);
            return credential is not null && IsValidMerchantId(credential.MerchantId) ? credential : null;
        }
        catch (JsonException) { return null; }
    }

    private void SaveProfileUnsafe(StoredMerchantTerminalProfile profile) =>
        SaveProtected(ProfilePath(profile.MerchantId), JsonSerializer.Serialize(profile));

    private string ProfilePath(string merchantId) => Path.Combine(_profilesDirectory, $"{merchantId}.bin");

    private static TerminalBootstrapIdentity Identity(StoredMerchantTerminalProfile profile, bool canReplaceOnDeviceConflict) =>
        new(profile.MerchantId, profile.TerminalInstanceId, profile.TerminalSecret, canReplaceOnDeviceConflict);

    private static bool IsValidProfile(StoredMerchantTerminalProfile? profile, string merchantId) =>
        profile is not null
        && profile.MerchantId == merchantId
        && Guid.TryParse(profile.TerminalInstanceId, out _)
        && IsValidSecret(profile.TerminalSecret)
        && (profile.Credential is null || profile.Credential.MerchantId == merchantId);

    private static void ValidateIdentity(TerminalBootstrapIdentity identity)
    {
        ValidateMerchantId(identity.MerchantId);
        if (!Guid.TryParse(identity.TerminalInstanceId, out _) || !IsValidSecret(identity.TerminalSecret))
            throw new ArgumentException("Terminal bootstrap identity is invalid.", nameof(identity));
    }

    private static void ValidateMerchantId(string merchantId)
    {
        if (!IsValidMerchantId(merchantId)) throw new ArgumentException("Merchant id is invalid.", nameof(merchantId));
    }

    private static bool IsValidMerchantId(string? value) =>
        value is { Length: >= 1 and <= 19 }
        && value[0] != '0'
        && value.All(char.IsAsciiDigit);

    private static bool IsValidSecret(string? value) =>
        value is { Length: 43 } && value.All(character => char.IsAsciiLetterOrDigit(character) || character is '_' or '-');

    private static string CreateSecret()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
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
