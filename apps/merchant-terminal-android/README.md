# 云桥 Life 商家终端 Android App

本项目是云桥 Life Web 收银台的 Android Release Candidate 外壳及本地 USB ESC/POS
连接器。订单、桌台和账单仍由同一套 Web 收银台与 API 提供；Android 不复制业务 UI，
只负责安全 WebView、独立终端认证、本地 USB 执行、恢复和诊断。

当前默认版本为 `1.0.0-rc1`（versionCode `4`）。真实 USB 打印机的纸宽、图像质量、
切纸和缺纸行为尚未完成门店实机验收，不能仅凭构建通过宣称打印链路已上线。

## 1. RC1 架构

```text
Web 收银台（HTTPS）
        │ 普通商家 Web 登录；没有 JavaScript Bridge
        ▼
Android WebView 外壳

打印任务中心 API（HTTPS）
        │ 一次性绑定码 → 独立 Terminal Token
        │ claim / lease / start / success / failure / heartbeat
        ▼
Foreground Service
        ├── Room 本地任务与 Attempt 台账
        ├── Android Keystore 加密 Token 与 ReceiptSnapshot
        ├── 结构化 ReceiptDocument V1 → Bitmap → ESC/POS raster
        └── 通用 UsbManager BULK OUT → 已人工绑定的 USB 打印机
```

主要技术：Kotlin、AndroidX、Material Components、XML/ViewBinding、WebView、DataStore、
Room、WorkManager、Android USB Host API、ZXing、Gradle Kotlin DSL。

## 2. 默认关闭与安全边界

到店前以下五道门全部默认关闭：任务中心执行、商家打印总开关、终端开关、打印机开关、
本机连接器开关；自动打印还需要服务器端和本机自动开关同时开启。保存 USB 配置、完成绑定
或安装 APK 都不会自动开启打印。

- 顶层页面只允许 `TRUSTED_PAGE_ORIGIN` 的精确 HTTPS Origin。
- 资源 Host 只用于 HTTPS API/图片/静态资源，不能成为 WebView 顶层页面；不支持 `*`。
- SSL 错误直接取消，绝不绕过证书；无 JavaScript Bridge，无网页原始 ESC/POS 输入。
- 终端使用一次性绑定码换取独立 Token，不复用商家网页登录 Token。
- Token 与本地不可变小票快照分别使用 Android Keystore AES-GCM 加密。
- 领取后先按服务器相同规则重算结构化快照 SHA-256；不一致时不落库、不渲染、不打印。
- 不写死收银机、打印机型号、VID、PID、接口或端点，也不包含 LAN/TCP 9100。
- 只自动优先标准 USB Printer Class 7；HID、U 盘/存储和 Hub 接口不可作为打印通道，
  vendor-specific BULK OUT 必须由操作者核对标签并二次确认。
- 只执行已保存的精确设备及 BULK OUT 端点；无 USB 权限或设备离线时不领取任务。
- 诊断与正式连接器共享进程级 USB 所有权；正式服务运行时禁用诊断写入，避免数据交错。
- 默认不切纸，从不发送开钱箱命令；部分写入或结果不确定时绝不自动重打。

## 3. 终端绑定与 API

管理员在“打印中心 Beta”创建一次性绑定信息，Android 仅接受：

```text
ytpair:v1:<UUID>:<8位数字码>
```

绑定成功后 Token 只保存在本机加密存储。远程 `DISABLED` 是可恢复状态：终端保留凭据，
继续允许 config/heartbeat，但不领取或回报任务；撤销、过期或轮换凭据返回 401 后，本机会
删除终端凭据、Room 打印数据、USB 绑定和 ReceiptSnapshot 密钥。WebView 登录状态不在此
清理边界内。

连接器使用构建时配置的 `CONNECTOR_API_BASE_URL`，调用受控终端接口完成：绑定、配置、
心跳、任务领取、开始打印、租约延长、成功/失败回报及打印机连接状态上报。数据库中的
PrintJob 是事实来源；网页不能把任务直接标记成功。

## 4. 本地可靠性

- Room 保存 `LocalPrintJob`、`LocalPrintAttempt`、USB 绑定摘要和终端状态。
- Job/Attempt 的开始与结束转换在同一 Room 事务中完成。
- `serverJobId + contentHash` 用于本地防重复；已成功或不确定任务不会再次物理打印。
- USB I/O 前执行最终租约延长；所有成功/失败回报携带最新 leaseVersion。
- 进程在 USB I/O 中断会标记 `UNCERTAIN`，必须人工处理。
- Bitmap 按行转换并拆成最多 256 行的 ESC/POS raster 条带，只在整张末尾 feed/可选切纸；
  生产宽度限制为不超过 576 dots，高度超过 8000 dots 直接失败而不截断。
- 成功写入但回报丢失时，WorkManager 只补报结果，绝不在后台执行 USB 打印。
- 服务器拒绝过期/冲突回报时转为本地人工处理状态，不无限重试或再次出纸。
- 已回报的 SUCCEEDED/FAILED 本地历史保留最多 500 条且最多 14 天；不确定任务不自动清理。
- Foreground Service 使用严格门控的 sticky 恢复；BootReceiver、包升级与受控 USB attach
  可尝试恢复。Android 12+ 不允许 WorkManager 静默启动 FGS 时，会显示需用户打开 APP 的
  通知，不把启动失败误报成 USB 正常。

USB manifest attach filter 只匹配标准 Printer Class 7，不使用“所有 USB 设备”通配符。
厂商自定义 BULK OUT 打印机仍可在 APP 内选择，服务运行时由动态 receiver 监听；若进程已
停止且 USB 权限未保留，需要用户打开 APP 重新授权。这是避免 APP 抢占键盘、U 盘等其他
外设的安全取舍。

