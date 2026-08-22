using System.Text;
using System.Text.RegularExpressions;

namespace YunQiao.Cashier.Logging;

public static partial class AppLog
{
    private static readonly object Gate = new();
    private static string? _directory;

    public static void Initialize()
    {
        _directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "YunQiao", "Cashier", "logs");
        Directory.CreateDirectory(_directory);
        foreach (var file in Directory.EnumerateFiles(_directory, "cashier-*.log"))
        {
            if (File.GetCreationTimeUtc(file) < DateTime.UtcNow.AddDays(-14))
                try { File.Delete(file); } catch (IOException) { }
        }
    }

    public static void Info(string code, string? detail = null) => Write("INFO", code, detail);
    public static void Warn(string code, string? detail = null) => Write("WARN", code, detail);
    public static void Error(string code, Exception? error = null) => Write("ERROR", code, error is null ? null : $"{error.GetType().Name}: {error.Message}");

    private static void Write(string level, string code, string? detail)
    {
        if (_directory is null) Initialize();
        var safe = Redact(detail ?? string.Empty);
        var line = $"{DateTimeOffset.Now:O} {level} {code}{(safe.Length == 0 ? string.Empty : " " + safe)}{Environment.NewLine}";
        var path = Path.Combine(_directory!, $"cashier-{DateTime.Now:yyyyMMdd}.log");
        lock (Gate) File.AppendAllText(path, line, new UTF8Encoding(false));
    }

    private static string Redact(string value)
    {
        var safe = TerminalBearerRegex().Replace(value, "[redacted-terminal-credential]");
        safe = JwtRegex().Replace(safe, "[redacted-jwt]");
        safe = SecretRegex().Replace(safe, "$1=[redacted]");
        return safe[..Math.Min(safe.Length, 500)];
    }

    [GeneratedRegex(@"\byt1\.[1-9][0-9]{0,18}\.[A-Za-z0-9_-]{43}\b", RegexOptions.IgnoreCase)]
    private static partial Regex TerminalBearerRegex();
    [GeneratedRegex(@"\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")]
    private static partial Regex JwtRegex();
    [GeneratedRegex(@"(token|password|secret|cookie|authorization|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+", RegexOptions.IgnoreCase)]
    private static partial Regex SecretRegex();
}
