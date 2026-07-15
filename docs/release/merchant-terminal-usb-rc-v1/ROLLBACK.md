# Merchant Terminal USB RC 回滚

## 首要动作

1. 先关闭全局自动任务创建、目标商家 `PrintRule.autoPrint` 与 Android `automaticPrintingEnabled`，阻断新自动任务；旧直打继续为 false。
2. 关闭商家打印总开关、目标 Printer 和 Android `connectorEnabled`，阻断新任务领取与 USB 执行。
3. 检查 `CLAIMED/PRINTING`、有效租约和本地待回报任务。等待当前操作安全结束；若纸张结果不能确认，标记 `UNCERTAIN` 并人工核对，禁止盲目补打。
4. 优先将 MerchantTerminal 设为 `DISABLED`：凭据保留，可继续 heartbeat/config 诊断，执行接口返回 `409 TERMINAL_DISABLED`。
5. 只有凭据泄露、终端丢失或明确放弃本地身份时才 `REVOKE`；撤销会使旧 Token 永久失效并要求重新配对，不能当作普通暂停。
6. 保留 PrintJob、PrintAttempt、Room 脱敏诊断和错误记录，不删除历史。
7. Web 收银台继续用于订单和桌台业务。

不允许恢复旧服务器 Socket/TCP/LAN 直打。

## Android 回滚

- 使用相同正式签名的 rollback APK 覆盖安装。
- rollback APK 使用高于 RC 的 versionCode，以支持普通覆盖安装；这会消耗一个版本号，之后所有正式升级必须再高于 rollback。
- 不要卸载后重装，除非接受清除本地绑定与 Web 登录状态。
- 回滚包只保留 WebView/诊断能力，不执行 PrintJob。
- 无论 APK 是否回滚，服务端和本地开关都必须先按“首要动作”关闭。
- 记录 rollback 来源 Commit、包名、versionCode、证书和“不 claim PrintJob”的能力边界。

## API/Web 回滚

- API 切回上一已验证构建，保持新数据库表不写入。
- Web 静态站点切回上一发布目录。
- migration 不做未经审核的破坏性反向删除；新增表可以在功能关闭时保留。
- 检查登录、订单、桌台、TableSession 和 API health。

## 现场失败信息

保留并脱敏：终端 ID、APP 版本、USB VID/PID、接口/端点、授权状态、错误码、PrintJob ID、Attempt 号、计划/实际写入字节数。不得记录 Token、Cookie、客户电话或地址。
