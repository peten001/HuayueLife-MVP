# 云桥 Life 商家终端 Android App

## 1. 项目用途

本项目是云桥 Life 商家终端的 Android 外壳，面向 KiotViet D10 Pro（Android 13、1280 × 800 横屏）。阶段 1 在受控 Android WebView 中加载现有 `merchant-admin`，提供登录保持、横屏沉浸式体验、网络错误处理和原生诊断。

仓库此前没有可复用的 Android applicationId 规范，因此采用正式、稳定的包名 `com.yunqiao.life.merchantterminal`。debug 构建会追加 `.debug` applicationId 后缀，允许与 release 并存；release 包名后续不得随意变更，否则无法原位升级。

项目不会保存商家账号或密码。现有登录 Token 仍由 `merchant-admin` 按其原有逻辑保存在 WebView 的站点存储中。

## 2. 技术架构

阶段 1 使用经典 Android Views，保持终端项目结构简单：

```text
MainActivity
├── SwipeRefreshLayout（页面顶部下拉刷新）
├── TerminalWebView
│   ├── TerminalWebViewClient（导航白名单、加载错误、SSL 拒绝）
│   └── TerminalWebChromeClient（进度、文件选择、受控弹窗）
├── ErrorStateView（中越双语错误状态）
├── TerminalSettings（Jetpack DataStore）
└── DiagnosticsActivity / DeviceDiagnostics（只读诊断）
```

主要技术：Kotlin、AndroidX、Material Components、Android WebView、Jetpack DataStore、Gradle Kotlin DSL。阶段 1 没有 JavaScript Bridge，也没有原生打印、后台服务或数据库。

安全基线：

- 顶层页面导航、JS 弹窗和文件选择只信任 `MERCHANT_ADMIN_URL` 的精确 Origin（scheme、Host、port 全部一致）。
- `TRUSTED_RESOURCE_HOSTS` 仅是 HTTPS API/媒体/静态资源 allowlist，不会获得页面 Origin 权限。
- 普通外部 HTTPS 链接交给系统浏览器。
- 阻止 `file://`、`content://` 和未知 scheme。
- SSL 校验失败时调用 `cancel()`，绝不使用 `handler.proceed()`。
- User-Agent 在系统 WebView 默认值后追加 `YunQiaoMerchantTerminal/1.0`，不覆盖默认 UA。
- 网络安全配置禁用明文 HTTP。

阶段 1 不全局禁用 WebView 长按或文字选择，因为订单号、备注和输入框复制属于可能的业务操作；终端真机验收如确认某个非业务区域需要收紧，应只针对该区域处理，不能破坏表单输入和备注复制。

## 3. 开发环境要求

- macOS、Linux 或 Windows
- JDK 17
- Android SDK Platform 35
- Android SDK Build-Tools 35.0.0
- Android SDK Platform-Tools（包含 `adb`）
- Gradle 使用仓库内 Wrapper，不要求全局安装 Gradle
- Android Studio 可选；命令行构建不依赖 IDE

配置 `ANDROID_HOME` 或在未跟踪的 `local.properties` 中设置 SDK 路径，例如：

```properties
sdk.dir=<YOUR_ANDROID_SDK_ABSOLUTE_PATH>
```

`local.properties` 已被忽略，禁止提交本机绝对路径。

## 4. Android SDK 要求

| 配置 | 值 | 说明 |
|---|---:|---|
| `minSdk` | 26 | Android 8.0；覆盖 D10 Pro Android 13 |
| `targetSdk` | 35 | 采用当前 Android 权限与平台行为 |
| `compileSdk` | 35 | 构建所需 SDK Platform |
| D10 Pro 目标系统 | Android 13 / API 33 | 必须做真机验证 |

安装 SDK 组件后可检查：

```bash
sdkmanager --list_installed
adb version
```

## 5. JDK 版本

项目固定使用 Java/Kotlin JVM target 17。检查：

```bash
java -version
javac -version
```

