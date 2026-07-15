# Merchant Terminal USB RC 发布 Gate

> 更新于 2026-07-15。`PASS` 只代表本地代码或构建验证通过，不代表已经部署、安装或真实出纸。

## 本地交付 Gate

| Gate | 当前状态 | 证据/通过条件 |
|---|---|---|
| 既有 printing migration 隔离验证 | PASS | `docs/printing-v1/10_ISOLATED_MIGRATION_VALIDATION.md` |
| RC migration 隔离验证 | PASS | MySQL 8.4 从空库执行 16 个 migration、二次 deploy、约束与清理均通过；见 `ISOLATED_RC_MIGRATION_VALIDATION.md` |
| API 回归 | PASS | Prisma validate、typecheck、28 suites / 269 tests、build |
| merchant-admin 回归 | PASS | typecheck、生产 build；现有 bundle-size warning 不阻断 |
| merchant-cashier 回归 | PASS | typecheck、lint、16 files / 81 tests、七种 viewport 三语言 UI、Fixture=false 生产 build |
| Android 回归 | PASS | clean、67 tests、lint 0 error/22 warning、debug/release build |
| 正式签名材料 | PASS | 长期 JKS 位于 Git 外，证书 SHA-256 已固定；密码仅在本机 Keychain |
| 正式签名候选 APK | 待最终 Commit 后生成 | 正式包名、真实候选 URL/API、release 证书、R8、校验值 |
| 诊断与 rollback APK | 待最终 Commit 后生成 | debug 诊断包；同证书且更高 versionCode 的不领取任务 rollback 包 |
| Secret/隐私扫描 | 待最终 Commit 前复核 | 无账号、密码、Token、Cookie、顾客隐私、keystore、local.properties、构建产物进入 Git |
| 部署包 Manifest | 待最终构建 | Web/admin/API/migration/APK 的路径、SHA-256、Commit 和 NOT DEPLOYED 标记 |

## 生产与安装 Gate

| Gate | 当前状态 | 通过条件 |
|---|---|---|
| Web 正式 Origin | BLOCKED | DNS、TLS、Nginx、公开健康检查和资源 Host 明确 |
| 生产数据库备份 | BLOCKED | 加密备份、SHA-256、受控副本和隔离恢复演练 |
| 生产 migration | BLOCKED | 备份 Gate、授权身份、维护窗口和生产 migration 状态明确后执行 |
| API/admin/Web 部署 | BLOCKED | 真实服务器、目录、进程、Secret 注入、原子发布与回滚命令明确 |
| API 生产 Flag | BLOCKED | 实际运行值可验证；legacy/auto/execution 仍为 false |
| Keystore 灾备 | BLOCKED | JKS 至少两份加密离线备份并完成可读性校验 |
| APK 首次门店安装 | BLOCKED | Web/API/DB/灾备 Gate 通过，并现场核对 APK 与证书 SHA-256 |
| 真实 USB | NOT TESTED | 到店实机识别、出纸、纸宽、中越文、QR、切纸、缺纸、插拔与恢复 |

## 到店前必须保持

```text
LEGACY_PRINTING_ENABLED=false
PRINTING_TASK_CENTER_ENABLED=true
PRINTING_AUTO_CREATE_ENABLED=false
PRINTING_EXECUTION_ENABLED=false
Merchant.printingEnabled=false
Printer.enabled=false
PrintRule.enabled=false
PrintRule.autoPrint=false
MerchantTerminal.status=UNPAIRED 或 DISABLED
Android connectorEnabled=false
Android automaticPrintingEnabled=false
```

代码具备执行能力不等于允许执行。任一生产或安装 Gate 未通过，都不能把 RC 描述为已上线。
