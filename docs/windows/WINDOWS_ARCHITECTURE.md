# YunQiao Windows 收银客户端架构

> 状态：实现基线
>
> 目标平台：Windows 10/11 x64
>
> 技术栈：C#、.NET 8、WPF、Microsoft Edge WebView2
> Android 审计依据：[`ANDROID_PRINT_ARCHITECTURE.md`](./ANDROID_PRINT_ARCHITECTURE.md)

## 1. 设计结论

Windows 客户端不是另一套收银系统，也不建立另一套小票协议。它是当前 Android Merchant Terminal V2 的 Windows 传输适配层：

```text
现有 Cashier Web
  -> 与 Android 相同的 session / device Bridge
  -> 与 Android 相同的 Terminal bootstrap 与 PrintJob API
  -> 服务端创建时已解析好的 receiptSnapshot / legacy ReceiptDocument V1 / PrintDocument V2 或 V3
  -> Windows 复刻 Android 的 bitmap + ESC/POS raster 编码
  -> Windows RAW Spooler 或 TCP 9100
```

以下内容保持不变：

- Cashier URL、登录 token key、可信 origin 和 API base；
- 服务端模板解析、模板版本、PrintJob、receiptSnapshot 与 receiptHash；
- terminal bootstrap、心跳、租约、attempt 状态上报和重打语义；
- 58/80mm 的 384/576 dots、V3 blocks、最终切纸、中文/越南语 bitmap 路径；
- Android 现有 Bridge 对象名和消息；
- Android 应用、Web、Terminal API 路径与数据库结构。

Windows 新增：WebView2 宿主、按商家隔离的 Windows 凭据保护、WPF bitmap renderer、RAW Spooler、TCP transport、本地执行账本、设置界面、日志、安装脚本和 Windows CI。服务端仅扩展现有 USB readiness 判断以识别 Windows RAW Spooler 的明确证据，不新增 API 或数据库字段。

## 2. 明确不做

- 不在 Windows 写死订单小票模板；
- 不解析或复制 Merchant Admin 的模板编辑规则；
- 不使用 `window.print()`、打印对话框、GDI 分页或驱动排版；
- 不新增 Windows 专用后端 API、数据库字段或打印任务类型；
- 不伪造 Android 当前不存在的钱箱或蜂鸣指令；
- 不把 Web 的普通 `postMessage` 设计成“立即打印”回调：当前 Android Bridge 没有这种接口；
- 不在 Windows 端自动重试已进入物理 I/O 的 `UNCERTAIN` 任务；
- 不改变 Android 的 API/Bridge 行为。

## 3. 代码目录

```text
clients/windows/YunQiao.Cashier/
├── YunQiao.Cashier.sln
├── Directory.Build.props
├── README.md
├── src/
│   ├── YunQiao.Cashier.Core/
│   │   ├── Contracts/
│   │   ├── Printing/
│   │   ├── Protocol/
│   │   ├── Queue/
│   │   └── Security/
│   └── YunQiao.Cashier/
│       ├── Web/
│       ├── Printing/
│       ├── Settings/
│       ├── Logging/
│       ├── MainWindow.xaml
│       └── SettingsWindow.xaml
├── tests/
│   └── YunQiao.Cashier.Core.Tests/
├── installer/
│   └── YunQiao.Cashier.iss
└── scripts/
    └── build-windows.ps1
```

`Core` 只依赖跨平台 .NET 8 API，以便协议、hash、ESC/POS 和 TCP 测试不依赖 WPF。WPF 项目只承载 WebView2、Windows raster、DPAPI、Spooler 和 UI。

## 4. 运行时组件

### 4.1 `MainWindow`

- 最大化启动，支持高 DPI、触摸和窗口状态记忆；
- 内容主体只有当前 YunQiao Cashier Web；
- Native Shell 不提供第二套打印设置入口；打印设备统一从 Cashier Web 左下角账户菜单进入；
- 正常状态仅显示低优先级“设备正常”，WebView 加载失败时才显示“重新加载”；
- 不显示地址栏、浏览器菜单或打印 UI。

### 4.2 `WebViewHost`

固定配置：

| 配置 | 值 |
|---|---|
| Cashier URL | `https://cashier.huayueyouxuan.com/` |
| API base | `https://api.huayueyouxuan.com/api/v1` |
| trusted origin | `https://cashier.huayueyouxuan.com` |
| resource host | `api.huayueyouxuan.com` |
| token key | `yunqiao_cashier_access_token` |
| UA compatibility token | `YunQiaoMerchantTerminal/2.0` |