两者应指向 JDK 17。若机器安装了多个 JDK，只在当前 shell 或 IDE 的 Gradle JDK 设置中选择 17，不要不可逆地修改系统 Java 配置。

## 6. Gradle 版本

| 组件 | 版本 |
|---|---:|
| Gradle Wrapper | 8.9 |
| Android Gradle Plugin | 8.7.3 |
| Kotlin Android Plugin | 2.0.21 |

所有命令均从本目录执行：

```bash
cd apps/merchant-terminal-android
./gradlew --version
```

不要使用全局 `gradle` 替代 `./gradlew`。

## 7. 配置 merchant-admin URL 与可信 Host

已通过现有部署记录、DNS、线上 Nginx 页面和有效 HTTPS 证书确认生产地址：

```text
https://admin.huayueyouxuan.com/
```

release 默认使用该公开生产地址；debug 仍默认使用不可解析的 `https://merchant-admin.invalid/`，避免普通开发构建误连生产。两种构建都可通过 Gradle property 或环境变量注入配置；URL 必须是 HTTPS，可信 Host 只写主机名，不写 scheme、路径或密码。

生产 API 为 `https://api.huayueyouxuan.com/api/v1`。上传图片、商品图片和日报图片也由 `api.huayueyouxuan.com` 提供；静态资源与 merchant-admin 同源，当前没有独立 CDN。因此 debug/release 的最小额外可信 Host 都是 `api.huayueyouxuan.com`。

| 构建类型 | URL Gradle property | Host Gradle property | 环境变量 |
|---|---|---|---|
| debug | `merchantAdminUrlDebug` | `merchantTrustedHostsDebug` | `MERCHANT_ADMIN_URL_DEBUG`、`MERCHANT_TRUSTED_HOSTS_DEBUG` |
| release | `merchantAdminUrlRelease` | `merchantTrustedHostsRelease` | `MERCHANT_ADMIN_URL_RELEASE`、`MERCHANT_TRUSTED_HOSTS_RELEASE` |

多个资源 Host 使用英文逗号分隔。起始 URL 的精确 Origin 会自动允许；此外必须列出 merchant-admin 实际请求的云桥 Life API、静态资源或媒体 Host。仅支持精确 Host，不支持通配符；额外资源 Host 仅允许 HTTPS 默认端口 443，起始 URL 使用其明确配置的 HTTPS 端口。漏列的子资源/API会由 WebView 返回本地 403。资源 allowlist 不会授权顶层页面导航、JS 弹窗、文件选择或未来的原生能力：

```bash
./gradlew :app:assembleDebug \
  -PmerchantAdminUrlDebug='https://merchant.example.invalid/' \
  -PmerchantTrustedHostsDebug='api.example.invalid,media.example.invalid'
```

或：

```bash
export MERCHANT_ADMIN_URL_DEBUG='https://merchant.example.invalid/'
export MERCHANT_TRUSTED_HOSTS_DEBUG='api.example.invalid,media.example.invalid'
./gradlew :app:assembleDebug
```

这些示例仍使用 `.invalid`，不是生产地址。不得把 Token、账号、密码或 API Key 放进 URL、Gradle 文件或 BuildConfig。

可传入可追踪的构建标识：

```bash
./gradlew :app:assembleDebug -PbuildRevision="$(git rev-parse --short HEAD)"
```

对应环境变量为 `BUILD_REVISION`。

测试包的 versionName/versionCode 也可以在构建时注入，默认仍为 `0.1.0`/`1`：

| 项目 | Gradle property | 环境变量 |
|---|---|---|
| versionName | `terminalVersionName` | `TERMINAL_VERSION_NAME` |
| versionCode | `terminalVersionCode` | `TERMINAL_VERSION_CODE` |

versionCode 必须为 `1..2100000000` 的整数；versionName 只允许字母、数字、点、下划线和连字符。Gradle property 的优先级高于环境变量；构建生产测试包前应确认用户级 `~/.gradle/gradle.properties` 没有旧值。

