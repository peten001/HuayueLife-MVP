# YunQiao Android 收银与打印架构审计

审计日期：2026-08-17

当前实现基线：`apps/merchant-terminal-v2-android`，版本 `2.0.0-rc12.2`（versionCode 63）
兼容性参考：`apps/merchant-terminal-android`（旧 RC7 系列）

## 0. 审计结论

当前 Android 客户端不是“Web 调用 `Android.print(json)` 后由 Native 临时获取模板”的结构。

真实结构是：

```text
Web Cashier 登录
  -> Android 从受信页面 localStorage/sessionStorage 读取 Merchant JWT
  -> 用 Merchant JWT bootstrap Terminal Bearer
  -> Native 前台服务轮询服务器 PrintJob
  -> PrintJob 已包含后台按模板生成的不可变 receiptSnapshot
  -> 校验 contentHash、路由、租约、Attempt 和本地幂等账本
  -> Native 将 legacy ReceiptDocument V1 或 PrintDocument V2/V3 渲染成 Bitmap
  -> Bitmap 转 ESC/POS raster bytes
  -> USB bulkTransfer 或 LAN TCP socket 写入
  -> 向后台回报 SUCCEEDED / FAILED / UNCERTAIN
```

因此 Windows 必须复用的是：

1. Web Cashier URL、同源和 session 规则；
2. `YunQiaoMerchantSession` / `YunQiaoMerchantTerminal` Bridge 消息；
3. Terminal bootstrap、config、PrintJob claim/lease/Attempt/result 协议；
4. legacy ReceiptDocument V1、PrintDocument V2/V3 快照协议和 canonical SHA-256；
5. Bitmap -> ESC/POS raster 的编码方式；
6. 本地绑定、单端点互斥、幂等账本和不确定结果策略。

Windows 不应新增另一套 receipt JSON、模板 API 或 Web `print()` Bridge。

## 1. 审计范围与当前 APK

源码优先级：

1. `apps/merchant-terminal-v2-android`：当前 V2 客户端；
2. `apps/api/src/modules/printing`：模板、任务、租约、Attempt 和 Terminal API；
3. `apps/merchant-cashier`：Web session、语言和打印机入口；
4. `apps/merchant-terminal-android`：旧版行为与迁移原因；
5. RC12.2 APK：用于验证源码产物身份，不代替源码审计。

APK 验证结果：

| 项目 | 结果 |
| --- | --- |
| 文件 | `apps/merchant-terminal-v2-android/app/build/outputs/apk/release/yunqiao-merchant-terminal-v2.0.0-rc12.2-release.apk` |
| SHA-256 | `378f88ae0322ba3510eafd26c1578d30f01d39414a869e65d8c0eba44ff8dad1` |
| package | `com.yunqiao.life.merchantterminal` |
| version | `2.0.0-rc12.2` / 63 |
| min / target SDK | 26 / 35 |
| 签名 | APK Signature Scheme v2，有 1 个 YunQiao 正式签名者 |
| 核心权限 | Internet、network state、USB host、foreground connected-device service、Bluetooth |

源码与 APK 的 package、版本、权限和应用名一致，所以不需要反编译 APK 补足缺失源码。

## 2. Android 收银启动流程

入口为 `MainActivity`，Application 为 `TerminalApplication`。

```text
TerminalApplication.onCreate
  -> 创建 TerminalGraph
     - MerchantSessionTokenStore
     - V2CredentialStore
     - TerminalIdentityStore
     - TerminalV2ApiClient
     - Room V2PrintingDatabase
     - PrintingRepository
  -> 若已有可用 Terminal credential，调度恢复任务

MainActivity.onCreate
  -> 全屏、隐藏系统栏
  -> 创建 PrinterDevicesController
  -> 创建 MerchantSessionCoordinator
  -> 注册 USB permission/attach/detach 协调器
  -> 创建同一个长期存活的 TerminalWebView
  -> 安装 TrustedWebMessageBridge
  -> 创建 Compose 打印机管理 overlay
  -> 加载 CASHIER_WEB_URL
```

Native 打印机页覆盖在同一个 WebView 上；关闭后返回同一 Web session，而不是重建收银页面。

## 3. WebView URL、同源与资源策略

Release 配置来自 V2 `app/build.gradle.kts`：

