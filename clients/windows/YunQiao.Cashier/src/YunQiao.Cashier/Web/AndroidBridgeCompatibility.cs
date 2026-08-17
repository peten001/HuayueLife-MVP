namespace YunQiao.Cashier.Web;

public static class AndroidBridgeCompatibility
{
    public const string InjectionScript = """
        (() => {
          const send = (channel, payload) => {
            if (window.top !== window) return;
            window.chrome.webview.postMessage({ channel, payload: String(payload) });
          };
          if (!window.YunQiaoMerchantSession) {
            Object.defineProperty(window, 'YunQiaoMerchantSession', {
              value: Object.freeze({ postMessage: (message) => send('session', message) }),
              configurable: false,
              writable: false
            });
          }
          if (!window.YunQiaoMerchantTerminal) {
            Object.defineProperty(window, 'YunQiaoMerchantTerminal', {
              value: Object.freeze({ postMessage: (message) => send('terminal', message) }),
              configurable: false,
              writable: false
            });
          }
        })();
        """;

    public static bool IsSessionMessage(string value) => value is "SIGNED_OUT" or "SESSION_CHANGED"
        || value is "LANGUAGE_CHANGED:zh" or "LANGUAGE_CHANGED:vi" or "LANGUAGE_CHANGED:en";

    public static bool IsOpenPrinterDevices(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 160) return false;
        try
        {
            using var parsed = System.Text.Json.JsonDocument.Parse(value);
            var root = parsed.RootElement;
            if (root.ValueKind != System.Text.Json.JsonValueKind.Object || root.EnumerateObject().Count() != 2) return false;
            return root.TryGetProperty("type", out var type)
                && type.ValueKind == System.Text.Json.JsonValueKind.String
                && type.GetString() == "OPEN_PRINTER_DEVICES"
                && root.TryGetProperty("version", out var version)
                && version.ValueKind == System.Text.Json.JsonValueKind.Number
                && version.TryGetInt32(out var number)
                && number == 1;
        }
        catch (System.Text.Json.JsonException) { return false; }
    }
}