WebView2 使用 `%LOCALAPPDATA%\YunQiao\Cashier\WebView2` 持久 profile，登录状态继续由 Web 的 Cookie/localStorage 管理。Native 只在可信主框架读取 session token；不记录 token。

导航策略与 Android 一致：

- 顶层页面只允许 trusted origin；
- `api.huayueyouxuan.com` 可作为资源/API host，但不可成为顶层页面；
- 外部 `http/https` 链接交给系统浏览器；
- 非 `http/https` scheme 拒绝；
- WebView2 下载、默认上下文菜单、DevTools 和浏览器加速键在 release 中关闭。

### 4.3 `AndroidBridgeCompatibility`

在每个 document 创建前注入两个与 Android 同名对象：

```javascript
window.YunQiaoMerchantSession.postMessage(message)
window.YunQiaoMerchantTerminal.postMessage(message)
```

它们只将消息封装到 `window.chrome.webview.postMessage`。Native 严格接受 Android 已有协议：

- `SIGNED_OUT`
- `SESSION_CHANGED`
- `LANGUAGE_CHANGED:zh|vi|en`
- `{"type":"OPEN_PRINTER_DEVICES","version":1}`

`OPEN_PRINTER_DEVICES` 打开 Windows Native 打印设置。当前 Android 没有 `printReceipt` Bridge，也没有 print success/error Web callback；Windows 不发明新 callback。打印成功/失败仍通过 Terminal PrintJob API 上报，Web/后台从服务器状态获知结果。

Windows 的门店入口与 Android 完全相同：Cashier Web 左下角账户区域 -> 打开账户菜单 -> “打印机与设备” -> `YunQiaoMerchantTerminal.postMessage(...)` -> Windows Native“打印设备”模态窗口。Native 窗口继续使用内部 `WindowsSpooler` / `Lan` 配置值，但用户界面只显示“USB 打印机”与“网络打印机”。

### 4.4 `SessionObserver`

- 导航完成、`SESSION_CHANGED` 和应用恢复时读取可信主框架 localStorage/sessionStorage；
- token 不存在时停止 connector，并清除本机 terminal credential；
- token 改变时重新 bootstrap；
- token 只在内存中短暂存在，日志永不输出；
- terminal id/secret/bearer 按 `merchantId` 隔离，并使用 Windows DPAPI `CurrentUser` 加密后保存；
- 旧版本升级时先安全复用旧终端身份；只有服务端明确返回 `TERMINAL_DEVICE_CONFLICT` 时，才为当前门店生成独立身份并重试一次；
- 切换门店只清除上一门店的 bearer，不删除其稳定终端身份，返回原门店时不会创建重复终端。

## 5. Terminal API 兼容

### 5.1 身份建立

```text
Merchant JWT
  POST /merchant/printing/connector/lan-terminal/bootstrap
  -> terminalId + terminalSecret + terminalBearer
  -> Authorization: Terminal yt1.<terminalId>.<terminalSecret>
```

Windows 报告的兼容版本为 `2.0.0-rc12.2`，因为现有服务端只接受严格的 Android 版本正则来决定 V2/V3 snapshot。给版本增加 `-windows` 会被判为不支持并降级，所以平台通过 `deviceName/platform` 与日志区分，不改变 `appVersion` 兼容字段。

### 5.2 Connector 循环

循环沿用 Android 的顺序：

1. bootstrap/恢复 terminal credential；
2. heartbeat 与 config 同步；
3. 同步 USB logical binding 和 LAN binding；
4. 拉取 active jobs；
5. claim lease；
6. 创建 attempt 并标记 `PRINTING`；
7. 进行一次且仅一次物理 I/O；
8. 上报 `SUCCEEDED`、确定失败或 `UNCERTAIN`；
9. 写入本地账本。

所有 DTO 和 route 复用 Android 现有 API。Windows 不把 Web 消息直接转成 PrintJob。

### 5.3 后端兼容字段

- Windows 已安装打印机仍映射到现有 `LOCAL_USB_ESCPOS` channel；
- Windows logical USB binding 的 `vendorId/productId` 默认 `0/0`，可由设置覆盖；它只用于复用现有 binding API，实际设备选择以保存的 Windows printer name 为准；
- Windows 每轮 binding sync 前通过 `OpenPrinter` + `GetPrinter(level 6)` 检查队列；只在队列存在、可打开、无离线/缺纸/人工干预等阻断状态且执行器就绪时上报 `CONNECTED`；
- 服务端将 `platform=WINDOWS`、`adapter=WINDOWS_RAW_SPOOLER` 及四项完整 Spooler 证据视为 Windows 在线条件；缺项、过期或阻断状态继续 fail-closed；
- LAN 复用现有 LAN binding 和 attempt API；
- 服务端历史字段中的 adapter 名称可能仍保留 Android 命名，这是现有 API 的展示字段，不改变实际 Windows transport；
- printer role 继续使用 `FRONT_DESK/KITCHEN/BAR/LABEL` 和服务端路由，不在客户端重新分单。

