# 云桥 Life 打印中心 V1 RC5 Forward RC 报告

日期：2026-07-28（Asia/Ho_Chi_Minh）

分支：`release/printing-center-v1-rc5-forward-rc1`

状态：本地代码、迁移和自动化 Gate 通过；等待 Push 后记录远程 HEAD。未部署生产。

## 1. RC5 双基线

- Tag `cashier-workflow-v1.0.0-rc5` 精确指向 `143b1a2ccabf6acbd35032ac6075ac2eae6e29c2`。
- `6ef3c1e8d9191fa335b6321bc3d5a7b0e6bd4eb8` 是 `143b1a2` 的祖先。
- `143b1a2` 是 `f6a81d81022d627ffc421c0a88cc35f198144d59` 的祖先。
- `143b1a2 → f6a81d8` 只有 Merchant Cashier Web 的 5 个文件差异：响应式布局、历史订单页、样式和 UI 验证脚本。API、Prisma、Merchant Admin、Miniapp、Android、Deploy 均无差异。

```text
RC5_API_ARTIFACT_BASE=143b1a2ccabf6acbd35032ac6075ac2eae6e29c2
PRINTING_REPO_BASE=f6a81d81022d627ffc421c0a88cc35f198144d59
```

## 2. Forward Base Gate

`/Users/peter/Desktop/HuayueLife-MVP-forward-canonical-base` 保持在 `release/forward-canonical-base@f6a81d8`，状态 clean，未修改、未删除、未重建。

Forward Base 既有结果：

- API：typecheck、40 suites / 381 tests、build PASS。
- Merchant Admin：typecheck、test、build PASS。
- Cashier：41 files / 258 tests、build PASS。
- Android：`testDebugUnitTest`、Debug baseline build PASS。
- 生产数据库只读对账：rounding migration 名称、checksum、字段类型、默认值、NULL、索引和外键与 `f6a81d8` 一致。

## 3. 源打印中心基线与移植方式

源 4 Commit 的父 Commit 为 `0e73aa28e4316427f0459581f50d3d78b820db83`；该 Commit 是 `f6a81d8` 的祖先。父基线到 `f6a81d8` 的中间历史包含 RC5 dine-in auto-accept、pickup rounding、Android RC5 候选与 Cashier Web 收口，未整体移植。

首次直接 Cherry-pick `87e9c1f` 时仅 `receipt-snapshot.service.ts` 冲突；立即执行 `git cherry-pick --abort`，恢复 clean `f6a81d8`。随后按最小闭包 hunk 移植：保留 `f6a81d8` 的 pickup/delivery rounding 快照逻辑，并合入双语商家字段、模板 footer、打印通道及 TableSession settled outbox。其余 3 Commit 无冲突直接移植。

本 RC Commit：

1. `9924369281d7685ec568d33e8853f4d92f3377b1` — `feat(printing): add unified LAN and cloud printing support`
2. `8755b12098028a63bfa1a1b4c0e0d546d51434ff` — `feat(merchant-admin): finalize printing center experience`
3. `86db847ac2717462a654f98b36eaffbcb93ce650` — `feat(printing): unify Chinese Vietnamese receipt rendering`
4. `7d743ae630bf10b4afff51814c9bf64c9a9b4260` — `docs(printing): add V1 validation evidence`
5. `2b6af77c5aa61a38549f7bec88857e1710ca193f` — `fix(deploy): pin canonical api runtime and preserve uploads`
6. `ce44b9446880e9aa4c5b655e1e6bb13fb175d749` — `test(printing): cover cloud provider contracts`

## 4. TableSession 最小 Hook

相对 `f6a81d8`，`table-sessions.service.ts` 只在结账事务完成桌台关闭后调用：

`enqueueAutomaticTableSessionCheckout(tx, { merchantId, tableSessionId })`

共新增 7 行业务代码和对应 mock/assertion。未修改：

- checkout 锁与事务边界；
- `roundingAmountVnd` 和 10,000 VND 向下抹零；
- 订单状态转换和状态日志；
- TableSession 关闭与桌台释放；
- 结账后的异步处理容错。

同一 TableSession / printer / `TABLE_SESSION_SETTLED` 的任务继续使用 PrintTriggerOutbox 和 PrintJob 现有唯一键实现幂等。外部云请求不在结账事务中执行；打印失败不回滚结账。

## 5. Migration Gate

新增且仅新增打印 migration：

- `20260728090000_add_yilian_cloud_channel`
- `20260728100000_add_table_session_settled_printing`

