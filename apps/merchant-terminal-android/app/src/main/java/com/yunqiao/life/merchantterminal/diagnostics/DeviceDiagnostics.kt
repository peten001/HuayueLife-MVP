package com.yunqiao.life.merchantterminal.diagnostics

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.PowerManager
import android.os.StatFs
import android.view.WindowManager
import android.webkit.WebSettings
import androidx.webkit.WebViewCompat
import com.yunqiao.life.merchantterminal.BuildConfig
import java.text.DateFormat
import java.text.DecimalFormat
import java.util.Date

/**
 * Collects read-only device and application information for field diagnostics.
 *
 * This class deliberately does not collect account identifiers, tokens, page contents, IP
 * addresses, or other merchant data. Web load callbacks may record only a timestamp and a short
 * technical error description through [recordWebLoadSuccess] and [recordWebLoadError].
 */
object DeviceDiagnostics {
    private const val DIAGNOSTICS_PREFERENCES = "terminal_diagnostics"
    private const val KEY_LAST_WEB_LOAD_SUCCESS = "last_web_load_success"
    private const val KEY_LAST_WEB_LOAD_ERROR = "last_web_load_error"

    data class Snapshot(
        val appName: String,
        val appVersion: String,
        val versionCode: Long,
        val packageName: String,
        val manufacturer: String,
        val model: String,
        val androidVersion: String,
        val apiLevel: Int,
        val webViewVersion: String,
        val networkType: String,
        val isConnected: String,
        val merchantAdminUrl: String,
        val userAgent: String,
        val keepScreenOn: String,
        val powerSaveMode: String,
        val batteryOptimization: String,
        val notificationsAllowed: String,
        val backgroundDataAllowed: String,
        val screenResolution: String,
        val orientation: String,
        val availableMemory: String,
        val availableStorage: String,
        val currentTime: String,
        val lastWebLoadSuccess: String,
        val lastWebLoadError: String,
        val buildIdentifier: String,
        val unknownSourcesStatus: String,
    ) {
        fun asDisplayText(): String = buildString {
            appendLine("云桥 Life 商家终端 / Thiết bị đầu cuối YunQiao Life")
            appendLine()
            appendLine("APP 名称 / Tên ứng dụng: $appName")
            appendLine("APP 版本 / Phiên bản: $appVersion")
            appendLine("versionCode: $versionCode")
            appendLine("包名 / Tên gói: $packageName")
            appendLine("设备厂商 / Nhà sản xuất: $manufacturer")
            appendLine("设备型号 / Model: $model")
            appendLine("Android 版本 / Phiên bản Android: $androidVersion")
            appendLine("Android API Level: $apiLevel")
            appendLine("WebView 版本 / Phiên bản WebView: $webViewVersion")
            appendLine("网络类型 / Loại mạng: $networkType")
            appendLine("是否联网 / Đã kết nối: $isConnected")
            appendLine("merchant-admin URL: $merchantAdminUrl")
            appendLine("User-Agent: $userAgent")
            appendLine("屏幕常亮 / Luôn bật màn hình: $keepScreenOn")
            appendLine("省电模式 / Chế độ tiết kiệm pin: $powerSaveMode")
            appendLine("电池优化 / Tối ưu hóa pin: $batteryOptimization")
            appendLine("通知权限 / Quyền thông báo: $notificationsAllowed")
            appendLine("后台数据 / Dữ liệu nền: $backgroundDataAllowed")
            appendLine("屏幕分辨率 / Độ phân giải: $screenResolution")
            appendLine("当前方向 / Hướng màn hình: $orientation")
            appendLine("可用内存 / RAM khả dụng: $availableMemory")
            appendLine("可用存储 / Bộ nhớ khả dụng: $availableStorage")
            appendLine("当前时间 / Thời gian hiện tại: $currentTime")
            appendLine("最近网页加载成功 / Tải trang thành công gần nhất: $lastWebLoadSuccess")
            appendLine("最近网页加载错误 / Lỗi tải trang gần nhất: $lastWebLoadError")
            appendLine("构建标识 / Mã bản dựng: $buildIdentifier")
            append("未知来源安装 / Cài đặt nguồn không xác định: $unknownSourcesStatus")
        }
    }

