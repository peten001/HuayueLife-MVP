# 云桥 Life 商家终端 Android App

本项目是云桥 Life Web 收银台的 Android 外壳与本机 USB ESC/POS 连接器。订单、桌台、
TableSession、账号和权限全部复用现有 Web 收银台及 API；Android 不实现第二套业务 UI，
只负责受控 WebView、本机 USB 执行、恢复和诊断。

当前发布候选版本为 `1.0.0-rc3`（versionCode `7`）。真实打印机的纸宽、图像质量、
二维码、切纸及异常行为仍须门店实机验收；构建和静态检查通过不等于真实出纸通过。

## 1. RC3 架构

```text
Web 收银台（HTTPS）
        │ 现有商家主账号或员工账号登录
        ▼
Android WebView 外壳
        │ 同一商家 Web 会话（Bearer）
        ▼
现有 merchant printing connector API（HTTPS）
        │ config / claim / lease / start / success / failure
        ▼
Foreground Service
        ├── Room 本地任务与 Attempt 证据
        ├── Android Keystore 加密已记住的商家会话与 ReceiptSnapshot
        ├── 结构化 ReceiptDocument V1 → Bitmap → ESC/POS raster
        └── 通用 UsbManager BULK OUT → 操作者选择并授权的 USB 打印机
```

RC3 不使用独立设备账号或独立设备认证。连接器只使用 Web 收银台已建立的现有商家会话，
只调用现有 `/api/v1/merchant/printing/connector/*` 接口。当前 V1 同一商家现场只允许运行
一台 USB Connector，避免缺少设备级身份时多个连接器竞争同一任务。

主要技术：Kotlin、AndroidX、Material Components、XML/ViewBinding、WebView、DataStore、
Room、WorkManager、Android USB Host API、ZXing、Gradle Kotlin DSL。

## 2. 平台托管与安全边界

打印总能力以服务端 `Merchant.printingEnabled` 为唯一权威，打印机与自动打印规则由商家
OWNER/MANAGER 配置。Android 不提供收银员可写的本机连接器或自动打印总开关；保存过的
USB Binding 会在登录、App/设备重启和 USB 重插后按服务端配置自动恢复。平台未开通、
商家未配置或当前会话无效时，连接器不领取或执行任务。

- 顶层页面只允许正式 Web 收银台的精确 HTTPS Origin。
- 资源 Host 只允许明确配置的 HTTPS API/媒体资源，不能成为 WebView 顶层页面。
- SSL 错误直接取消，绝不绕过证书。
- 网页不能传入原始 ESC/POS 字节，也没有文件、Socket 或命令执行桥。
- 记住登录时，商家会话由 Android Keystore 加密保存；不记住登录时只在当前进程使用。
- Web 明确退出或会话失效后，立即停止连接器、取消恢复任务并清除原生会话；USB 配置和
  已有本地打印证据保留，避免丢失待回报状态或产生重复打印风险。
- USB 暂时离线、权限等待或设备未发现只改变连接状态，不关闭平台能力、打印机配置或
  自动打印规则；重新插入后按保存的 Binding 自动重连。
- 领取后按服务器相同规则重算结构化快照 SHA-256；不一致时不落库、不渲染、不打印。
- 不写死收银机、打印机型号、VID、PID、接口或端点，也不包含 LAN/TCP 执行通道。
- 只自动优先标准 USB Printer Class 7；HID、存储设备和 Hub 接口不能作为打印通道。
- 只执行已保存的精确设备及 BULK OUT 端点；无 USB 权限或设备离线时不领取任务。
- 诊断与正式连接器共享进程级 USB 所有权，避免并发写入导致数据交错。
- 默认不切纸，从不发送开钱箱命令；部分写入或结果不确定时绝不自动重打。

## 3. 统一商家会话

Web 收银台继续使用云桥现有商家主账号和员工账号登录。Android 仅在可信页面 Origin 下
读取同一 Web 会话，并以 `Authorization: Bearer ...` 调用 merchant connector API。

- `localStorage` 会话对应“记住登录”，可由 Keystore 加密后跨进程保留。
- `sessionStorage` 会话只保留在当前 APP 进程，进程结束后不恢复。
- 页面退出信号只表达“已退出”，不向网页暴露原生能力，也不传递会话内容。
- 周期同步作为兼容兜底；异步结果带顺序保护，旧回调不能覆盖较新的退出状态。
- 员工停用、401 或受控的 403 会停止任务领取与执行。
- 切换商家时不得复用另一商家的 USB 作用域或任务。

账号创建、首次改密、角色和权限仍完全由现有平台后台、商家后台和 API 负责。

## 4. 本地可靠性

- Room 保存 `LocalPrintJob`、`LocalPrintAttempt` 和本地执行证据。
- Job/Attempt 的开始与结束转换在同一 Room 事务中完成。
- `serverJobId + contentHash` 用于本地防重复；已成功或结果不确定的任务不会再次物理打印。
- USB I/O 前执行最终租约延长；成功/失败回报携带最新 leaseVersion。
- 进程在 USB I/O 中断会标记 `UNCERTAIN`，必须人工处理。
- Bitmap 按行转换并拆成 ESC/POS raster 条带，只在整张末尾 feed/可选切纸。
- 成功写入但回报丢失时，WorkManager 只补报结果，不在后台再次执行 USB 打印。
- 服务器拒绝过期或冲突回报时转为本地人工处理，不无限重试。
- 已回报历史按受控数量和期限清理；结果不确定的任务不会自动删除。
- Foreground Service、BootReceiver、受控 USB attach 和 WorkManager 均重新检查商家会话、
  平台能力、商家配置、USB 绑定和权限，任何条件不满足都不执行。