| 配置 | Release 值 |
| --- | --- |
| Cashier URL | `https://cashier.huayueyouxuan.com/` |
| privileged page origin | `https://cashier.huayueyouxuan.com` |
| additional resource host | `api.huayueyouxuan.com` |
| connector API base | `https://api.huayueyouxuan.com/api/v1` |
| User-Agent suffix | `YunQiaoMerchantTerminal/2.0` |

`OriginPolicy` 的关键规则：

- 只有 Cashier 同源页面拥有 Native Bridge 权限；
- API host 只允许作为 HTTPS 资源来源，不获得页面/Bridge 权限；
- 不支持 wildcard；
- 阻止 HTTP、file、content、未知 scheme 和带 userinfo 的 URL；
- 同源 HTTPS 在 WebView 内导航；外部安全 HTTPS 打开系统浏览器；`tel:` 打开拨号器；
- SSL 错误直接取消，不能绕过；
- Safe Browsing 命中时返回安全页；
- renderer 退出后销毁旧 WebView并重建。

WebView 设置：JavaScript 和 DOM storage 开启；file/content access、mixed content、zoom、第三方 Cookie 关闭；普通 Cookie 和 WebView profile 持久化保留。

## 4. 登录与 session 机制

Web Cashier 的 token key：

```text
yunqiao_cashier_access_token
```

登录状态来源：

| Web 存储 | Android 判定 | Native 保存 |
| --- | --- | --- |
| `localStorage` | PERSISTENT | Android Keystore AES/GCM 加密保存 Merchant JWT |
| `sessionStorage` | PROCESS | 仅当前进程内存保存 |
| 都没有 | SIGNED_OUT | 清除 Merchant JWT 与 Terminal Bearer，停止 connector |

页面加载/恢复后，Android 仅对受信页面执行 `evaluateJavascript`：

1. 读取 localStorage/sessionStorage 快照；
2. 校验 token 长度及 JWT 三段格式；
3. 解析 Merchant JWT 中 `merchantId`；
4. 使用 Merchant JWT 和本地 terminal secret bootstrap；
5. 得到/构造 Terminal Bearer 后启动打印服务。

Terminal secret 为 32-byte 随机值的 base64url，Terminal Bearer 形式为：

```text
yt1.<terminalId>.<terminalSecret>
```

Merchant JWT 只用于 Web session/bootstrap；heartbeat、config、binding、job、Attempt 均使用：

```http
Authorization: Terminal <terminalBearer>
```

Token 从不通过暴露给 Web 的 message object 传递。Native 只在受信主 frame 中主动读取 Web storage。

## 5. Web 与 Android Bridge

当前没有 `Android.print()`、`printReceipt()` 或任意 Web -> Native 打印数据方法。

### 5.1 Bridge 对照表

| Web 对象/调用 | Android 实现 | 参数 | 返回值 | 作用 |
| --- | --- | --- | --- | --- |
| `YunQiaoMerchantSession.postMessage('SIGNED_OUT')` | `TrustedWebMessageBridge` -> `MerchantSessionCoordinator` | 固定字符串 | 无 | fail-closed 清除 session 与 Terminal Bearer，停止 connector |
| `YunQiaoMerchantSession.postMessage('SESSION_CHANGED')` | `TrustedWebMessageBridge` -> `observeMerchantSession()` | 固定字符串 | 无 | Native 重新读取受信页面 storage |
| `YunQiaoMerchantSession.postMessage('LANGUAGE_CHANGED:zh\|vi\|en')` | `TrustedWebMessageBridge` -> `applyWebLanguage()` | 白名单语言 | 无 | 同步 Native 打印机页语言 |
| `YunQiaoMerchantTerminal.postMessage('{"type":"OPEN_PRINTER_DEVICES","version":1}')` | WebMessage listener + `@JavascriptInterface` fallback | 严格 2-field JSON | 无 | 打开 Native 打印机与设备页 |

WebMessage listener 只接受：受信 origin、main frame、string message。打印机消息 JSON 必须只有 `type` 与 `version` 两个字段，version 必须为 1。

旧 Web 兼容脚本会在账户菜单缺少入口时动态插入“打印机与设备”按钮，但不会增加打印能力或改变协议。

## 6. 后台模板是如何进入 Android 的

### 6.1 模板管理 API