    fun collect(activity: Activity): Snapshot {
        val context = activity.applicationContext
        val packageInfo = packageInfo(context)
        val preferences = context.getSharedPreferences(
            DIAGNOSTICS_PREFERENCES,
            Context.MODE_PRIVATE,
        )

        return Snapshot(
            appName = context.applicationInfo.loadLabel(context.packageManager).toString(),
            appVersion = packageInfo.versionName ?: "未知 / Không xác định",
            versionCode = packageInfo.longVersionCodeCompat(),
            packageName = context.packageName,
            manufacturer = Build.MANUFACTURER.orUnknown(),
            model = Build.MODEL.orUnknown(),
            androidVersion = Build.VERSION.RELEASE.orUnknown(),
            apiLevel = Build.VERSION.SDK_INT,
            webViewVersion = currentWebViewVersion(context),
            networkType = currentNetworkType(context),
            isConnected = connectivityStatus(context),
            merchantAdminUrl = BuildConfig.MERCHANT_ADMIN_URL
                .takeIf { it.isNotBlank() }
                ?: "未配置 / Chưa cấu hình",
            userAgent = currentUserAgent(context),
            keepScreenOn = keepScreenOnStatus(activity),
            powerSaveMode = powerSaveModeStatus(context),
            batteryOptimization = batteryOptimizationStatus(context),
            notificationsAllowed = notificationsStatus(context, packageInfo),
            backgroundDataAllowed = backgroundDataStatus(context),
            screenResolution = screenResolution(activity),
            orientation = orientation(context),
            availableMemory = availableMemory(context),
            availableStorage = availableStorage(context),
            currentTime = formatTimestamp(System.currentTimeMillis()),
            lastWebLoadSuccess = preferences.getString(KEY_LAST_WEB_LOAD_SUCCESS, null)
                ?: "尚无记录 / Chưa có dữ liệu",
            lastWebLoadError = preferences.getString(KEY_LAST_WEB_LOAD_ERROR, null)
                ?: "尚无记录 / Chưa có dữ liệu",
            buildIdentifier = BuildConfig.BUILD_REVISION
                .takeIf { it.isNotBlank() && it != "unknown" }
                ?: "${packageInfo.versionName ?: "unknown"} (${packageInfo.longVersionCodeCompat()})",
            unknownSourcesStatus = unknownSourcesStatus(context, packageInfo),
        )
    }

    /** Records only the successful load time. Safe to call from WebViewClient.onPageFinished. */
    fun recordWebLoadSuccess(context: Context) {
        context.applicationContext
            .getSharedPreferences(DIAGNOSTICS_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_WEB_LOAD_SUCCESS, formatTimestamp(System.currentTimeMillis()))
            .apply()
    }

    /**
     * Records a bounded technical error message and time. Do not pass URLs containing query
     * parameters, authentication headers, tokens, page contents, or user-entered values.
     */
    fun recordWebLoadError(context: Context, error: String) {
        val safeError = error
            .replace(Regex("[\\r\\n\\t]+"), " ")
            .take(300)
            .ifBlank { "未知错误 / Lỗi không xác định" }
        val value = "${formatTimestamp(System.currentTimeMillis())} — $safeError"
        context.applicationContext
            .getSharedPreferences(DIAGNOSTICS_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_WEB_LOAD_ERROR, value)
            .apply()
    }