## 8. 构建 debug APK

D10 Pro 阶段 1 业务测试包示例：

```bash
cd apps/merchant-terminal-android
export TERMINAL_VERSION_NAME='0.1.1-d10-test'
export TERMINAL_VERSION_CODE='2'
export MERCHANT_ADMIN_URL_DEBUG='https://admin.huayueyouxuan.com/'
export MERCHANT_TRUSTED_HOSTS_DEBUG='api.huayueyouxuan.com'
export BUILD_REVISION="$(git rev-parse --short HEAD)"
./gradlew --no-daemon clean :app:assembleDebug
```

输出目录：

```text
app/build/outputs/apk/debug/
```

预期文件名：

```text
yunqiao-merchant-terminal-v0.1.1-d10-test-debug.apk
```

debug APK 使用 Android 默认 debug 签名，只用于开发和真机验证，不能替代正式升级证书。

## 9. 构建 release APK

正式构建前必须提供经过确认的 release URL、白名单和构建标识：

```bash
export MERCHANT_ADMIN_URL_RELEASE='https://admin.huayueyouxuan.com/'
export MERCHANT_TRUSTED_HOSTS_RELEASE='api.huayueyouxuan.com'
export BUILD_REVISION="$(git rev-parse --short HEAD)"
./gradlew clean :app:assembleRelease
```

输出目录：

```text
app/build/outputs/apk/release/
```

- 已配置正式签名：`yunqiao-merchant-terminal-v0.1.0-release.apk`
- 未配置签名：生成 unsigned release 产物，只能用于后续签名流程，不能作为可持续升级的正式包

release 启用 R8 压缩。发布前还应执行 lint 并验证签名：

```bash
./gradlew :app:lintRelease :app:assembleRelease
apksigner verify --verbose --print-certs app/build/outputs/apk/release/*.apk
```

## 10. 配置可持续升级的 release 签名

正式 keystore 是长期升级身份。遗失 keystore 或密码会导致无法覆盖升级已安装 APP。应由负责人离线生成、加密备份，并限制访问权限。

生成示例（命令会交互式询问密码，仓库不记录密码）：

```bash
mkdir -p "$HOME/.keys"
keytool -genkeypair -v \
  -keystore "$HOME/.keys/yunqiao-merchant-terminal-release.jks" \
  -alias yunqiao-merchant-terminal \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
chmod 600 "$HOME/.keys/yunqiao-merchant-terminal-release.jks"
```

推荐在 CI 密钥库或当前 shell 中提供以下环境变量：

```bash
export YUNQIAO_RELEASE_STORE_FILE="$HOME/.keys/yunqiao-merchant-terminal-release.jks"
export YUNQIAO_RELEASE_STORE_PASSWORD='从安全密钥库注入'
export YUNQIAO_RELEASE_KEY_ALIAS='yunqiao-merchant-terminal'
export YUNQIAO_RELEASE_KEY_PASSWORD='从安全密钥库注入'
```

也支持仅存于本机 `~/.gradle/gradle.properties` 的以下属性：

```properties
yunqiaoReleaseStoreFile=<PRIVATE_ABSOLUTE_PATH_TO_RELEASE_KEYSTORE>
yunqiaoReleaseStorePassword=从安全密钥库填写
yunqiaoReleaseKeyAlias=yunqiao-merchant-terminal
yunqiaoReleaseKeyPassword=从安全密钥库填写
```

不要把这些属性写入仓库内 `gradle.properties`，也不要提交 `.jks`、`.keystore` 或签名后的临时副本。提交前检查：

```bash
git status --short
git grep -nE 'STORE_PASSWORD|KEY_PASSWORD|BEGIN (RSA |EC )?PRIVATE KEY'
```

## 11. 通过浏览器下载 APK 安装