模板由 Merchant Printing Controller 管理，主要路径（API base 已含 `/api/v1`）：

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/merchant/printing/templates` | 模板列表 |
| POST | `/merchant/printing/templates` | 创建模板 |
| GET/PUT | `/merchant/printing/templates/current/order-customer` | 当前顾客小票设置 |
| GET/PUT | `/merchant/printing/templates/current/table-bill` | 当前结账小票设置 |
| GET/PATCH | `/merchant/printing/templates/:id` | 读取/版本化更新 |
| POST | `/merchant/printing/templates/:id/duplicate` | 复制模板 |

这些是 Merchant Admin/API 端点；Android 不直接请求它们。

### 6.2 数据库模板定义

`ReceiptTemplate.definition` 当前为 schemaVersion 1，字段包括：

- `sections`；
- `display`：商家名、地址、电话、订单号、桌号、时间、备注、单价、总计、页脚等开关；
- `footerText` / `footerTextZh` / `footerTextVi`。

模板记录有 `receiptType`、`paperWidth`、`languageMode`、`version`、`enabled`。更新不是原地覆盖：创建新版本、停用旧版本，并使关联自动规则 fail-closed。

### 6.3 创建 PrintJob 时应用模板

服务端创建任务时：

1. 校验 Printer、ReceiptTemplate 均属于商家且启用；
2. 校验模板 `receiptType` 和 `paperWidth` 与任务/打印机一致；
3. 从 Order/TableSession 生成业务 `ReceiptDocument` schema 1；
4. 应用模板 footer/display；
5. 根据终端 appVersion 能力将业务文档渲染为 presentation-only `PrintDocument` V2/V3；
6. 在 PrintJob 内冻结 `receiptSnapshot`；
7. 同时保存 `receiptTemplateId`、`receiptTemplateVersion` 与 `receiptSnapshotHash`。

PrintDocument 不包含 templateId、订单业务对象、变量表达式或可执行命令。模板变量绑定已在服务端任务创建阶段完成。

### 6.4 Android 实际收到的模板格式

RC12.2 优先收到：

```json
{
  "documentType": "PRINT_DOCUMENT",
  "schemaVersion": 3,
  "paperWidth": "MM80",
  "copies": 1,
  "blocks": []
}
```

支持的 presentation blocks：

| V2 | V3 新增 |
| --- | --- |
| TEXT | COLUMNS（2-4 列、权重、gap、padding、FIT/ELLIPSIS） |
| ROW | BOXED_TITLE |
| DIVIDER | TEXT overflow |
| FEED | 其余 V2 block 保持兼容 |
| CUT |  |

`CUT` 最多一个且必须是最后 block。允许 `NONE`、`HALF`、`FULL`。

兼容旧任务时仍可收到业务 `ReceiptDocument` schema 1；Android 保留旧 renderer，因此 Windows 也必须保留严格的 schema 1 parser、旧版 bitmap 排版和默认 HALF cut，不能把上线前已创建的旧任务直接判为模板无效。

### 6.5 模板类型与业务事件

数据库 `ReceiptType` 当前只有：

- `ORDER_CUSTOMER`；
- `TABLE_BILL`。

打印机 purpose 支持 `FRONT_DESK`、`KITCHEN`、`BAR`、`LABEL`。厨房/档口并不是新增 receipt JSON 类型：后台路由会按打印机 purpose、规则和菜单 category 创建过滤后的 `ORDER_CUSTOMER` snapshot，并选择 CUSTOMER/KITCHEN render mode。

### 6.6 模板缓存与更新

Android 不缓存可变模板，也不在启动/登录时下载模板。

每个 PrintJob 携带创建当时的不可变 snapshot；补打可保留历史 snapshot。后台模板更新只影响更新后创建的新任务，不会重写已存在任务。这个策略同时保证历史一致性和模板版本可追踪性。

## 7. Terminal/PrintJob API 协议

统一请求规则：

- Base URL：`https://api.huayueyouxuan.com/api/v1`；
- JSON UTF-8；
- `Accept: application/json`；
- `Content-Type: application/json; charset=utf-8`；
- 禁止 HTTP redirect；
- connect timeout 8s，read timeout 20s；
- response envelope 必须为 `{ code: 'OK', data: ... }`；
- response 上限 1,048,576 chars；
- Terminal 请求附 `X-Terminal-App-Version`。

主要端点：