    private fun packageInfo(context: Context): PackageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()),
            )
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(
                context.packageName,
                PackageManager.GET_PERMISSIONS,
            )
        }

    private fun PackageInfo.longVersionCodeCompat(): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            longVersionCode
        } else {
            @Suppress("DEPRECATION")
            versionCode.toLong()
        }

    private fun currentWebViewVersion(context: Context): String = runCatching {
        val webViewPackage = WebViewCompat.getCurrentWebViewPackage(context)
            ?: return@runCatching "无法读取 / Không thể đọc"
        "${webViewPackage.versionName} (${webViewPackage.packageName})"
    }.getOrElse {
        "无法读取 / Không thể đọc"
    }

    private fun currentUserAgent(context: Context): String = runCatching {
        val defaultUserAgent = WebSettings.getDefaultUserAgent(context)
        val terminalMarker = BuildConfig.TERMINAL_USER_AGENT.trim()
        if (terminalMarker.isBlank() || defaultUserAgent.contains(terminalMarker)) {
            defaultUserAgent
        } else {
            "$defaultUserAgent $terminalMarker"
        }
    }.getOrElse {
        "无法读取 / Không thể đọc"
    }

    private fun currentNetworkType(context: Context): String {
        val connectivityManager = context.getSystemService(ConnectivityManager::class.java)
            ?: return "未知 / Không xác định"
        val network = connectivityManager.activeNetwork
            ?: return "无活动网络 / Không có mạng hoạt động"
        val capabilities = connectivityManager.getNetworkCapabilities(network)
            ?: return "未知 / Không xác định"

        val transports = buildList {
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                add("以太网 / Ethernet")
            }
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                add("Wi-Fi")
            }
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                add("蜂窝网络 / Di động")
            }
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                add("VPN")
            }
            if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH)) {
                add("蓝牙网络 / Bluetooth")
            }
        }
        return transports.ifEmpty { listOf("其他 / Khác") }.joinToString(" + ")
    }

    private fun connectivityStatus(context: Context): String {
        val connectivityManager = context.getSystemService(ConnectivityManager::class.java)
            ?: return "无法判断 / Không thể xác định"
        val network = connectivityManager.activeNetwork
            ?: return "否 / Không"
        val capabilities = connectivityManager.getNetworkCapabilities(network)
            ?: return "否 / Không"
        val hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        val isValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        return when {
            hasInternet && isValidated -> "是 / Có"
            hasInternet -> "网络存在但未验证互联网 / Có mạng nhưng chưa xác thực Internet"
            else -> "否 / Không"
        }
    }

    private fun keepScreenOnStatus(activity: Activity): String {
        val enabled = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0
        return enabled.asBilingualYesNo()
    }

    private fun powerSaveModeStatus(context: Context): String {
        val powerManager = context.getSystemService(PowerManager::class.java)
        return powerManager?.isPowerSaveMode?.asBilingualYesNo()
            ?: "无法判断 / Không thể xác định"
    }

    private fun batteryOptimizationStatus(context: Context): String {
        val powerManager = context.getSystemService(PowerManager::class.java)
            ?: return "无法判断 / Không thể xác định"
        val exempt = powerManager.isIgnoringBatteryOptimizations(context.packageName)
        return if (exempt) {
            "不受系统优化限制 / Không bị giới hạn"
        } else {
            "受系统电池优化 / Bị tối ưu hóa pin"
        }
    }

    private fun notificationsStatus(context: Context, packageInfo: PackageInfo): String {
        val requestedPermissions = packageInfo.requestedPermissions.orEmpty()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            Manifest.permission.POST_NOTIFICATIONS !in requestedPermissions
        ) {
            return "本阶段未申请 / Chưa yêu cầu trong giai đoạn này"
        }

        val manager = context.getSystemService(NotificationManager::class.java)
            ?: return "无法判断 / Không thể xác định"
        val runtimeGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return (runtimeGranted && manager.areNotificationsEnabled()).asBilingualYesNo()
    }

    private fun backgroundDataStatus(context: Context): String {
        val connectivityManager = context.getSystemService(ConnectivityManager::class.java)
            ?: return "无法判断 / Không thể xác định"
        return when (connectivityManager.restrictBackgroundStatus) {
            ConnectivityManager.RESTRICT_BACKGROUND_STATUS_DISABLED ->
                "允许 / Được phép"

            ConnectivityManager.RESTRICT_BACKGROUND_STATUS_WHITELISTED ->
                "允许（已豁免）/ Được phép (ngoại lệ)"

            ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED ->
                "受系统限制 / Bị hệ thống hạn chế"

            else -> "无法判断 / Không thể xác định"
        }
    }

    private fun screenResolution(activity: Activity): String {
        val (width, height) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = activity.windowManager.currentWindowMetrics.bounds
            bounds.width() to bounds.height()
        } else {
            @Suppress("DEPRECATION")
            activity.resources.displayMetrics.run { widthPixels to heightPixels }
        }
        return "$width × $height px"
    }

    private fun orientation(context: Context): String =
        when (context.resources.configuration.orientation) {
            Configuration.ORIENTATION_LANDSCAPE -> "横屏 / Ngang"
            Configuration.ORIENTATION_PORTRAIT -> "竖屏 / Dọc"
            else -> "未知 / Không xác định"
        }

    private fun availableMemory(context: Context): String {
        val activityManager = context.getSystemService(ActivityManager::class.java)
            ?: return "无法读取 / Không thể đọc"
        val memoryInfo = ActivityManager.MemoryInfo()
        activityManager.getMemoryInfo(memoryInfo)
        return formatBytes(memoryInfo.availMem)
    }

    private fun availableStorage(context: Context): String = runCatching {
        val statFs = StatFs(context.filesDir.absolutePath)
        formatBytes(statFs.availableBytes)
    }.getOrElse {
        "无法读取 / Không thể đọc"
    }

    private fun unknownSourcesStatus(context: Context, packageInfo: PackageInfo): String {
        val permissionDeclared = packageInfo.requestedPermissions.orEmpty()
            .contains(Manifest.permission.REQUEST_INSTALL_PACKAGES)
        val canRequestInstalls = runCatching {
            context.packageManager.canRequestPackageInstalls()
        }.getOrNull()
        if (!permissionDeclared) {
            return "无法直接判断（本应用未申请安装包权限）/ Không thể xác định trực tiếp"
        }
        return canRequestInstalls?.asBilingualYesNo()
            ?: "无法直接判断 / Không thể xác định trực tiếp"
    }

    private fun formatBytes(bytes: Long): String {
        if (bytes < 1024L) return "$bytes B"
        val units = arrayOf("KB", "MB", "GB", "TB")
        var value = bytes.toDouble()
        var unitIndex = -1
        do {
            value /= 1024.0
            unitIndex++
        } while (value >= 1024.0 && unitIndex < units.lastIndex)
        return "${DecimalFormat("0.##").format(value)} ${units[unitIndex]}"
    }

    private fun formatTimestamp(timestamp: Long): String =
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.MEDIUM).format(Date(timestamp))

    private fun String?.orUnknown(): String = this?.takeIf { it.isNotBlank() }
        ?: "未知 / Không xác định"

    private fun Boolean.asBilingualYesNo(): String = if (this) "是 / Có" else "否 / Không"
}