USB Manifest attach filter 只匹配标准 Printer Class 7，不使用“所有 USB 设备”通配符。
厂商自定义 BULK OUT 设备须在 APP 内人工选择并核对，APP 不抢占键盘或存储设备。
当前每个 APP 实例只维护一个有效 USB Binding；多终端、多物理打印机的稳定路由仍属于
后续多打印机阶段，不能把商家后台可保存多条 Printer 记录误解为 V1 已支持并发物理分单。

## 5. 包名、版本、地址与权限

| 项目 | RC3 值 |
|---|---|
| release applicationId | `com.yunqiao.life.merchantterminal` |
| debug applicationId | `com.yunqiao.life.merchantterminal.debug` |
| versionName | `1.0.0-rc3`（debug 追加 `-debug`） |
| versionCode | `7` |
| minSdk | 26 |
| targetSdk / compileSdk | 35 / 35 |
| Web 收银台 | `https://cashier.huayueyouxuan.com/` |
| Connector API Base | `https://api.huayueyouxuan.com/api/v1` |

Release 地址固定在单一 BuildConfig 配置入口；debug 可通过以下环境变量或同名 Gradle
property 指向受控测试环境：

```text
CASHIER_WEB_URL_DEBUG
TRUSTED_PAGE_ORIGIN_DEBUG
TRUSTED_RESOURCE_HOSTS_DEBUG
CONNECTOR_API_BASE_URL_DEBUG
BUILD_REVISION
```

不得在仓库中写入账号、密码、Token、Cookie、API Key、签名密码或带凭据 URL。

Manifest 声明 RC 所需权限：`INTERNET`、`ACCESS_NETWORK_STATE`、`CHANGE_NETWORK_STATE`、
`POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`FOREGROUND_SERVICE`、
`FOREGROUND_SERVICE_CONNECTED_DEVICE`，以及非强制 `android.hardware.usb.host` 特性。
WorkManager 依赖会合并 `WAKE_LOCK`。不申请存储、相机、定位、蓝牙、无障碍、悬浮窗或
安装应用权限。

`CHANGE_NETWORK_STATE` 仅满足 Android 14+ `connectedDevice` 前台服务的系统前置条件；
APP 不调用修改 Wi-Fi、移动网络或路由的 API。

## 6. 构建环境

| 工具 | 要求 |
|---|---|
| JDK | 17 |
| Gradle Wrapper | 8.9 |
| Android Gradle Plugin | 8.7.3 |
| Kotlin | 2.0.21 |
| Android SDK / Build Tools | 35 / 35.0.0 |

SDK 路径可写入不提交的 `local.properties`：

```properties
sdk.dir=/path/to/Android/sdk
```

## 7. 测试与构建

```bash
cd apps/merchant-terminal-android
./gradlew --no-daemon :app:testDebugUnitTest
./gradlew --no-daemon :app:testReleaseUnitTest
./gradlew --no-daemon :app:lint
./gradlew --no-daemon clean :app:assembleRelease
```

输出位于 `app/build/outputs/apk/release/`。APK、`local.properties`、keystore 和构建缓存
不得提交。

## 8. 正式 release 签名

正式可升级 release 必须使用既定离线 keystore，通过环境变量或用户级 Gradle 配置注入：

```text
YUNQIAO_RELEASE_STORE_FILE
YUNQIAO_RELEASE_STORE_PASSWORD
YUNQIAO_RELEASE_KEY_ALIAS
YUNQIAO_RELEASE_KEY_PASSWORD
```

缺任一项会拒绝部分配置；完全不配置时只能生成 unsigned release 用于静态验证，不能作为
正式包。不得提交 keystore、密码或本机绝对路径。正式包必须通过 `apksigner` 校验，并与
既定证书 SHA-256 完全一致。

## 9. 门店验证边界

本仓库 Gate 只完成源码、单元测试、lint、构建及二进制审计。本轮不安装收银机、不请求
USB 权限、不修改生产开关、不创建生产打印任务、不真实出纸，也不发布正式 APK。

`LOCAL_USB_ESCPOS` 已进入正式支持范围；既有测试打印和真实 USB 手动打印已有现场验证。
本轮修改了 Android 原生托管恢复逻辑，因此后续仍需生成独立测试 APK，在 P10/D10 与
SUNMI D2 补做 App/设备重启、USB 拔插、真实订单和自动打印回归后，才能发布替换现有 RC3。

后续门店验证必须按独立硬件 Gate 执行：先核对 APK SHA-256 与证书，再验证 Web 登录，
然后逐级检查 USB 识别、授权、测试小票、手动任务、防重复和异常恢复。用户明确确认前，
不得将真实 USB 打印、切纸或自动打印标记为通过。

## 10. 当前明确不包含

- LAN/TCP、蓝牙、云打印、USB 厂商驱动或内置打印机 SDK。
- 浏览器直连 USB、网页传入任意打印字节或任意原生命令。
- 第二套账号、订单、桌台、TableSession、角色、权限或业务 API。
- 现场点单、收款、Device Owner、kiosk、MDM、静默安装或自动更新。
- 对缺纸、开盖、切刀和“纸张确已输出”的通用可靠双向判断。