| Auth | Method | Path | 作用 |
| --- | --- | --- | --- |
| Bearer Merchant JWT | POST | `/merchant/printing/connector/lan-terminal/bootstrap` | 用 terminalInstanceId/secret 注册或恢复 Terminal credential |
| Terminal | POST | `/terminal/heartbeat` | 20s 默认 heartbeat、能力和 configVersion |
| Terminal | GET | `/terminal/config` | 总开关、自动创建、轮询间隔、USB binding/tombstone |
| Terminal | GET | `/terminal/lan/config` | LAN 开关、bindings/tombstones |
| Terminal | POST | `/terminal/usb/bindings/sync` | 同步本地 USB binding |
| Terminal | POST | `/terminal/lan/bindings/sync` | 同步 LAN binding |
| Terminal | POST | `/terminal/v2/bindings/archive` | 归档 binding |
| Terminal | POST | `/terminal/printers/status` | USB status |
| Terminal | POST | `/terminal/lan/printers/status` | LAN status/readiness |
| Terminal | GET/POST | `/terminal/jobs/active`, `/terminal/jobs/claim` | USB active/claim |
| Terminal | GET/POST | `/terminal/lan/jobs/active`, `/terminal/lan/jobs/claim` | 指定 LAN route active/claim |
| Terminal | POST | `/terminal[/lan]/jobs/:id/extend[-lease]` | 延长租约 |
| Terminal | POST | `/terminal[/lan]/jobs/:id/printing` | 创建/确认 Attempt |
| Terminal | POST | `/terminal[/lan]/jobs/:id/succeeded` | 成功回报 |
| Terminal | POST | `/terminal[/lan]/jobs/:id/failed` | FAILED/UNCERTAIN 回报 |

Claimed job 的关键字段：

```text
id, merchantId, printerId, status, receiptType, source,
attemptCount/currentAttempt, leaseVersion/leaseExpiresAt,
contentHash, snapshotSchemaVersion, receiptSnapshot,
route { printerId, localBindingId, bindingVersion, adapter }
```

## 8. 完整打印调用链

```text
Cashier/API 业务事件或人工补打
  -> PrintRules / PrintingRouting
  -> ReceiptSnapshotService 生成业务快照
  -> ReceiptTemplate display/footer 生效
  -> renderPrintDocumentV2/V3
  -> PrintJob(PENDING + immutable receiptSnapshot + SHA-256)

V2PrinterService poll loop
  -> heartbeat/config/lanConfig
  -> 同步本地 bindings/status
  -> active job 或 claim
  -> 校验 source、route、bindingVersion、enabled、physical readiness
  -> CanonicalReceiptHash 校验 receiptSnapshot == contentHash
  -> 本地 PrintExecutionLedger reserve
  -> 解析 PrintDocument V2/V3
  -> WYSIWYG Bitmap render（中越文字由系统字体绘制）
  -> ESC/POS raster encode
  -> extend lease
  -> mark PRINTING / Attempt
  -> 单端点互斥执行 USB 或 LAN write
  -> 本地 ledger: SUCCEEDED / FAILED / UNCERTAIN
  -> 向服务器回报结果；回报失败则保留 pending report
```

## 9. 模板渲染与打印数据格式

### 9.1 纸宽

| paperWidth | 点宽 |
| --- | ---: |
| MM58 | 384 |
| MM80 | 576 |

允许编码器范围为 200-1024 dots；V2 同步不接受 CUSTOM。

### 9.2 Bitmap 渲染

Android 使用 `android.graphics.Canvas/Paint/Typeface.SANS_SERIF`：

- 白底黑字，anti-alias；
- V3 以 576 dots 为缩放基准；
- 左右 margin 比例 0.052，最低 14 dots；
- SMALL/NORMAL/LARGE 为 20/24/34 * scale，V3 最低字号 14；
- FIT 通过横向 `textScaleX` 收缩；
- ELLIPSIS 使用 `…`；
- 最大 raster 高度 8000；
- threshold 固定 160。

### 9.3 ESC/POS bytes

最终发送的是 ESC/POS raster bytes，不是 UTF-8/GBK 文本、HTML、PDF 或 Windows GDI 排版。

编码结构：

```text
ESC @                  初始化
ESC a 1                居中
重复：
  GS v 0 0 xL xH yL yH
  <=256 rows raster data，MSB first
LF LF LF               走纸
GS V 1                 HALF CUT
或 GS V 0              FULL CUT
```

