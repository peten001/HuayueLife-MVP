# YunQiao Cashier for Windows

云桥 Windows 收银客户端，面向 Windows 10/11 x64。主界面承载现有 YunQiao Cashier Web，Native 只负责 Android 兼容 Bridge、终端认证和本地打印。

完整设计与 Android 审计：

- `../../../docs/windows/ANDROID_PRINT_ARCHITECTURE.md`
- `../../../docs/windows/WINDOWS_ARCHITECTURE.md`

## 业务边界

- 后台创建 PrintJob 时冻结的 `receiptSnapshot` 是唯一小票输入；
- Windows 不下载/缓存另一份模板，不写死业务小票；
- 支持 legacy ReceiptDocument schema 1 与 PrintDocument V2/V3、58/80mm、copies、partial/full cut；
- 中文与越南语先由 WPF 绘制成 bitmap，再用与 Android 相同的 ESC/POS raster 命令编码；
- Windows Printer 通过 RAW Spooler，LAN 通过 private IPv4 + TCP（默认 9100）；
- 不使用 `window.print()`，不显示 Windows 打印对话框；
- 当前 Android 没有钱箱或蜂鸣 bytes，Windows 也不猜测添加。

## Windows 构建

依赖：

- Windows 10/11 x64；
- .NET 8 SDK；
- Inno Setup 6（仅生成安装包时需要）。

在本目录运行：

```powershell
.\scripts\build-windows.ps1
```

只生成测试与 win-x64 publish：

```powershell
.\scripts\build-windows.ps1 -SkipInstaller
```

输出：

```text
artifacts/YunQiao.Cashier-win-x64.zip
artifacts/installer/YunQiao_Cashier_Setup.exe
artifacts/test-results/
```

应用使用 self-contained `win-x64` publish；安装脚本同时部署/修复 Microsoft Edge WebView2 Evergreen Runtime。

## 本地数据

```text
%LOCALAPPDATA%\YunQiao\Cashier\
├── settings.json
├── terminal-secret.bin       # 旧版本迁移来源，DPAPI CurrentUser
├── terminal-credential.bin   # 旧版本迁移来源，DPAPI CurrentUser
├── terminals\                # 按 merchantId 隔离的终端身份/凭据，DPAPI CurrentUser
├── WebView2\                 # Cookie / localStorage profile
├── state\                    # execution ledger / pending reports
└── logs\                     # 14-day rolling logs
```

日志不记录 Merchant JWT、terminal secret/bearer、Cookie 或 receiptSnapshot 全文。

同一台电脑可以切换登录不同门店。每个门店使用独立且稳定的 terminal instance/secret；升级时保留原门店身份，跨门店冲突时只为新门店生成一次新身份，不覆盖旧门店终端。

## 门店设置

从 Web 收银左下角账户区域打开账户菜单，选择“打印机与设备”，通过与 Android 相同的 Native Bridge 打开“打印设备”窗口：

1. USB 打印机：选择 Windows 已安装的打印机；
2. 网络打印机：填写打印机 IP 与端口；
3. 选择 58/80mm 小票纸与使用位置；
4. 保存；
5. 使用“测试打印”验证中越文、金额和切纸。
6. 在商家后台打印中心确认设备已上报，首次创建的打印机需由商家明确启用并配置自动打印场景。

保存后 Connector 会立即同步。Windows 会实际探测已选打印队列；队列可打开且没有离线、缺纸或人工干预等阻断状态时，后台显示在线。测试打印只证明本机 I/O，后台上报还需要终端注册、心跳、binding sync 和服务端启用打印机全部通过。

正常收银状态不显示刷新工具按钮；只有 WebView 页面加载失败时，底部状态区才提供“重新加载”。内部仍使用 RAW Spooler、LAN/TCP 和现有 role 值，不改变打印协议。

测试打印是明确标记的本地设备诊断内容，不代替后台业务模板。

## 验证状态

macOS 开发机不能运行 WPF、WebView2、winspool 或 Inno Setup。本仓库提供 Windows CI、测试、publish 和安装工程，但首次门店交付仍必须在 Windows 10/11 与真实 58/80mm USB/LAN ESC/POS 打印机完成物理验证。

`Implemented but requires Windows hardware validation`.
