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
├── terminal-secret.bin       # DPAPI CurrentUser
├── terminal-credential.bin   # DPAPI CurrentUser
├── WebView2\                 # Cookie / localStorage profile
├── state\                    # execution ledger / pending reports
└── logs\                     # 14-day rolling logs
```

日志不记录 Merchant JWT、terminal secret/bearer、Cookie 或 receiptSnapshot 全文。

## 门店设置

从 Web 收银右上角账户菜单的打印设备入口，或 Windows 顶栏“打印机设置”打开 Native 设置：

1. Windows Printer：选择 Windows 已安装的打印机，应用使用 `DataType=RAW`；
2. LAN Printer：填写私有 IPv4 与端口；
3. 选择 58/80mm 与现有 role；
4. 保存；
5. 使用“测试打印”验证中越文、金额和切纸。

测试打印是明确标记的本地设备诊断内容，不代替后台业务模板。

## 验证状态

macOS 开发机不能运行 WPF、WebView2、winspool 或 Inno Setup。本仓库提供 Windows CI、测试、publish 和安装工程，但首次门店交付仍必须在 Windows 10/11 与真实 58/80mm USB/LAN ESC/POS 打印机完成物理验证。

`Implemented but requires Windows hardware validation`.