检查结果：

- 没有修改或重放 `20260725000000_add_table_session_rounding`、`20260727000000_add_order_rounding`。
- 没有 `DROP`、字段重命名或非打印业务 migration。
- 全新本地数据库：21/21 migrations PASS，状态 up to date。
- 升级数据库：先执行 `f6a81d8` 的 19 migrations，再执行 RC 的 2 migrations，PASS。
- 临时测试数据库已在成功验证后删除；未连接或写入生产数据库。

## 6. 白名单与端边界

- `apps/merchant-cashier`：相对 `f6a81d8` 零差异。
- `apps/miniapp`：零差异。
- Android 只修改 `ReceiptDocumentV1.kt` 与 `ReceiptDocumentRenderer.kt`；Connector、USB、WebView、诊断和 APK 配置零差异。
- Merchant Admin 代码与源验收 Commit `27fad37` 的 Admin tree 无差异。
- 18 张既有验收截图随原 docs Commit 移植，覆盖 PC、D10、D2、mobile、中文、英文和越南语；它们是源 Commit 的既有证据，不宣称为本轮重新拍摄。
- Impeccable detector：仅 1 个 `Inter` 字体 P3 warning；无 P0/P1。为保持人工验收 UI 不做视觉改写。

## 7. PM2、uploads 与 Cashier release 加固

新增受控部署合同：

- API cwd：`/opt/HuayueLife-MVP/apps/api`
- API exec：`/opt/HuayueLife-MVP/apps/api/dist/src/main.js`
- uploads：`/opt/HuayueLife-MVP/apps/api/uploads`
- products：`/opt/HuayueLife-MVP/apps/api/uploads/products`

`deploy/pm2/ecosystem.config.cjs` 不包含密钥；preflight 只读检查 canonical API、dist、uploads 和 products；Cashier release 明确为 static-only，不管理 API 进程、不复制后端 artifact、不写 API root。部署契约测试与 shell syntax PASS。本阶段没有修改生产 PM2。

## 8. 最终测试

| Gate | 结果 |
|---|---|
| API Prisma generate / typecheck / build | PASS |
| API 全量 Jest | 41 suites / 389 tests PASS |
| Provider + printer/LAN readiness + rule/job + checkout 定向 | 6 suites / 83 tests PASS |
| Merchant Admin typecheck / 3 scripts / build | PASS |
| Cashier typecheck / Vitest / build | 41 files / 258 tests PASS；代码零差异 |
| Android `testDebugUnitTest` | PASS |
| Deploy contract / shell syntax | PASS |
| Migration fresh / upgrade | PASS |
| `git diff --check` | PASS |

云 Provider 测试使用 mock HTTP 与测试占位凭据，不访问真实飞鹅/易联云，不读取或写入真实密钥。

## 9. Android APK Gate

```text
ANDROID_APK_GATE=READY_FOR_BUILD
```

双语 Receipt source 与 JVM 测试已通过；本阶段未构建或发布正式 APK，未替换下载页 APK/版本配置。正式 APK、签名、真机 USB/LAN 和门店纸张验收必须进入独立 Android 发布 Gate。

## 10. 已知剩余 Gate

- `CloudPrintingService` 的飞鹅/易联云请求边界与 fail-closed 已测试，但原 4 Commit 未将其接入现有 terminal-only `PrintAttemptsService` 状态机；本轮遵守禁止改写任务状态机，没有虚构已上线的云执行结果。
- `LOCAL_LAN_ESCPOS` 保留配置、RFC1918 校验和 readiness；原 4 Commit 不包含新的 Android LAN TCP executor。本 RC 不恢复服务器 Socket/TCP Legacy 路径。
- 因此 LAN、飞鹅、易联云端到端真实出纸仍是部署前独立实现/设备/密钥 Gate；USB 继续走现有 Android 执行链。
- 自动任务创建生产 Flag 不在本任务中开启。

## 11. Push 与发布边界

项目报告无法在自身 Git Commit 内容中记录该 Commit 自身的 Hash。Push 后的最终本地/远程 HEAD 和 Push 结果记录在同名交付审计报告与最终交接回复中。

本阶段禁止并且未执行生产写操作、生产 migration、PM2 重启、Merge、Tag 或部署。下一阶段必须先完成生产备份、migration preflight、PM2 canonical path 切换计划、回滚演练，以及 USB/LAN/云 Provider 联合验收；本报告不授权部署。