1. 将已校验 SHA-256 的 APK 放到公司受信任的 HTTPS 下载地址。
2. 在 D10 Pro 浏览器打开下载地址并下载 APK。
3. Android 13 首次会提示允许该浏览器“安装未知应用”；进入提示页，只为该浏览器开启。
4. 返回下载记录，点击 APK 并确认安装。
5. 安装完成后打开 APP，在诊断页核对版本、包名、构建标识和 merchant-admin URL。
6. 安装完可关闭该浏览器的未知来源授权，减少风险。

不要通过聊天群或未经校验的第三方文件站分发正式 APK。

## 12. 通过 U 盘安装

1. 将 APK 和对应 SHA-256 校验值复制到 FAT32/exFAT U 盘。
2. 将 U 盘接入 D10 Pro，使用系统文件管理器定位 APK。
3. 首次安装时只为该文件管理器开启“安装未知应用”。
4. 点击 APK 完成安装，启动后核对诊断信息。
5. 弹出 U 盘；如无后续需要，关闭文件管理器的未知来源授权。

不同 D10 Pro 固件可能限制 U 盘 APK 安装，需要在真机记录实际行为。

## 13. 通过 ADB 安装

先在 D10 Pro 开启开发者选项和 USB 调试，并在设备上确认电脑的调试授权：

```bash
adb devices -l
adb install -r app/build/outputs/apk/debug/yunqiao-merchant-terminal-v0.1.1-d10-test-debug.apk
```

release 覆盖安装使用实际 release 文件：

```bash
adb install -r app/build/outputs/apk/release/yunqiao-merchant-terminal-v0.1.0-release.apk
```

常用诊断：

```bash
adb shell pm list packages | grep yunqiao
adb shell dumpsys package com.yunqiao.life.merchantterminal.debug
adb logcat
```

只有 applicationId 和签名证书都一致，`-r` 才能保留数据并覆盖升级。debug 与 release applicationId 不同，不能互相覆盖。

## 14. Android 13 未知来源安装说明

Android 13 按“安装来源应用”分别授权，不存在一个供普通 APP可靠读取的全局开关。浏览器下载、文件管理器/U 盘和其他安装来源需要分别授权。

本阶段 APP不申请 `REQUEST_INSTALL_PACKAGES`，也不安装其他 APK。诊断页会调用官方能力进行适用性判断；由于本 APP不是安装来源，会显示“无法直接判断（本应用未申请安装包权限）”，不会伪造系统全局状态。

如果设备由 KiotViet 固件、企业策略或管理员禁止侧载，需联系设备管理员；不要通过 Root、无障碍或未知工具绕过限制。

## 15. D10 Pro 真机验证

完整逐项记录见 [docs/D10_PRO_STAGE1_TEST_CHECKLIST.md](docs/D10_PRO_STAGE1_TEST_CHECKLIST.md)。最低验收顺序：

1. 核对 APK SHA-256、签名证书、版本和构建标识。
2. 分别验证 ADB、浏览器或 U 盘中实际允许的安装路径。
3. 验证 1280 × 800 横屏、全屏、常亮、输入法和返回键。
4. 登录后退出/重启 APP，确认 WebView 登录状态保留；验证正常退出登录。
5. 遍历工作台、订单、订单详情、桌台和设置页面。
6. 在页面顶部下拉刷新；上传菜品图片时确认只打开系统文件选择器且无需存储权限。
7. 断开/恢复 Wi-Fi 与 Ethernet，验证原生错误页和重新加载。
8. 睡眠唤醒、Home、最近任务、切换 APP，确认不白屏、不无条件刷新。
9. 打开诊断页，复制信息并核对系统状态。

SSL、DNS、HTTP 错误和 WebView 渲染进程异常只应在受控 debug 环境测试，不能修改生产证书或生产 DNS。

## 16. 常见错误处理

### debug 启动后显示配置错误或无法访问 `.invalid`

构建时没有传入 merchant-admin URL。按第 7 节同时配置 URL 和 Host，然后重新构建。不要在 Kotlin 文件中直接改 URL。

