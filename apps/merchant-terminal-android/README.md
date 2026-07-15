# 云桥 Life 商家终端 Android App

本项目是云桥 Life 的 Android 商家终端外壳。业务界面统一由独立 Web 收银台提供；Android 原生层负责受控 WebView、设备诊断，以及本地 USB ESC/POS 硬件诊断和测试小票。

当前版本为门店验证前的 `0.2.0-usb-smoke`。它不会领取 `PrintJob`，不会打印真实订单，也不会在后台或开机后自动运行。

## 1. 当前职责

APP 包含三个原生入口：

- 收银台：在安全 WebView 中打开构建时指定的 Web 收银台。
- 设备诊断：显示 APP、Android、WebView、网络和构建信息。
- USB 打印诊断：枚举 USB 设备、申请设备权限、查看接口和端点，并由用户手动发送本地测试小票。

Web 收银台 URL 尚未正式确认或部署，因此 debug/release 默认都使用 `.invalid` 安全占位。即使收银台不可访问，右上角“终端”菜单仍可进入两类原生诊断。

本项目不保存商家账号和密码。Web 登录状态仍由 WebView 的 Cookie、`localStorage` 和 `sessionStorage` 按网页现有逻辑管理。

## 2. 技术架构

```text
Android App
├── MainActivity
│   ├── TerminalWebView
│   ├── 精确 Origin / 资源 Host 白名单
│   ├── 原生网络错误页
│   └── 终端入口菜单
├── DiagnosticsActivity
└── UsbPrinterDiagnosticsActivity
    ├── UsbDeviceInspector
    ├── UsbPermissionController
    ├── UsbEscPosAdapter : PrinterAdapter
    ├── ASCII smoke receipt
    └── Bitmap → ESC/POS raster smoke receipt
```

主要技术：Kotlin、AndroidX、Material Components、XML/ViewBinding、Android WebView、Jetpack DataStore、Android USB Host API、ZXing、Gradle Kotlin DSL。

### WebView 安全边界

- 顶层页面仅允许 `TRUSTED_PAGE_ORIGIN` 的精确 HTTPS Origin。
- `TRUSTED_RESOURCE_HOSTS` 仅允许 HTTPS API、图片和静态资源，不能成为顶层可信页面。
- 不支持 `*` 或子域名通配符。
- 非白名单 HTTPS 顶层链接交给系统浏览器；`file://`、未知协议和非法 URL 被阻止。
- SSL 错误只执行 `handler.cancel()`，绝不放行无效证书。
- 当前没有 JavaScript Bridge。
- 文件上传只接受系统文件选择器返回且可读的 `content://` URI，不申请存储权限。

### USB 安全边界

- 使用 Android 官方 `UsbManager`、`UsbDevice`、`UsbInterface`、`UsbEndpoint` 和 `UsbDeviceConnection`。
- 不写死收银机型号、打印机型号、VID、PID、USB 接口或端点。
- 候选设备依据 Printer Class 或 `BULK OUT` 判断，也允许用户手动选择其他设备。
- USB 权限必须由用户针对当前设备手动授权；拔插后不承诺永久授权。
- “测试连接”仅打开并 claim 接口，不发送打印或切纸数据。
- 每次手动点击最多发送一张测试小票，不自动循环、不后台重试。
- 部分写入后立即停止，不重发整张，以降低重复出纸风险。
- 默认不切纸；只有用户手动选择半切或全切才发送切纸命令。
- 从不发送开钱箱命令。

## 3. 包名与版本

| 项目 | 值 |
|---|---|
| release applicationId | `com.yunqiao.life.merchantterminal` |
| debug applicationId | `com.yunqiao.life.merchantterminal.debug` |
| 默认 versionName | `0.2.0-usb-smoke`；debug 实际追加 `-debug` |
| 默认 versionCode | `3` |
| minSdk | 26（Android 8.0） |
| targetSdk / compileSdk | 35 |

代码只读取 `Build.MANUFACTURER` 和 `Build.MODEL` 显示实际设备，不内置任何门店硬件名称。

## 4. 权限

Manifest 仅声明：

```text
android.permission.INTERNET
android.permission.ACCESS_NETWORK_STATE
android.hardware.usb.host（required=false）
```

USB Host API 的设备授权由系统弹窗处理，不是普通运行时权限。本版本不申请存储、相机、定位、蓝牙、通知、安装应用、悬浮窗、无障碍或后台权限。

