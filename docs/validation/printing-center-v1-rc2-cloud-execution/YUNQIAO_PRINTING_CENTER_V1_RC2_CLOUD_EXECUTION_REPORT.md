# 云桥 Life 打印中心 V1 RC2 云打印执行验收报告

生成日期：2026-07-28（Asia/Ho_Chi_Minh）
结论：代码闭环完成；契约测试通过；真实设备未执行。

## 1. RC1 基线

- 可信 RC1 worktree：`/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc5-forward-rc1`
- RC1 分支：`release/printing-center-v1-rc5-forward-rc1`
- RC1 HEAD：`5ce3810784d6ec0fa4fefc6b43ea4690ea483f84`
- RC2 分支由该 Commit 直接建立，未再次 Cherry-pick RC1 Commit。

## 2. RC2 worktree 与分支

- Worktree：`/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc5-forward-rc2`
- 分支：`release/printing-center-v1-rc5-forward-rc2`
- 允许范围：API 云打印执行、PrintAttempt 云状态、Merchant Admin 打印记录、相关测试和本报告。

## 3. PrintAttempt 状态机

新增的 `CloudPrintExecutionStatus` 为：`PENDING`、`CLAIMED`、`SUBMITTING`、`SUBMITTED`、`ACCEPTED`、`PRINTED`、`FAILED`、`UNKNOWN`、`NOT_CONFIGURED`、`CANCELLED`。

- 厂商请求前先持久化 `SUBMITTING`。
- 厂商返回任务号后进入 `SUBMITTED`，查询确认已受理时进入 `ACCEPTED`。
- 只有厂商查询明确返回打印完成，才将 Attempt 标记 `PRINTED`、Job 标记 `SUCCEEDED`。
- 明确失败、未配置、取消和结果未知分别保留真实终态，不把“已提交”伪装成“打印成功”。
- Attempt 同时保存 server executor、稳定请求号、厂商任务号、提交/查询时间和查询次数。

## 4. USB 与 Cloud 领取隔离

- Cloud Worker 只领取 `CLOUD_FEIE`、`CLOUD_YILIAN` 且已启用打印机的任务。
- Android Connector 完成/失败接口继续限定 `USB`、`TERMINAL`、`ANDROID_USB_ESCPOS`，不能更新 server cloud Attempt。
- Cloud Attempt 使用 `SERVER_ADAPTER` 与 `FEIE_CLOUD`/`YILIAN_CLOUD`。
- USB Attempt 和 Android Connector 源码均未修改。
- `LAN` 不在 Cloud Worker 查询条件内，也没有在本阶段实现 executor。

## 5. Cloud Worker 架构

- Nest 定时 Worker，默认关闭，由服务器环境变量显式开启。
- 使用数据库查询、租约、`leaseVersion` 乐观并发控制和事务进行多实例领取；进程内锁仅防止同实例重入，不承担正确性。
- 每轮依次恢复过期提交、释放可安全重试任务、补偿现有自动打印 outbox、领取待执行 cloud job、轮询厂商任务状态。
- 批量数、轮询间隔、租约时长、厂商请求 timeout 和结果确认期限均有受控边界。
- 商家停用、打印权限关闭、打印机停用或自动规则关闭时不会执行对应自动任务。

## 6. 飞鹅执行闭环

