namespace YunQiao.Cashier.Web;

public static class OriginPolicy
{
    public static readonly Uri CashierUri = new("https://cashier.huayueyouxuan.com/");
    public static readonly Uri ApiBaseUri = new("https://api.huayueyouxuan.com/api/v1/");
    public const string AccessTokenKey = "yunqiao_cashier_access_token";
    public const string UserAgentCompatibility = "YunQiaoMerchantTerminal/2.0 YunQiaoWindowsCashier/1.0";

    public static bool IsTrustedTopLevel(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.Host.Equals(CashierUri.Host, StringComparison.OrdinalIgnoreCase)
        && uri.Port == 443;

    public static bool IsHttp(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
}