## 5. 开发环境

| 工具 | 要求 |
|---|---|
| JDK | 17 |
| Gradle Wrapper | 8.9 |
| Android Gradle Plugin | 8.7.3 |
| Kotlin | 2.0.21 |
| Android SDK Platform | 35 |
| Android Build Tools | 35.0.0 |

不需要安装系统级 Gradle。使用仓库内 `./gradlew`：

```bash
cd apps/merchant-terminal-android
./gradlew --version
```

如果 SDK 不在默认位置，可仅在本机创建、不提交 `local.properties`：

```properties
sdk.dir=/Users/your-name/Library/Android/sdk
```

## 6. 配置 Web 收银台

配置由每个 build type 的 BuildConfig 集中管理：

| BuildConfig 字段 | 用途 |
|---|---|
| `CASHIER_WEB_URL` | 初始 Web 收银台完整 HTTPS URL，可包含路径 |
| `TRUSTED_PAGE_ORIGIN` | 唯一允许在 WebView 顶层加载的精确 Origin |
| `TRUSTED_RESOURCE_HOSTS` | 额外 HTTPS API/图片/静态资源 Host，英文逗号分隔 |

构建入口：

| 类型 | Gradle property | 环境变量 |
|---|---|---|
| debug URL | `cashierWebUrlDebug` | `CASHIER_WEB_URL_DEBUG` |
| debug Origin | `trustedPageOriginDebug` | `TRUSTED_PAGE_ORIGIN_DEBUG` |
| debug resources | `trustedResourceHostsDebug` | `TRUSTED_RESOURCE_HOSTS_DEBUG` |
| release URL | `cashierWebUrlRelease` | `CASHIER_WEB_URL_RELEASE` |
| release Origin | `trustedPageOriginRelease` | `TRUSTED_PAGE_ORIGIN_RELEASE` |
| release resources | `trustedResourceHostsRelease` | `TRUSTED_RESOURCE_HOSTS_RELEASE` |

示例仅用于受控测试环境：

```bash
export CASHIER_WEB_URL_DEBUG='https://cashier.example.invalid/'
export TRUSTED_PAGE_ORIGIN_DEBUG='https://cashier.example.invalid'
export TRUSTED_RESOURCE_HOSTS_DEBUG='api.example.invalid,media.example.invalid'
```

URL 与 Origin 必须是 HTTPS 且 Origin 完全一致；`TRUSTED_PAGE_ORIGIN` 不能带业务路径、query 或 fragment。不要将账号、密码、Token、Cookie、API Key 放进 URL、Gradle 文件或 BuildConfig。

目前没有确认的正式 Web 收银台 URL。不得用完整 merchant-admin 地址冒充收银台，也不得猜测生产域名。

## 7. USB 打印诊断

页面显示：

- Android 实际厂商、型号、版本及 USB Host 能力。
- 所有已连接 USB 设备的名称、厂商/产品名（可读取时）、VID/PID 十进制和十六进制、设备类及授权状态。
- 每个 interface 的 index、id、alternate setting、class/subclass/protocol。
- 每个 endpoint 的方向、类型、地址、maxPacketSize 和 interval。
- 自动候选结果和可手动选择的精确 interface index/id/alternate setting 与 `BULK OUT` endpoint。
- 58mm（384点）、80mm（576点）和 200–1024 自定义点宽。
- 0–255 黑白图像阈值。
- 不切纸、半切和全切；默认不切纸。
- 最近测试结果、错误码及计划/实际写入字节数。

### 测试小票

ASCII 测试优先验证最基础兼容性，只包含设备技术信息、数字和无重音英文/越南语。

中越英图片测试会用系统字体把整张小票和二维码渲染为 Bitmap，再编码为 ESC/POS raster 数据，以避免假设打印机支持 UTF-8、中文字符集或越南语重音字符。

两种测试都不包含真实订单、顾客或商家账号信息。

### 错误码

```text
USB_HOST_NOT_SUPPORTED
USB_DEVICE_NOT_FOUND
USB_PERMISSION_REQUIRED
USB_PERMISSION_DENIED
USB_INTERFACE_NOT_FOUND
USB_BULK_OUT_NOT_FOUND
USB_OPEN_FAILED
USB_CLAIM_INTERFACE_FAILED
USB_DEVICE_DETACHED
USB_WRITE_TIMEOUT
USB_PARTIAL_WRITE
USB_WRITE_FAILED
BITMAP_RENDER_FAILED
INVALID_PRINT_WIDTH
UNKNOWN_USB_ERROR
```