Bitmap alpha 先合成到白色，luminance 公式为 `(R*299 + G*587 + B*114)/1000`，小于等于 160 为黑点。

## 10. 中文和越南语

生产小票采取：

```text
Unicode text -> Android Canvas Bitmap -> monochrome raster -> ESC/POS bytes
```

所以中文、越南语及声调不依赖打印机 code page。Windows 必须保持 bitmap/raster 思路，不能改成 GBK、CP936、UTF-8 直发。

测试应至少覆盖：

```text
云桥、结账单、厨房、桌号08
Cơm rang、Bún xào、Mì xào、Đã thanh toán
Giao hàng、Tự lấy tại cửa hàng
```

ASCII 直发只存在于硬件 smoke receipt，不是生产小票 renderer。

## 11. USB 打印

### 11.1 发现与选择

`UsbDeviceInspector` 枚举 `UsbManager.deviceList`，记录：

- VID/PID、device class/subclass/protocol；
- interface index/id/alternate setting/class；
- BULK OUT endpoint address/maxPacketSize；
- Android permission。

优先 USB Printer class 7；明确排除 HID、Mass Storage 和 Hub。不是严格 VID/PID 白名单，但 binding 固定并复核 VID/PID/interface/endpoint identity。

### 11.2 权限

- 通过 explicit Activity PendingIntent 调 `UsbManager.requestPermission`；
- 同一时刻只允许一个 permission request；
- 15s timeout；
- attach/detach 后重新 scan，不信任广播 payload 作为 binding；
- 重启、解锁、包更新与 USB attach 有恢复调度。

### 11.3 连接和发送

```text
find device
  -> hasPermission
  -> verify interface identity/alternate setting
  -> verify BULK OUT endpoint
  -> openDevice
  -> claimInterface(force=true)
  -> optional setInterface
  -> chunked bulkTransfer
  -> releaseInterface/close
```

chunk 目标 4096 bytes，按 maxPacketSize 对齐，最大 16384；每次 transfer timeout 默认 5000ms。任何部分写入/结果不明都进入 UNCERTAIN，禁止静默重试。

## 12. LAN 打印

LAN binding 为私网 IPv4 + port，默认 9100。只允许：

- `10.0.0.0/8`；
- `172.16.0.0/12`；
- `192.168.0.0/16`。

连接实现：non-blocking `SocketChannel` + Selector；connect timeout 2000ms；`TCP_NODELAY=true`、`keepAlive=false`；write timeout 8000ms。整份 ESC/POS byte[] 在一个有 deadline 的 write loop 内写完。

LAN discovery 扫描本机私网地址所在 /24，默认探测 9100，350ms/host，最多 508 地址、32 并发。手工 IP 始终可用。

公网断开不等于 LAN 不可用；LAN readiness 独立 probe 和上报。

## 13. 本地绑定、队列与防重复

Room 数据库 `terminal_printing_v2.db` 保存：

1. `local_printer_bindings`；
2. `pending_binding_operations`；
3. `pending_status_reports`；
4. `print_execution_ledger`。

本地 execution key：

```text
<merchantId>:<jobId>:<attemptNo>
```

防重复规则：

- 同 job 的 contentHash 变化：拒绝；
- SUCCEEDED：DuplicateBlocked；
- PRINTING/UNCERTAIN：RequiresOperator；
- 同 attempt 的 FAILED：不自动再打；
- App 中断时 PRINTING 恢复为需要人工处理的不确定状态；
- 服务器 lease/Attempt 与本地 ledger 必须同时成功后才能 I/O；
- 补打由服务器创建新的合法 job/attempt，不能被普通重复拦截误伤。

USB/LAN/Bluetooth 对同一 endpoint 有进程级互斥锁，避免两个 coroutine 同时写一台打印机。

## 14. 错误与 WEB 返回

打印不是 Web Bridge 同步调用，所以没有“Native callback 给本次 Web 点击”的返回值。

错误通过 PrintAttempt/PrintJob 后台状态回报；Cashier/管理端读取任务状态。Native 分类包括：

- USB permission/device/interface/open/claim/timeout/partial-write；
- LAN invalid/connect/timeout/write；
- bitmap/schema/width；
- route/config mismatch；
- `PRINT_OUTCOME_UNKNOWN`。

