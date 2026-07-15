package com.yunqiao.life.merchantterminal.diagnostics

import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceDescriptor
import com.yunqiao.life.merchantterminal.web.OriginPolicy
import java.text.DateFormat
import java.util.Date

data class UsbTestRecord(
    val timestampEpochMs: Long,
    val result: String,
    val errorCode: String? = null,
    val plannedBytes: Int = 0,
    val writtenBytes: Int = 0,
)

data class UsbDiagnosticConfig(
    val paperWidth: PaperWidth,
    val printDots: Int?,
    val threshold: Int,
    val cutMode: CutMode,
)

object UsbDiagnosticReport {
    fun build(
        activity: Activity,
        usbHostSupported: Boolean,
        devices: List<UsbDeviceDescriptor>,
        selectedDeviceName: String?,
        selectedInterfaceIndex: Int?,
        selectedInterfaceId: Int?,
        selectedAlternateSetting: Int?,
        selectedEndpointAddress: Int?,
        config: UsbDiagnosticConfig,
        lastTest: UsbTestRecord?,
    ): String = buildString {
        val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.packageManager.getPackageInfo(
                activity.packageName,
                PackageManager.PackageInfoFlags.of(0),
            )
        } else {
            @Suppress("DEPRECATION")
            activity.packageManager.getPackageInfo(activity.packageName, 0)
        }
        appendLine("YunQiao USB printer diagnostic / 云桥 USB 打印诊断")
        appendLine("APP: ${packageInfo.versionName} (${packageInfo.longVersionCodeCompat()})")
        appendLine("Package: ${activity.packageName}")
        appendLine("Git Commit: ${BuildConfig.BUILD_REVISION}")
        appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("Android: ${Build.VERSION.RELEASE} / API ${Build.VERSION.SDK_INT}")
        appendLine("Screen: ${screenDimensions(activity)}")
        appendLine(
            "Cashier Web URL: " +
                OriginPolicy().sanitizedForDiagnostics(BuildConfig.CASHIER_WEB_URL).ifBlank { "not configured" },
        )
        appendLine("Current time: ${formatTimestamp(System.currentTimeMillis())}")
        appendLine("USB Host: ${if (usbHostSupported) "supported" else "not supported"}")
        appendLine("USB device count: ${devices.size}")
        appendLine("Selected device: ${selectedDeviceName ?: "none"}")
        appendLine("Selected interface index: ${selectedInterfaceIndex ?: "none"}")
        appendLine("Selected interface id: ${selectedInterfaceId ?: "none"}")
        appendLine("Selected alternate setting: ${selectedAlternateSetting ?: "none"}")
        appendLine(
            "Selected endpoint: ${selectedEndpointAddress?.let { "0x${it.toHex2()}" } ?: "none"}",
        )
        appendLine(
            "Print config: ${config.paperWidth.name}, ${config.printDots ?: "invalid"} dots, " +
                "threshold ${config.threshold}, cut ${config.cutMode.name}",
        )
        appendLine()

        devices.forEachIndexed { index, device ->
            appendLine("USB[$index]: ${device.displayName}")
            appendLine("  deviceName: ${device.deviceName.take(MAX_FIELD_LENGTH)}")
            appendLine("  manufacturer: ${device.manufacturerName ?: "unknown"}")
            appendLine("  product: ${device.productName ?: "unknown"}")
            appendLine("  VID: ${device.vendorId} / 0x${device.vendorId.toHex4()}")
            appendLine("  PID: ${device.productId} / 0x${device.productId.toHex4()}")
            appendLine(
                "  device class/subclass/protocol: ${device.deviceClass}/" +
                    "${device.deviceSubclass}/${device.deviceProtocol}",
            )
            appendLine("  interfaces: ${device.interfaces.size}")
            appendLine("  permission: ${device.hasPermission}")
            appendLine("  possible printer: ${device.likelyPrinter}")
            device.interfaces.forEach { usbInterface ->
                appendLine(
                    "    interface index ${usbInterface.index}, id ${usbInterface.id}, " +
                        "alt ${usbInterface.alternateSetting}: class/subclass/protocol " +
                        "${usbInterface.interfaceClass}/${usbInterface.interfaceSubclass}/" +
                        "${usbInterface.interfaceProtocol}, endpoints ${usbInterface.endpoints.size}",
                )
                usbInterface.endpoints.forEach { endpoint ->
                    appendLine(
                        "      endpoint ${endpoint.endpointNumber}: " +
                            "address 0x${endpoint.address.toHex2()}, ${endpoint.direction}, " +
                            "${endpoint.type}, maxPacket ${endpoint.maxPacketSize}, " +
                            "interval ${endpoint.interval}",
                    )
                }
            }
        }

        appendLine()
        if (lastTest == null) {
            append("Last test: none")
        } else {
            appendLine("Last test time: ${formatTimestamp(lastTest.timestampEpochMs)}")
            appendLine("Last result: ${lastTest.result.take(MAX_FIELD_LENGTH)}")
            appendLine("Last error code: ${lastTest.errorCode ?: "none"}")
            append(
                "Bytes planned/written: ${lastTest.plannedBytes}/${lastTest.writtenBytes}",
            )
        }
    }

    private fun android.content.pm.PackageInfo.longVersionCodeCompat(): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) longVersionCode else {
            @Suppress("DEPRECATION")
            versionCode.toLong()
        }

    private fun formatTimestamp(timestamp: Long): String =
        DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.MEDIUM).format(Date(timestamp))

    private fun screenDimensions(activity: Activity): String {
        val (width, height) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.windowManager.currentWindowMetrics.bounds.let { bounds ->
                bounds.width() to bounds.height()
            }
        } else {
            @Suppress("DEPRECATION")
            activity.resources.displayMetrics.let { metrics ->
                metrics.widthPixels to metrics.heightPixels
            }
        }
        return "$width × $height px"
    }

    private fun Int.toHex2(): String = toString(16).uppercase().padStart(2, '0')
    private fun Int.toHex4(): String = toString(16).uppercase().padStart(4, '0')

    private const val MAX_FIELD_LENGTH = 240
}