### 保存桌台二维码时出现“不支持保存”提示

桌台二维码预览仍可正常显示，但阶段 1 没有实现 Android Blob 下载管理器。终端会明确提示使用系统浏览器完成，不会静默失败或把 Blob URL交给不可信应用。

### 链接被阻止或跳到系统浏览器

顶层页面必须与起始 URL 精确同源；BuildConfig 的 `TRUSTED_RESOURCE_HOSTS` 只允许 API/媒体/静态资源访问，不能让该 Host 成为 WebView 顶层页面。外部 Gradle property 和环境变量名称为兼容既有构建命令仍使用 `merchantTrustedHosts*` / `MERCHANT_TRUSTED_HOSTS_*`。不要用路径、端口或 `*.example.com` 代替资源主机名。漏列的 API/静态资源会返回本地 403；非同源 HTTPS 顶层链接按设计交给系统浏览器。

### 文件上传被拒绝

APP只接受系统文件选择器返回的、当前可读的 `content://` URI，并按网页 `accept` 的 MIME 类型或 `.jpg`、`.xlsx` 等可识别扩展名校验。单选最多 1 个，多选最多 10 个；`file://`、未知 scheme、不可读 provider 或类型不匹配的结果会被拒绝。无需且不得申请全盘存储权限。

### 显示 SSL 错误

检查设备时间、服务端证书链和域名是否匹配。APP不会绕过无效证书；不要加入 `handler.proceed()` 或允许明文 HTTP。

### 无网络但错误页没有恢复

先在诊断页确认网络是否已验证，再点击“重新加载”。如果 Wi-Fi 已连接但未验证互联网，检查 Captive Portal、DNS、路由器和服务器可达性。

### 登录状态未保留

确认不是卸载重装、清除 APP数据、退出登录或 Token 已过期。检查系统 WebView 版本，并确认构建没有更换 URL Host；WebView 存储按 Origin 隔离。

### 页面白屏或 WebView 崩溃

进入诊断页记录 WebView provider 版本和最近错误，更新系统 WebView后重试，并附 `adb logcat`。不要通过无限自动刷新掩盖渲染进程问题。

### 输入法遮挡表单

确认设备为横屏、系统没有强制浮动键盘，并记录具体页面、输入法名称和截图。Activity 使用 `adjustResize`；网页端仍需保留可滚动区域。

### release 无法覆盖升级

使用 `apksigner verify --print-certs` 比较新旧 APK 的证书 SHA-256。证书不同无法覆盖；不要卸载生产 APP来规避签名错误，否则会丢失本地登录状态。

## 17. 当前未实现功能

以下内容明确不属于阶段 1：

- LAN、USB、蓝牙或云打印
- ESC/POS、TCP 9100、测试打印、手动打印、自动打印
- Room、PrintHistory、打印失败重试或防重复打印
- Foreground Service、WorkManager、WebSocket 后台接单
- print job / terminal API 和任何数据库 migration
- 开机自启、BootReceiver、Device Owner、kiosk、MDM
- APK自动更新、静默安装或应用商店发布

现有网页“打印机设置”入口仍是原有 merchant-admin 行为，不代表 Android 原生打印已经实现。

## 18. 第二阶段计划

阶段 1 真机验收通过后，第二阶段仅计划：**D10 Pro 通过 LAN 连接 ZY305UL 进行测试打印**。

第二阶段开始前应确认：

- D10 Pro 的 Wi-Fi/Ethernet 与 ZY305UL 位于可互通局域网。
- 打印机使用固定或 DHCP 保留的私网 IPv4，默认端口 9100。
- ZY305UL 的准确 ESC/POS、点宽、切刀和状态指令能力已通过自检页/厂家资料确认。
- 中文和越南语 Bitmap 打印方案在真机上验证。

本项目当前不包含上述打印实现，阶段 1 完成后不会自动开始阶段 2。