## 6. 小票输入与验证

PrintJob 的唯一渲染输入是服务端创建时冻结的：

- `receiptSnapshot`
- `receiptHash`
- `receiptTemplateId`
- `receiptTemplateVersion`
- `receiptType`
- `copies`

Windows 先对 canonical JSON 做 SHA-256 验证，再解析 `PrintDocument`。不下载 `ReceiptTemplate.definition`，因此不会出现“客户端缓存旧模板”的第二事实来源。后台模板更新只影响更新后创建的 PrintJob，与 Android 相同。

支持：

- legacy ReceiptDocument schema 1：严格字段解析、Android 旧版行式 bitmap renderer、默认 HALF cut；
- PrintDocument V2；
- PrintDocument V3 blocks：`TEXT`、`ROW`、`COLUMNS`、`BOXED_TITLE`、`DIVIDER`、`FEED`、`CUT`；
- paper `MM58=384 dots`、`MM80=576 dots`；
- copies `1..10`，切纸只在最后一份结尾；
- `ORDER_CUSTOMER` 与 `TABLE_BILL`；
- 服务端厨房/吧台过滤后的 snapshot。

遇到未知 schema/block、非法 hash、超长文档或非法宽度时，在任何打印 I/O 前失败并上报 `TEMPLATE_INVALID`，禁止“尽量打印”造成错误小票。

## 7. Renderer 与 ESC/POS

### 7.1 Windows bitmap renderer

WPF `DrawingVisual + FormattedText + RenderTargetBitmap` 复刻 Android Canvas renderer：

- Android 和 Windows 使用相同 dots 宽度、padding、字体尺寸、行高、对齐、列宽和换行规则；
- CJK 与越南语均先绘制为黑白 bitmap，不走打印机 code page；
- 字体优先 `Microsoft YaHei UI`，缺失时使用系统 sans-serif；
- raster 阈值 `160`；
- 输出按最多 256 dot rows 分 strip。

不同 OS 字体栅格不能承诺整张 bitmap byte-for-byte 相同；golden 测试固定验证协议结构、宽度、block 布局、关键字符 glyph 非空、ESC/POS header/strip/cut bytes。真实机验收再比较实纸版式。

### 7.2 ESC/POS encoder

与 Android 相同：

```text
ESC @
ESC a 1
GS v 0 0 + xL xH yL yH + raster bytes
LF LF LF
GS V 1    # partial cut
或 GS V 0 # full cut
```

无现金抽屉/蜂鸣命令，因为当前 Android V2 不发送这些 bytes。

## 8. 打印 Transport

统一接口：

```text
IPrinterTransport.SendAsync(byte[], cancellationToken)
```

Renderer 不知道 USB/LAN，transport 不知道模板/订单。

### 8.1 Windows RAW Spooler

`WindowsSpoolerTransport` 使用 `winspool.drv`：

```text
OpenPrinter
StartDocPrinter (DataType=RAW)
StartPagePrinter
WritePrinter
EndPagePrinter
EndDocPrinter
ClosePrinter
```

发送 Android 同源 ESC/POS bytes，不弹对话框，不让 Windows 排版、缩放或加边距。`WritePrinter` 返回部分写入时视为 `UNCERTAIN`，不自动重试。

### 8.2 LAN TCP

`TcpPrinterTransport` 与 Android 相同：

- private IPv4；
- 默认 port `9100`；
- connect timeout `2s`；
- write timeout `8s`；
- `NoDelay=true`；
- 原样写入同一 `byte[]`；
- 写入开始前的明确连接失败可按 connector backoff 重试；写入开始后的超时/断开是 `UNCERTAIN`。

公网 Web/API 断开与局域网打印机连接是两条独立链路。已有 lease 的执行不因 WebView 页面刷新而取消；无法上报的结果放入 pending operation，网络恢复后补报。

## 9. 本地队列、账本与幂等

本地状态位于 `%LOCALAPPDATA%\YunQiao\Cashier\state`：