规则：0 bytes 且未尝试 I/O 的明确失败可以按服务器白名单重试；已经尝试 I/O、部分写入或异常中断必须为 UNCERTAIN 且不可自动重试。

## 15. 切纸、钱箱与蜂鸣器

当前 Android 已实现：

- NONE；
- HALF：`1D 56 01`；
- FULL：`1D 56 00`。

当前生产 PrintDocument V2/V3 由后台在最后一个 CUT block 下发，默认生成 HALF。

当前 Android/V2 源码没有 cash drawer、drawer pulse 或 buzzer ESC/POS 命令。Windows 不能猜测并新增钱箱命令；只有未来后台/Android 协议正式增加后才能同步实现。

## 16. 第三方库

没有第三方 ESC/POS SDK。核心打印、USB、LAN、raster 全为项目自有封装。

关键 Android 依赖：

- AndroidX WebKit 1.12.1：受信 WebMessage Bridge；
- Room 2.6.1：本地 binding/ledger；
- DataStore 1.1.2：terminal identity/UI preference；
- WorkManager 2.10.0：恢复调度；
- Kotlin coroutines 1.9.0；
- ZXing 3.5.3；
- Compose：Native 打印机管理 UI。

## 17. Git 历史中的重要约束

| Commit | 约束/修复 |
| --- | --- |
| `b9a78fe` | 恢复旧 RC5 USB receipt 兼容，说明 snapshot 能力必须按 appVersion gate |
| `0e4ceb6` | 启用 authenticated LAN terminal printing |
| `97fdeb3` / `6a26581` | 统一 USB/LAN job pipeline，增加 V2 WebView bridge |
| `42e341d` / `6a74fea` | 关闭 USB/LAN claimed job 执行链缺口 |
| `9819448` | 路由必须排除 archived printer |
| `2268331` / `2c1e552` / `3e19f36` | USB 添加、默认 handler、解锁后 permission 恢复 |
| `3efb13f` | PrintDocument V2 与后台 receipt settings 定型 |
| `8f76806` | PrintDocument V3/RC12.1 收据布局与中越可读性 |

Windows 实现不能回退这些 gate：appVersion 能力、immutable snapshot、bindingVersion、archive tombstone、lease、Attempt、本地 ledger、partial-write UNCERTAIN。

## 18. Windows 必须兼容的协议清单

### 必须保持

- 同一 Web Cashier URL 与 local/session storage key；
- 同一 Bridge object/message；
- Merchant JWT -> Terminal Bearer bootstrap；
- Terminal auth headers 与 API envelope；
- server-created PrintJob/receiptSnapshot；
- PrintDocument V2/V3 strict parser；
- canonical SHA-256；
- 384/576 dots、threshold 160、256-row strips；
- CUT bytes；
- USB/LAN route identity 与 bindingVersion；
- lease -> mark printing -> one physical write -> result report；
- local duplicate/uncertain safeguards；
- bitmap rendering for Chinese/Vietnamese；
- logs must redact token/secret/password。

### Windows 平台映射

| Android | Windows |
| --- | --- |
| Android WebView | Microsoft WebView2 persistent profile |
| Android Keystore | Windows DPAPI CurrentUser |
| Room ledger | durable local ledger under `%LOCALAPPDATA%\YunQiao\Cashier` |
| USB bulkTransfer | Windows installed printer RAW spooler write |
| LAN SocketChannel | `TcpClient`/`NetworkStream` direct byte write |
| Canvas/Paint Bitmap | WPF text/raster render, keeping equivalent dot geometry |
| Foreground service | in-process background connector while YunQiao Cashier runs |

Windows 不需要复制 Android USB permission API；Windows USB 的受支持边界是系统已安装的打印队列，并通过 RAW spooler 发送完整 ESC/POS bytes，不弹打印对话框、不由 Windows 重排版。

## 19. 明确不做的兼容误区

- 不调用 `window.print()`；
- 不在 C# 写固定顾客单/厨房单模板；
- 不从 Web 接收任意 receipt JSON；
- 不另建模板下载/cache/version 协议；
- 不把中文/越南语直接编码为 printer text；
- 不把 socket write 返回等同于纸张物理验收；
- 不因 Windows 实现修改或移除旧 Android Bridge；
- 不把当前不存在的钱箱、蜂鸣器能力写成“已支持”。