Android 的 `bulkTransfer` 无法证明纸张已经输出，也通常无法直接读取缺纸、开盖或切刀状态。即使字节写入完成，最终仍需人工确认是否出纸、内容是否清晰以及是否只打印一张。

## 8. 测试与构建 debug APK

```bash
cd apps/merchant-terminal-android

./gradlew --no-daemon :app:testDebugUnitTest
./gradlew --no-daemon :app:lint
./gradlew --no-daemon :app:assembleDebug
./gradlew --no-daemon :app:build
```

嵌入最终构建标识：

```bash
export BUILD_REVISION="$(git rev-parse HEAD)"
export TERMINAL_VERSION_NAME='0.2.0-usb-smoke'
export TERMINAL_VERSION_CODE='3'
./gradlew --no-daemon :app:clean :app:assembleDebug
```

默认输出：

```text
app/build/outputs/apk/debug/
yunqiao-merchant-terminal-v0.2.0-usb-smoke-debug.apk
```

APK 和构建缓存均被 `.gitignore` 排除，不得提交。

## 9. release 与签名

本轮门店验证只使用 Android 默认 debug 签名，不创建正式 keystore。

未来 release 签名必须由负责人离线生成并备份，通过以下四个环境变量或用户级 `~/.gradle/gradle.properties` 注入：

```text
YUNQIAO_RELEASE_STORE_FILE
YUNQIAO_RELEASE_STORE_PASSWORD
YUNQIAO_RELEASE_KEY_ALIAS
YUNQIAO_RELEASE_KEY_PASSWORD
```

任何 keystore、密码或本机绝对路径都不得进入仓库。正式升级必须保持相同 applicationId 和签名证书。

## 10. 安装方式

### U 盘

1. 将已校验 SHA-256 的 debug APK 复制到 U 盘。
2. 在 Android 收银终端文件管理器中打开 APK。
3. 首次按系统提示，仅允许该文件管理器“安装未知应用”。
4. 安装后打开 APP，通过右上角“终端”进入 USB 打印诊断。

### 浏览器 HTTPS 下载

1. 将 APK 放到可信 HTTPS 下载地址。
2. 终端浏览器下载 APK。
3. 仅为当前浏览器开启“安装未知应用”，返回并完成安装。
4. 安装后可关闭该授权。

### ADB

```bash
adb devices -l
adb install -r /absolute/path/yunqiao-merchant-terminal-v0.2.0-usb-smoke-debug.apk
```

如果旧 debug 包由不同证书签名，需要先卸载：

```bash
adb uninstall com.yunqiao.life.merchantterminal.debug
```

卸载会清除 WebView 登录状态和本地 APP 数据。ADB 连接可能占用终端 USB 端口；安装完成后应断开调试线，再连接门店打印机。

## 11. 门店验证

完整记录模板见：

```text
docs/testing/P10_USB_PRINTER_STORE_VALIDATION.md
```

文件名沿用用户对设备的称呼，实际型号必须以 APP 读取的 `Build.MANUFACTURER` / `Build.MODEL` 为准。

门店最小顺序：

1. 安装 debug APK并进入 USB 打印诊断。
2. 连接现有 USB 打印机并刷新设备。
3. 记录真实 VID、PID、interface index/id/alternate setting 和 endpoint。
4. 手动请求 USB 权限。
5. 执行一次“测试连接”，确认页面只报告接口打开。
6. 默认“不切纸”，手动打印一次 ASCII 测试。
7. 手动打印一次中越英图片测试，检查中文、越南语、二维码和纸宽。
8. 每次都人工确认是否只出一张纸并拍照记录。

在用户明确确认出纸前，不得把 USB 打印标记为通过。

## 12. 当前未实现

- 门店真实 USB 设备、VID/PID、interface、endpoint、纸宽和切刀验证
- PrintJob 领取、终端注册或配对 Token
- 真实订单打印、人工补打或自动打印
- Foreground Service、WorkManager、开机启动或后台恢复
- LAN/TCP 9100、蓝牙、云打印或厂商内置打印机 SDK
- 缺纸、开盖、切刀等可靠双向状态读取
- Device Owner、kiosk、MDM、自动更新或静默安装

下一步只是在门店安装本测试 APK，完成 USB 识别、授权、ASCII 和中越英图片测试。不得自动进入真实订单或自动打印开发。