- 按[飞鹅官方 API 文档](https://developer.de.feieyun.com/apidoc-cn.html)使用服务端表单请求、`SHA1(user + ukey + stime)` 签名、`Open_printMsg` 提交、`Open_queryOrderState` 查询任务、`Open_queryPrinterStatus` 查询设备状态。
- 提交成功只记录官方任务号与 `SUBMITTED`，查询明确为 `true` 后才记录 `PRINTED`。
- 官方 API 没有可依赖的业务幂等键，因此发送前先落 `SUBMITTING`；提交 timeout、进程中断或返回任务号后本地持久化失败均进入 `UNKNOWN`，禁止自动重复提交。
- 凭据和可选设备密钥只从服务端环境读取，不进入 Merchant Admin 或 `Printer.connectionConfig`。

## 7. 易联云执行闭环

- 按[易联云官方开放平台文档](https://doc2.10ss.net/)实现自有应用 `client_credentials` 授权、MD5 签名、并发 token 缓存、错误码 `3003` 时仅刷新一次。
- `/print/index` 使用稳定 `origin_id` 和 `idempotence=1`；厂商任务号持久化后只做状态查询，不再次提交。
- 接入官方任务状态与打印机状态查询；只有官方明确完成才进入 `PRINTED`。
- 凭据和可选设备密钥只保留在服务端环境。

## 8. 状态映射

Merchant Admin 将真实执行状态展示为：等待执行、提交中、已提交、厂商已受理、已打印、失败、结果未知、服务未配置、已取消。详情中可显示厂商任务号和最后查询时间。打印机“在线”仅来自新鲜的厂商状态证据；过期、未知或未连接不会被计为在线。

## 9. 幂等与防重复出纸

- `providerRequestId = hash(jobId + attemptNo + receiptSnapshotHash)`，同一逻辑 Attempt 稳定。
- 数据库唯一约束：`(adapter, provider_request_id)` 和 `(adapter, provider_task_id)`。
- Job 领取使用状态、租约版本和 Attempt 计数的 compare-and-set。
- 易联云额外使用官方 `origin_id` 与 `idempotence=1`。
- 飞鹅在不确定结果时停在 `UNKNOWN`，不以“重试”冒险重复出纸。
- 手工补打创建新的逻辑 Job，不复用或覆盖原 Attempt。

## 10. UNKNOWN 处理

提交网络 timeout、提交后进程/数据库异常、过期 `SUBMITTING` 租约、以及厂商超过结果确认期限均进入 `UNKNOWN`。此状态设置 `retryBlocked=true`，保留错误码和商家可理解的说明；不会伪造成功，也不会自动重投。

## 11. 安全重试

- 只对确认发生在厂商提交前、且明确可重试的失败进入 `RETRY_WAIT`，采用有上限的指数退避。
- 已取得厂商任务号时仅查询，不重新提交。
- 提交结果不确定时禁止自动重试。
- Merchant Admin 对 `UNKNOWN` 不提供普通“重试”，只允许带防重复警告的独立补打。

## 12. Merchant Admin 状态

- 打印记录页展示 Cloud Attempt 的真实状态、厂商任务号、最后查询时间和安全错误说明。
- 中、英、越文案完整覆盖新增状态和错误。
- 取消、重试、补打均使用项目内确认弹窗，含 dialog 语义、标题/描述关联、Escape 关闭和焦点返回。
- USB 测试入口继续受现有执行开关约束；Cloud 测试需 Worker 和对应 Provider 已配置；LAN 保持禁用说明。

## 13. 环境变量清单（仅名称）

- `CLOUD_PRINT_WORKER_ENABLED`
- `CLOUD_PRINT_POLL_INTERVAL_MS`
- `CLOUD_PRINT_LEASE_TIMEOUT_MS`
- `CLOUD_PRINT_MAX_BATCH`
- `CLOUD_PRINT_RESULT_TIMEOUT_MS`
- `CLOUD_PRINT_PROVIDER_TIMEOUT_MS`
- `FEIE_ENABLED`
- `FEIE_API_BASE_URL`
- `FEIE_USER`
- `FEIE_UKEY`
- `FEIE_DEVICE_KEYS_JSON`
- `YILIAN_ENABLED`
- `YILIAN_API_BASE_URL`
- `YILIAN_CLIENT_ID`
- `YILIAN_CLIENT_SECRET`
- `YILIAN_DEVICE_KEYS_JSON`

本报告不记录任何变量值、Token、密码或设备密钥。

## 14. 全部测试

- API Prisma generate：PASS。
- API typecheck：PASS。
- API 全量 Jest：PASS，43 suites / 423 tests。
- API build：PASS。
- 打印定向测试：PASS，21 suites / 247 tests。
- Cloud Worker、Provider、任务领取、整桌结账与抹零核心测试：PASS，6 suites / 93 tests。
- 513,000 原金额、3,000 抹零、510,000 实收双语结账快照：PASS。
- Migration fresh DB：PASS；本地隔离 MySQL 8.4 上 22 个 migration 首次执行成功，再执行无待处理 migration。
- Migration upgrade DB：PASS；RC1 的 21 个 migration 后仅执行 RC2 新 migration，再执行无待处理 migration。
- Merchant Admin typecheck：PASS。
- Merchant Admin test：PASS，4 个脚本（含 cloud 状态、i18n 与打印记录映射）。
- Merchant Admin build：PASS；仅保留既有 Vite chunk warning。
- Impeccable：完成 context、audit、harden 与一次 detector；唯一 `Inter` 字体提示为 RC1 已有定义，无新增阻塞。
- Cashier typecheck / lint / test / build：PASS；41 test files / 258 tests。
- Android `:app:testDebugUnitTest`：PASS，109 tests，0 failures，0 errors，1 skipped；未构建 APK。
- Deployment runtime contract：PASS。
- `git diff --check`：PASS。
- 密钥扫描：未发现私钥、GitHub Token、带凭据 URL 或新增非空云厂商密钥。

## 15. RC2 Commit 列表

- `d523e46867a76cf3487816f57d9d32a83849fb5d` — `feat(printing): execute cloud print jobs server-side`
- `9d4ee7a87d0ad6e1f28dc459a8848b57ac74700c` — `test(printing): cover cloud execution contracts`
- `1b630dabfd1875b83a9156a4c6db598124508ea2` — `feat(merchant-admin): show real cloud print states`
- `e2abceefe689c15317421278eaa636a07cccf534` — `docs(printing): add RC2 cloud execution validation`
- Push 结果回填 Commit 即包含本文件的最终报告同步 Commit；为避免文件自引用，其精确 Hash 以远程分支 HEAD、交付目录报告和最终回复为准。

## 16. Push 结果

- 结果：PASS。
- 目标仓库：`git@github-peter001:peten001/HuayueLife-MVP.git`
- 目标分支：`release/printing-center-v1-rc5-forward-rc2`
- 首次普通 Push：成功，远程已接收 `e2abceefe689c15317421278eaa636a07cccf534`。
- 本 Push 结果回填随报告同步 Commit 使用普通 fast-forward Push 送达同一 RC2 分支；最终远程 HEAD 在 Push 后通过 `git ls-remote` 验证。
- 未修改 origin，未 Force Push，未 Push main。

## 17. 真实凭据与设备 Gate

- 飞鹅真实凭据：未提供，未执行真实请求。
- 易联云真实凭据：未提供，未执行真实请求。
- 飞鹅真实设备出纸：真实设备未执行。
- 易联云真实设备出纸：真实设备未执行。
- 结论仅为“代码闭环完成、官方契约测试通过”，不宣称真实出纸成功。

## 18. 下一阶段 Android RC APK 计划

下一阶段需在独立授权下构建 Android RC APK，并以真实商家、真实设备、真实订单和真实小票联合验收 USB 与 Cloud 的跨端记录一致性。本阶段未构建、签名或发布 APK，也未修改 Android USB Connector。

## 19. LAN 边界

本阶段未开发 LAN executor，未开发 Windows 打印助手，也未把 LAN 标记为可执行能力。

## 20. 未修改范围

相对 RC1，`apps/merchant-cashier`、`apps/miniapp`、`apps/merchant-terminal-android` 源码零差异。未修改 Android USB Connector、USB renderer、Cashier 或 Miniapp。

## 21. 禁止操作确认

未连接、读取或写入生产数据库；未执行生产 migration、生产构建、PM2/Nginx 操作或部署；未 Merge、Rebase、Tag 或 Force Push；未 Push main。