- `execution-ledger.json`：`merchantId + jobId + attemptId` 的执行结果；
- `pending-operations.json`：尚未成功上报的状态操作；
- 临时文件 + 原子替换，进程内串行锁；
- 不保存完整 receipt、Merchant JWT、terminal secret 明文。

规则：

- `SUCCEEDED` 永不自动再次执行；
- `PRINTING/UNCERTAIN` 在重启后不自动打印，等待后台/操作员重试；
- 只有在未进入 transport I/O 前的确定失败才可自动重试；
- 后台创建的新 reprint Job ID 不会被旧账本拦截；
- 本地状态只做物理执行保护，业务真相仍是服务器 PrintJob/Attempt。

## 10. 设置与测试打印

设置位置：`%LOCALAPPDATA%\YunQiao\Cashier\settings.json`。支持：

- transport：Windows Printer / LAN；
- Windows 已安装打印机枚举与保存；
- LAN 名称、private IPv4、port；
- role：`FRONT_DESK/KITCHEN/BAR/LABEL`；
- paper：58/80mm；
- cut：partial/full（默认与 Android partial 一致）；
- USB logical VID/PID compatibility fields；
- 测试连接、测试打印、立即同步配置。

测试打印使用内置的“设备诊断文档”，不是业务小票模板，也不进入服务端 PrintJob；正文明确标记 `TEST PRINT`，包含中文/越南语和当前设备配置。业务打印绝不使用该固定内容。

## 11. 错误分类

| 阶段 | 示例 | 处理 |
|---|---|---|
| 打印前确定失败 | 未配置打印机、非法 IP、hash/schema 错误、OpenPrinter 失败、TCP connect 失败 | FAILED，可按服务端策略重试 |
| 已开始 I/O 的未知结果 | `WritePrinter` 部分写入、TCP write timeout/断开、进程崩溃时为 PRINTING | UNCERTAIN，不自动重打 |
| 成功 | transport 完整接收全部 bytes | SUCCEEDED；注意这只证明 bytes 已交付给 OS/socket，不等于纸张物理验收 |

状态通过现有 attempt API 返回服务器。日志包含 job/attempt/transport/error code，不包含 receipt 全文或认证信息。

## 12. 日志

目录：`%LOCALAPPDATA%\YunQiao\Cashier\logs`，按天滚动，默认保留 14 天。

记录：

- 应用/WebView2 初始化与 runtime 版本；
- 可信导航拒绝；
- Bridge 消息类型（不含 token/消息全文）；
- bootstrap/heartbeat/config 状态；
- job/attempt id、schema、paper、copies、transport；
- connect、bytes count、成功/确定失败/uncertain；
- pending operation 补报。

不记录密码、Merchant JWT、terminal secret/bearer、Cookie、localStorage 全文、receiptSnapshot 全文。

## 13. WebView2 Runtime 与安装包

应用启动时捕获 `WebView2RuntimeNotFoundException` 并显示明确安装指引。构建脚本下载 Microsoft Evergreen Bootstrapper，Inno Setup 将它和 self-contained `win-x64` publish 一并打入：

```text
YunQiao_Cashier_Setup.exe
```

安装程序静默安装/修复 WebView2 Runtime，然后安装客户端。应用 self-contained 发布，不要求门店预装 .NET 8 Desktop Runtime。当前仓库不保存第三方二进制，只在 Windows build 时获取 bootstrapper。

## 14. 构建与 CI

本地 Windows：

```powershell
.\scripts\build-windows.ps1
```

脚本执行 restore、test、`win-x64 --self-contained` publish、WebView2 bootstrapper staging 和 Inno Setup。CI 使用独立 `windows-latest` workflow，不修改现有 Android/Web job，上传：

- `YunQiao.Cashier-win-x64.zip`
- `YunQiao_Cashier_Setup.exe`
- test results

## 15. 验证边界

macOS 可完成源码、静态审查和仓库边界检查，但不能把 WPF build、WebView2 启动、Windows Spooler 或实纸打印写为已验证。必须在 Windows CI/真实 Windows 设备继续以下 gate：

1. CI restore/build/test/publish；
2. Windows 10 x64 与 Windows 11 x64 启动/WebView2/login/session；
3. 后台真实模板变化后的新 Job；
4. Windows installed RAW printer 58/80mm；
5. LAN 9100 printer；
6. 中越文、金额、长文本、copies、partial/full cut；
7. 断网、重启、uncertain 和人工重打；
8. Setup.exe 全新安装、升级和卸载。

在这些 gate 完成前，交付状态统一为：`Implemented but requires Windows hardware validation`。
