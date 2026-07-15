package com.yunqiao.life.merchantterminal.web

enum class TerminalLoadErrorType(
    val code: String,
    val titleZh: String,
    val titleVi: String,
    val descriptionZh: String,
    val descriptionVi: String,
) {
    NO_NETWORK(
        code = "E_NO_NETWORK",
        titleZh = "网络连接已断开",
        titleVi = "Không có kết nối mạng",
        descriptionZh = "请检查 Wi-Fi 或网线连接，网络恢复后可重新加载。",
        descriptionVi = "Vui lòng kiểm tra Wi-Fi hoặc cáp mạng, sau đó tải lại trang.",
    ),
    DNS_FAILURE(
        code = "E_DNS_FAILURE",
        titleZh = "无法解析服务器地址",
        titleVi = "Không thể phân giải địa chỉ máy chủ",
        descriptionZh = "请检查 DNS 与网络设置，或联系技术支持。",
        descriptionVi = "Vui lòng kiểm tra DNS và cài đặt mạng hoặc liên hệ hỗ trợ.",
    ),
    CONNECTION_TIMEOUT(
        code = "E_CONNECTION_TIMEOUT",
        titleZh = "连接服务器超时",
        titleVi = "Kết nối máy chủ quá thời gian",
        descriptionZh = "当前网络可能较慢，请稍后重新加载。",
        descriptionVi = "Mạng có thể đang chậm. Vui lòng thử tải lại sau.",
    ),
    SSL_ERROR(
        code = "E_SSL_ERROR",
        titleZh = "服务器安全证书无效",
        titleVi = "Chứng chỉ bảo mật máy chủ không hợp lệ",
        descriptionZh = "为保护商家账号，终端已停止加载。请勿绕过此错误。",
        descriptionVi = "Để bảo vệ tài khoản, thiết bị đã dừng tải trang. Không bỏ qua lỗi này.",
    ),
    HTTP_ERROR(
        code = "E_HTTP_ERROR",
        titleZh = "服务器返回错误",
        titleVi = "Máy chủ trả về lỗi",
        descriptionZh = "商家后台暂时无法正常响应，请稍后重试。",
        descriptionVi = "Trang quản trị tạm thời không phản hồi. Vui lòng thử lại sau.",
    ),
    RENDERER_GONE(
        code = "E_WEBVIEW_RENDERER",
        titleZh = "页面渲染进程已停止",
        titleVi = "Tiến trình hiển thị trang đã dừng",
        descriptionZh = "终端已安全回收页面进程，请重新加载。",
        descriptionVi = "Thiết bị đã khôi phục an toàn tiến trình. Vui lòng tải lại.",
    ),
    UNSAFE_RESOURCE(
        code = "E_UNSAFE_RESOURCE",
        titleZh = "已阻止不安全页面",
        titleVi = "Đã chặn trang không an toàn",
        descriptionZh = "该页面被 Android 安全浏览判定为不安全。",
        descriptionVi = "Android Safe Browsing xác định trang này không an toàn.",
    ),
    CONFIGURATION(
        code = "E_CASHIER_URL_NOT_CONFIGURED",
        titleZh = "Web 收银台地址尚未配置",
        titleVi = "Chưa cấu hình địa chỉ quầy thu ngân Web",
        descriptionZh = "USB 诊断仍可使用；请在构建时配置可信的 HTTPS 收银台地址和精确 Origin。",
        descriptionVi = "Vẫn có thể chẩn đoán USB; hãy cấu hình URL HTTPS và Origin tin cậy khi xây dựng.",
    ),
    PAGE_LOAD_FAILURE(
        code = "E_PAGE_LOAD_FAILURE",
        titleZh = "页面加载失败",
        titleVi = "Không thể tải trang",
        descriptionZh = "请检查网络后重新加载；如持续失败，请打开终端诊断。",
        descriptionVi = "Hãy kiểm tra mạng và tải lại; nếu vẫn lỗi, hãy mở chẩn đoán.",
    ),
}

data class TerminalLoadError(
    val type: TerminalLoadErrorType,
    val platformCode: Int? = null,
    val detail: String? = null,
    val failingUrl: String? = null,
) {
    val diagnosticCode: String
        get() = buildString {
            append(type.code)
            platformCode?.let { append(" / ").append(it) }
            detail?.takeIf(String::isNotBlank)?.let { append(" / ").append(it.take(160)) }
        }
}