## 5. 包名、版本与权限

| 项目 | 值 |
|---|---|
| release applicationId | `com.yunqiao.life.merchantterminal` |
| debug applicationId | `com.yunqiao.life.merchantterminal.debug` |
| 默认 versionName | `1.0.0-rc1`（debug 追加 `-debug`） |
| 默认 versionCode | `4` |
| minSdk | 26 |
| targetSdk / compileSdk | 35 |

Manifest 只声明 RC 所需权限：`INTERNET`、`ACCESS_NETWORK_STATE`、`CHANGE_NETWORK_STATE`、
`POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`FOREGROUND_SERVICE`、
`FOREGROUND_SERVICE_CONNECTED_DEVICE`，以及 `android.hardware.usb.host`（非强制特性）。
WorkManager 依赖会合并 `WAKE_LOCK`。不申请存储、相机、定位、蓝牙、无障碍、悬浮窗或
安装应用权限。

`CHANGE_NETWORK_STATE` 是 Android 14+ 对 `connectedDevice` 类型前台服务允许的常规
前置权限，用来覆盖系统 sticky 重启与 USB 权限瞬时丢失的竞态。APP 不调用任何
修改 Wi-Fi、移动网络或网络路由的 API；正常启动仍必须通过 USB 绑定和用户授权门控。

## 6. 构建环境

| 工具 | 要求 |
|---|---|
| JDK | 17 |
| Gradle Wrapper | 8.9 |
| Android Gradle Plugin | 8.7.3 |
| Kotlin | 2.0.21 |
| Android SDK / Build Tools | 35 / 35.0.0 |

```bash
cd apps/merchant-terminal-android
./gradlew --version
```

SDK 路径可写入不提交的 `local.properties`：

```properties
sdk.dir=/path/to/Android/sdk
```

## 7. 构建配置

所有地址集中进入 BuildConfig；`.invalid` 是安全占位，不能用于门店上线。

| 用途 | debug 环境变量 | release 环境变量 |
|---|---|---|
| Web 收银台 URL | `CASHIER_WEB_URL_DEBUG` | `CASHIER_WEB_URL_RELEASE` |
| 顶层精确 Origin | `TRUSTED_PAGE_ORIGIN_DEBUG` | `TRUSTED_PAGE_ORIGIN_RELEASE` |
| 资源 Host（逗号分隔） | `TRUSTED_RESOURCE_HOSTS_DEBUG` | `TRUSTED_RESOURCE_HOSTS_RELEASE` |
| 连接器 API Base URL | `CONNECTOR_API_BASE_URL_DEBUG` | `CONNECTOR_API_BASE_URL_RELEASE` |

通用构建变量：

```text
BUILD_REVISION
TERMINAL_VERSION_NAME
TERMINAL_VERSION_CODE
```

也可使用同名 Gradle properties（小驼峰形式见 `app/build.gradle.kts`）。不得把账号、密码、
Token、Cookie、API Key、签名密码或带凭据 URL 写入仓库。

## 8. 测试与构建

```bash
cd apps/merchant-terminal-android
./gradlew --no-daemon :app:testDebugUnitTest
./gradlew --no-daemon :app:lint
./gradlew --no-daemon :app:assembleDebug
./gradlew --no-daemon :app:build
```

输出位于 `app/build/outputs/apk/`，文件名前缀为
`yunqiao-merchant-terminal-v<version>`。APK、`local.properties`、keystore 与构建缓存不得提交。

## 9. 正式 release 签名

正式可升级 release 必须固定使用同一个离线保管的 keystore。通过环境变量或用户级
`~/.gradle/gradle.properties` 注入全部四项：

```text
YUNQIAO_RELEASE_STORE_FILE
YUNQIAO_RELEASE_STORE_PASSWORD
YUNQIAO_RELEASE_KEY_ALIAS
YUNQIAO_RELEASE_KEY_PASSWORD
```

缺任一项会拒绝部分签名配置；完全不配置时可构建 unsigned release 用于静态验证，但不能
作为正式上线包。不得提交 keystore、密码或本机绝对路径。

## 10. 到店验证顺序

1. 校验 release APK 的 SHA-256 和签名证书后安装。
2. 打开 Web 收银台，验证登录、真实商家数据和横屏布局。
3. 保持服务器执行、商家打印、终端、打印机、本机连接器和自动打印全部关闭。
4. 在打印中心生成一次性绑定码，在 APP 中绑定并刷新远程状态。
5. 进入 USB 配置，选择实际设备、接口、BULK OUT 端点、纸宽和默认“不切纸”，人工授权。
6. 连接器关闭时各执行一次连接、ASCII 测试和中越英图片测试；人工确认只出一张。
7. 保存配置，再按上线文档逐级开启手动执行；用专用测试订单验证手动打印和补打。
8. 只有手动链路、内容、纸宽和防重复全部通过后，才单独开启自动打印并创建一笔测试订单。
9. 验证断网、重启、USB 拔插、缺纸和远程停用；任何结果不确定项都人工处理，不自动补打。

在用户明确确认真实出纸前，不得把 USB 打印、切纸或自动打印标记为 PASS。

## 11. 当前明确不包含

- LAN/TCP 9100、蓝牙、云打印、USB 厂商驱动或内置打印机 SDK。
- 浏览器直连 USB、网页 JavaScript Bridge 或网页传入任意打印字节。
- 现场点单、收款、Device Owner、kiosk、MDM、静默安装或自动更新。
- 对缺纸、开盖、切刀和“纸张确已输出”的通用可靠双向判断。

下一步仅是在门店按上线手册安装 RC、完成真实 USB 硬件验证并逐级开启开关；不得把未验证
的打印效果写成已通过。
