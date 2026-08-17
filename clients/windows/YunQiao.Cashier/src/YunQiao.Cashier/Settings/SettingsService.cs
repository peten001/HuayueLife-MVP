using System.Text.Json;
using System.Text.Json.Serialization;

namespace YunQiao.Cashier.Settings;

public sealed class SettingsService
{
    public static string RootDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YunQiao", "Cashier");
    private readonly string _path = Path.Combine(RootDirectory, "settings.json");
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public async Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_path)) return AppSettings.CreateDefault();
            await using var input = File.OpenRead(_path);
            var value = await JsonSerializer.DeserializeAsync<AppSettings>(input, _json, cancellationToken);
            return Validate(value) ? value! : AppSettings.CreateDefault();
        }
        catch (JsonException) { return AppSettings.CreateDefault(); }
        finally { _gate.Release(); }
    }

    public async Task SaveAsync(AppSettings value, CancellationToken cancellationToken = default)
    {
        if (!Validate(value)) throw new ArgumentException("Settings are invalid.", nameof(value));
        await _gate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(RootDirectory);
            var temporary = _path + ".tmp";
            await using (var output = File.Create(temporary))
                await JsonSerializer.SerializeAsync(output, value, _json, cancellationToken);
            File.Move(temporary, _path, true);
        }
        finally { _gate.Release(); }
    }

    private static bool Validate(AppSettings? value) => value is not null
        && Guid.TryParse(value.TerminalInstanceId, out _)
        && value.Printers.Count is >= 1 and <= 16
        && value.Printers.Select(item => item.Id).Distinct(StringComparer.Ordinal).Count() == value.Printers.Count
        && value.Printers.All(item => item.Id.Length is >= 1 and <= 128
            && item.DisplayName.Length is >= 1 and <= 80
            && item.Role is "FRONT_DESK" or "KITCHEN" or "BAR" or "LABEL"
            && item.Port is >= 1 and <= 65_535);
}
