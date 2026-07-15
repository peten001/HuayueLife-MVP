# 云桥商家终端 USB RC V1｜阶段 A 现状与生产部署审计

> 审计时间：2026-07-15（Asia/Ho_Chi_Minh）
> 审计基线分支：`feature/merchant-terminal-usb-rc-v1`
> 审计基线 Commit：`9c7b947efda814da857ccb81067f4e79457b89a9`（`feat: add android usb printer smoke test`）
> 审计性质：只读仓库与公开生产入口检查；未读取敏感配置值，未连接生产数据库，未修改服务器，未执行 migration、部署或 push。

## 1. 审计口径与 Gate 结论

开始审计时工作区为干净状态，分支和 Commit 符合 RC 总指令预期。本文将事实固定在上述 Commit；同一开发分支在阶段 A 之后产生的未提交或后续实现不作为本审计的基线事实。

| Gate | 结论 | 依据 |
|---|---|---|
| 仓库现状审计 | **PASS** | API、merchant-admin、merchant-cashier、Android、Prisma、部署文档、环境变量模板和公开生产入口均已检查 |
| 隔离 migration 验证 | **PASS** | 15 个 migration 在一次性 MySQL 8.4 环境全部执行成功，二次 deploy 无待执行项；见 `docs/printing-v1/10_ISOLATED_MIGRATION_VALIDATION.md` |
| 继续完成本地代码与部署包 | **允许** | 可在不触碰生产状态、且所有打印开关保持关闭的前提下继续 |
| 正式 Web 收银台部署 | **BLOCKED** | 候选收银台域名当前没有 DNS 记录，仓库没有真实 Nginx 站点配置、服务器静态目录或部署命令 |
| 生产数据库备份 | **BLOCKED** | 只有通用 `mysqldump` 示例；没有已授权备份身份、目标路径、空间、校验值或恢复演练证据 |
| 生产 migration | **BLOCKED** | 无法只读确认生产 `_prisma_migrations`，且备份 Gate 未通过 |
| 打印任务中心生产部署 | **BLOCKED** | 公开生产 API 的新打印接口仍返回 404；生产运行时 Feature Flag 值未知 |
| 正式签名 Release APK | **BLOCKED** | 签名配置入口已存在，但未发现正式 keystore 或已配置的本机签名变量 |

**阶段 A 的安全结论：目前不得执行生产备份、migration、API/后台/收银台部署。** 后续可以完成代码、自动测试、未签名或诊断构建以及部署包；只有本文件列出的生产条件得到明确补充后，才能重新打开生产 Gate。

## 2. 正式域名与公开生产状态

### 2.1 仓库证据

- 独立 Web 收银台明确记录“仓库尚未确认独立收银台的正式页面 Origin”，不得猜测或硬编码：`apps/merchant-cashier/README.md:44`。
- 收银台生产 API 默认值为 `https://api.huayueyouxuan.com/api/v1`，完整商家后台地址为 `https://admin.huayueyouxuan.com/`：`apps/merchant-cashier/src/config/index.ts:1-17`、`apps/merchant-cashier/.env.example:1-4`。
- Android debug/release 的 Web URL 和精确 Origin 在基线中都回退到安全占位域 `cashier.invalid`，资源 Host 默认为空：`apps/merchant-terminal-android/app/build.gradle.kts:37-66`。
- RC 总指令建议优先使用 `https://cashier.huayueyouxuan.com/`，但该建议本身不是已部署证据。

### 2.2 2026-07-15 公开只读检查

| 检查 | 实际结果 | 结论 |
|---|---|---|
| `cashier.huayueyouxuan.com` DNS A/CNAME | 无返回，HTTPS 请求无法解析 Host | **正式收银台尚不能使用该域名发布** |
| `https://admin.huayueyouxuan.com/` | HTTPS 200，服务端标识 Nginx，返回当前商家后台 SPA | 现有商家后台在线 |
| `https://api.huayueyouxuan.com/api/v1/health` | HTTPS 200，服务名 `huayue-life-mvp-api`，版本字段 `1.0.0` | 现有 API 在线；版本字段未包含 Git Commit，不能据此证明具体部署 Commit |
| `GET /api/v1/merchant/printing/feature-state`（无 Token） | 404，而不是鉴权 401 | 新打印任务中心 Controller 尚未部署到公开生产 API |
| `GET /api/v1/merchant/printing/printers`（无 Token） | 404 | 同上 |
| `GET /api/v1/merchant/printers`（无 Token） | 401 `Missing bearer token` | 旧打印路由仍存在于公开生产 API |
| 线上 merchant-admin 主 bundle | 包含旧 `merchant/printers` 路由字符串，未发现 `merchant/printing` 或打印中心标识 | 线上后台不是当前打印中心 Beta/cutover 构建 |

以上未认证请求没有携带账号、Token、Cookie 或业务数据，也没有触发任何写操作。

### 2.3 HTTPS、CORS 与安全头风险

- `admin` 和 `api` 的 TLS 校验通过；候选 `cashier` 域名尚无 DNS，因此无法进行证书验证。
- 基线 API 使用 `origin: true` 与 `credentials: true`：`apps/api/src/main.ts:26-29`。
- 对公开生产 API 的无状态预检抽样显示，候选收银台 Origin 与一个非云桥测试 Origin 都会被原样允许，并返回 `Access-Control-Allow-Credentials: true`。正式收银台上线前必须改为明确 Origin 白名单并完成回归。
- 本次抽样的 `admin` 首页和 API health 响应未返回 HSTS 或 CSP 头。是否由其他路径或上游统一注入不能从仓库证明；正式收银台 Nginx 配置必须明确 TLS、HSTS、CSP、缓存和 SPA fallback，而不能依赖推测。

## 3. Web 收银台部署准备度

### 3.1 已具备

- 独立 Vue 3/Vite SPA，生产构建输出为 `apps/merchant-cashier/dist/`：`apps/merchant-cashier/README.md:105-127`。
- Vue Router 使用 history 模式，生产静态站点必须配置未命中路径回退 `index.html`：`apps/merchant-cashier/src/router/index.ts:12-63`。
- 默认 Fixture 为关闭；真实 API 与 merchant-admin URL 均有公开构建变量入口：`apps/merchant-cashier/.env.example:1-4`。
- 真实登录、订单、桌台和 TableSession 的人工读写验收已经记录：`docs/testing/merchant-cashier-v1-real-write-validation.md`。
- Web 收银台当前仍只显示“打印待接入”，打印桌账按钮禁用，未调用 PrintJob：`apps/merchant-cashier/src/components/bills/TableBillDetail.vue`、`apps/merchant-cashier/src/components/shell/CashierHeader.vue`。

### 3.2 未具备/未确认

- 没有正式收银台 DNS、TLS 证书或已确认 Origin。
- 仓库没有 cashier 对应的 Nginx server block、静态目录、发布脚本、健康检查文件、缓存策略或回滚目录。
- 未确认生产服务器部署用户、SSH 入口、项目工作目录、静态根目录和原子发布方式。
- 未确认 API 的正式 CORS 白名单；当前实现和线上行为均为反射任意 Origin。
- Android 基线不能加载真实收银台：release 配置仍为 `.invalid`。

**结论：Web 收银台代码具备生产构建基础，但没有可安全执行的生产部署目标。**

## 4. API、Prisma 与打印任务中心现状

### 4.1 数据模型与 migration

基线包含 migration：

```text
apps/api/prisma/migrations/20260715000000_add_printing_task_center_v1/migration.sql
```

它只新增以下 7 张表以及相关索引/外键，不删除旧 `printer_settings` 或 `print_logs`：

- `printers`
- `receipt_templates`
- `print_rules`
- `print_jobs`
- `print_attempts`
- `merchant_terminals`
- `printing_audit_logs`

隔离验证确认 25 个显式索引、18 个外键、dedupe 唯一约束、Attempt 序号唯一约束与删除策略有效：`docs/printing-v1/10_ISOLATED_MIGRATION_VALIDATION.md:163-238`。

已知数据库边界：数据库外键不能独立保证带 `merchant_id` 的关联资源属于同一商家；隔离 SQL 已证明跨商家 Rule/Job 可直接引用其他商家的 Printer。当前依赖 Service 层商家范围校验：`docs/printing-v1/10_ISOLATED_MIGRATION_VALIDATION.md:240-260`。

### 4.2 已存在的管理能力

- 新管理命名空间为 `/merchant/printing`，使用普通商家 JWT 与角色 Guard：`apps/api/src/modules/printing/controllers/merchant-printing.controller.ts:42-57`。
- 管理 API 已覆盖 Printer、ReceiptTemplate、PrintRule、PrintJob 查询/取消/重试和 MerchantTerminal 基础管理：`apps/api/src/modules/printing/controllers/merchant-printing.controller.ts:60-332`。
- merchant-admin 已有“打印中心 Beta”路由和 Printer、Rule、Template、Job、Terminal 五个页面；仅 OWNER/MANAGER 可见：`apps/merchant-admin/src/router/index.ts:149-165`、`apps/merchant-admin/src/layouts/MerchantLayout.vue:25-50`。
- 旧 URL 会根据服务端状态安全重定向；状态请求失败时 fail closed，隐藏旧入口：`apps/merchant-admin/src/utils/printing-feature-state.ts:4-55`。
- 打印机管理页在本审计基线中仍默认选择 `LOCAL_LAN_ESCPOS`，只有 LAN 配置被当作已实现，USB 显示为“未实现通道”：`apps/merchant-admin/src/pages/printing/PrintingPrintersPage.vue:28-64,101-113,162-167`。这与 RC 已确认的“USB 优先”方向不一致，后续实现必须修正，不能把该页面视为 USB 已可配置。
- 线上尚未部署上述 API 和页面，见第 2 节公开证据。

### 4.3 已有但尚未对 Connector 暴露的内部能力

- `PrintJobsService` 内部已有自动任务、人工补打、测试任务、原子条件领取、租约和过期恢复方法：`apps/api/src/modules/printing/services/print-jobs.service.ts:150-580`。
- `PrintAttemptsService` 内部已有开始、成功、失败、结果不确定和延长租约逻辑：`apps/api/src/modules/printing/services/print-attempts.service.ts:48-273`。
- 当前 Controller 测试明确要求不暴露 claim、mark-printing、succeed、fail、extend-lease、heartbeat 等 Connector 路由：`apps/api/src/modules/printing/controllers/merchant-printing.controller.spec.ts:36-80`。
- `MerchantTerminal` 当前只能由网页登录员工手工创建为 `UNPAIRED` 记录；没有一次性绑定码、独立终端 Token、Token Hash、终端 Guard 或心跳：`apps/api/src/modules/printing/services/terminals.service.ts:20-61`。
- 自动创建方法没有业务调用方；基线全仓调用只出现在该 Service 和单元测试中。Web 收银台也没有 PrintJob API。

因此，基线不能被描述为“生产执行端已接入”；它只是管理域和内部可靠性原语。

## 5. Feature Flag 与旧打印切换

| Flag | 代码/模板安全默认 | 生产运行值 |
|---|---:|---|
| `PRINTING_TASK_CENTER_ENABLED` | `true` | **未知**；公开生产 API 尚无该模块路由 |
| `PRINTING_AUTO_CREATE_ENABLED` | `false` | **未知** |
| `PRINTING_EXECUTION_ENABLED` | `false` | **未知** |
| `LEGACY_PRINTING_ENABLED` | `false` | **未知**；公开生产仍存在旧路由，但不能仅凭路由存在判断实际自动直打开关 |

证据：

- 严格布尔解析、安全默认和双路径阻断：`apps/api/src/modules/printing/services/printing-feature-flags.service.ts:24-118`。
- 生产模板明确写出上述安全默认：`apps/api/.env.production.example:14-19`。
- 本机存在 Git 忽略的 `apps/api/.env`，只审计了变量名，未读取值；该文件包含常规 API/数据库/JWT/微信/seed 变量，但没有上述四个打印 Flag。它不能证明生产配置。
- 当前线上 API 明显早于任务中心/cutover 代码，因此不能依赖新分支中的默认值推断线上旧直打已关闭。

**生产部署前必须在实际运行环境显式写入四个 Flag，并在重启后的认证接口和启动日志中复核。不得通过默认回退猜测生产状态。**

## 6. Android 商家终端基线

### 6.1 已具备

- 正式 applicationId/namespace：`com.yunqiao.life.merchantterminal`；debug 使用 `.debug` 后缀：`apps/merchant-terminal-android/app/build.gradle.kts:106-151`。
- 基线版本为 `versionCode=3`、`versionName=0.2.0-usb-smoke`：`apps/merchant-terminal-android/app/build.gradle.kts:16-32`。
- WebView 外壳具备精确 Origin 白名单、HTTPS、Cookie/localStorage 登录保持、横屏、全屏、常亮、返回键、网络错误页和诊断能力：`apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/`。
- 通用 USB 枚举、用户授权、Printer Class/BULK OUT 候选、手动接口/端点选择、分块写入和 ESC/POS Bitmap Smoke Test 已实现；没有写死设备型号、打印机型号或 VID/PID：`apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/printing/`。
- 基线只申请 `INTERNET` 与 `ACCESS_NETWORK_STATE`，USB Host 为非必需特性：`apps/merchant-terminal-android/app/src/main/AndroidManifest.xml:1-10`。

### 6.2 基线尚不存在

- 真实 Web 收银台 URL（仍为 `.invalid`）。
- 一次性终端绑定和独立终端认证。
- Connector API 客户端。
- Room 本地 PrintJob/Attempt 台账。
- Foreground Service、BootReceiver 与 WorkManager。
- 服务器 PrintJob 领取、真实订单打印、补打、自动打印和恢复。
- 远程诊断/停用终端。
- 真实 USB 硬件验证结果；VID/PID、接口、端点、纸宽、阈值、切纸能力和中越文实物效果都未知。

### 6.3 正式签名状态

- Gradle 已支持通过本机属性或 `YUNQIAO_RELEASE_*` 环境变量提供 store file、store password、alias 和 key password，并拒绝部分配置：`apps/merchant-terminal-android/app/build.gradle.kts:73-104`。
- 仓库和 Desktop 可审计范围内未发现 `.jks`、`.keystore`、`.p12` 或 `.pfx` 文件；Git 也没有跟踪密钥材料。
- 当前进程未配置四个 `YUNQIAO_RELEASE_*` 变量；项目 `local.properties` 和用户级 Gradle properties 均不存在。
- 因此当前只能生成 debug 或未签名 release；不能声称存在可持续升级的正式签名链。

## 7. 部署方式、路径、CI/CD 与环境配置

### 7.1 仓库实际存在

- API 构建/启动入口：`nest build` 后运行 `node dist/src/main.js`：`apps/api/package.json:7-18`。
- 通用部署文档建议 Nginx 代理 API 到本机 3001，并用 systemd、Docker 或“其他进程管理器”托管，但没有选定一种真实方式：`docs/DEPLOYMENT.md:36-50,76-98`。
- 根 `docker-compose.yml` 只提供本地 MySQL/Redis，不包含 API、merchant-admin 或 cashier 服务；其中默认账号/密码仅适合本地开发：`docker-compose.yml:1-29`。
- Git remote 只说明源码远端，不提供生产部署映射；本轮未修改 remote。

### 7.2 仓库不存在/无法确认

- 无 Nginx 配置文件。
- 无 PM2 ecosystem 配置。
- 无 API/Web Dockerfile 或生产 Compose。
- 无 systemd unit。
- 无 GitHub Actions/其他 CI/CD 工作流。
- 无服务器部署脚本、发布目录、软链接切换或回滚脚本。
- 无生产服务器登录用户、SSH alias、工作目录、静态站点根目录、进程名和安全重启命令。
- 无可证明当前线上部署 Commit 的版本端点；API 只返回包版本 `1.0.0`。

结论：可以生成构建产物，但**不能从仓库安全推导上传到哪里、由谁执行、如何原子切换和如何回滚**。

### 7.3 本机敏感环境文件审计边界

本机存在 Git 忽略的 `apps/api/.env`。本轮只读取了变量名，未读取、打印或复制任何值。变量名为：

```text
NODE_ENV
PORT
DATABASE_URL
JWT_SECRET
JWT_EXPIRES_IN
WECHAT_APP_ID
WECHAT_APP_SECRET
MINIAPP_QR_ENTRY_URL
SEED_MERCHANT_PASSWORD
SUPER_ADMIN_USERNAME
SUPER_ADMIN_PASSWORD_HASH
```

该文件没有四个打印 Feature Flag 变量。文件来源、目标环境与数据库归属均未确认，因此不得将它作为生产部署或备份凭据来源。

## 8. 生产数据库与备份条件

### 8.1 已有文档能力

- 数据库是 MySQL 8，Prisma datasource 使用 `DATABASE_URL`：`apps/api/prisma/schema.prisma:1-8`。
- `docs/DEPLOYMENT.md:99-129` 提供了 `mysqldump --single-transaction --routines --triggers` 的通用示例和恢复到新库的示例。
- `docs/PRODUCTION-CONFIG-CHECKLIST.md:12-23` 要求 migration 前备份和在非生产库验证恢复。

### 8.2 缺失的生产执行条件

本轮没有读取任何敏感值。仓库与当前安全上下文不能确认：

- 哪个数据库实例和数据库名是当前生产事实来源。
- 经授权的备份账号/凭据来自何处，以及是否具有 routines/triggers 所需权限。
- 备份在服务器还是受控运维机执行。
- 加密备份目标目录、剩余空间、访问权限和保留期限。
- 备份文件校验值、远端副本和恢复验证数据库。
- 生产维护窗口、负责人、失败判据和恢复授权。
- 生产 `_prisma_migrations` 当前具体状态。
- 旧 `printer_settings`、`print_logs` 的生产数据量和是否仍被真实使用。

忽略的 `apps/api/.env` 中存在 `DATABASE_URL` 变量名，但值未读取，也没有证据证明该文件属于生产。它不能替代上述条件。

### 8.3 生产 migration 的安全前置清单

只有以下项目全部得到明确值与授权后才允许执行：

1. 明确目标服务器、生产数据库标识和只读预检方式（报告中仍不得写完整 URL）。
2. 明确备份身份、秘密注入方式和脱敏命令；禁止把密码放入命令历史、日志或文档。
3. 完成一致性备份，记录文件大小、SHA-256、开始/结束时间和受控保存位置。
4. 在独立恢复库实际恢复并检查核心表数量，而不只是确认 dump 命令退出 0。
5. 只读检查生产 `_prisma_migrations` 与旧打印数据量。
6. 确认 migration SHA-256 与隔离验证文件一致。
7. 显式设置四个打印 Flag 的安全值并准备不恢复旧直打的应用回滚方案。
8. 执行 `prisma migrate deploy` 后验证 7 张表、索引、外键、API health 和旧订单流程。

在此之前，不得用本机被忽略的环境文件尝试连接生产，也不得执行 migration。

## 9. 版本与发布物审计

| 组件 | 基线版本 | 生产/发布状态 |
|---|---|---|
| 根 workspace | `1.0.0` | 源码版本，不是可核验部署 Commit |
| API | `1.0.0` | 生产 health 同样返回 `1.0.0`，但新 printing 路由 404 |
| merchant-admin | `1.0.0` | 生产在线，但 bundle 是旧打印入口版本 |
| merchant-cashier | `0.1.0` | 代码完成并验收，正式 Origin/DNS/部署缺失 |
| Android | `0.2.0-usb-smoke` / code 3 | debug Smoke APK 曾生成；正式 RC 版本和正式签名尚未完成 |

仓库当前分支比 `origin/main` 存在大量本地后续提交；这只能说明 Git 历史差异，不能证明生产部署分支或生产 Commit。不得仅依据 `origin/main` 猜测线上版本。

## 10. RC 阻塞项与所需明确输入

### P0：阻止任何生产 mutation

1. **收银台域名**：确认是否正式使用 `cashier.huayueyouxuan.com`，并完成 DNS、TLS 证书与 Nginx 站点准备。
2. **部署目标**：提供或确认服务器、受控登录方式、API 进程管理方式、API 工作目录、admin/cashier 静态目录、重启和回滚命令。
3. **生产备份**：确认备份身份、秘密注入方式、备份目录/对象存储、空间、加密、校验和恢复验证流程。
4. **生产数据库授权**：明确只读预检与 migration 执行身份；未完成备份前不得授权 migration。
5. **生产 Flag**：明确实际运行环境的四个打印开关，并保证旧直打、新自动创建和执行均关闭。

### P1：阻止正式 Release APK

6. **正式签名链**：确定由谁生成/保管正式 keystore、alias、密码管理位置及至少两个安全备份位置；密钥不得进入 Git 或部署日志。
7. **真实 Web/资源白名单**：收银台发布后确认精确 Origin，以及 API/媒体 Host；Android release 不得保留 `.invalid` 或通配 Host。
8. **版本策略**：确认 RC 使用 `1.0.0-rc1` 与新的递增 versionCode，并记录证书 SHA-256。

### P2：不阻止代码开发，但阻止上线启用

9. 真实 USB 打印机仍未验证，所有 Printer、Terminal、PrintRule 与商家级总开关必须保持关闭/未配对。
10. 现场前不得创建真实 PrintJob，不得恢复旧服务器 Socket/TCP 直打。

## 11. 阶段 A 最终决定

- 现状审计已完成。
- 隔离 migration Gate 已通过。
- **生产部署、生产备份和生产 migration Gate 未通过。**
- 可以继续完成终端配对、Connector API、Android USB 正式连接器、Room、Foreground Service、恢复、Web 手动/自动任务代码、测试、部署包与上线文档。
- 在缺少生产部署路径、备份条件、正式收银台域名和正式签名材料时，只能交付“待授权部署”的 RC 包，不能声称生产已上线。
- 到店前必须保持：旧直打关闭、新自动创建关闭、新执行关闭、Printer disabled、PrintRule autoPrint false、Terminal 未配对或 disabled。

## 12. 审计后 RC 修复状态（2026-07-15）

本节是基线审计后的追加记录，不改写 `9c7b947` 当时的事实。当前开发分支已完成但尚未部署的内容包括：

- 新增 RC connector migration；共 16 个 migration 已在一次性 MySQL 8.4 空库完整执行并二次验证，RC migration SHA-256 为 `5f793a646b82fd64da68be7cac682a43081913c7ef209007c15471e36ad47b23`。
- API 已实现一次性绑定、独立终端凭据、claim/lease/Attempt、结果回报、durable automatic-trigger outbox、商家/Printer/Terminal/Rule 多重关闭门和远程诊断；单元测试与构建通过。
- CORS 源码已由任意 Origin 反射改为精确白名单；候选 cashier Origin 只可在 DNS/TLS 验证后由生产配置显式加入。线上 API 尚未部署该修改。
- merchant-cashier 已接入真实 PrintJob 手动打印/补打入口，但只有所有安全 Gate 均可用时才启用；Fixture 不会打印。
- merchant-admin 已具备 USB Printer、规则、模板、任务、终端配对/停用/撤销/重置和总开关管理；旧服务器局域网直打继续关闭。
- Android 已从 USB smoke 外壳扩展为 RC1：WebView、终端认证、Room、本地防重复、Foreground Service、BootReceiver、WorkManager 补报、通用 USB BULK OUT、Bitmap/QR 小票和不确定结果保护；真实硬件仍为 NOT TESTED。
- 长期 release JKS 已在 Git 外生成并固定证书 SHA-256；两份加密离线灾备尚未完成，因此首次门店安装 Gate 仍阻断。

以上均为“本地代码/部署包准备”，不是生产完成状态。收银台 DNS/TLS、生产备份、生产 migration、API/admin/Web 部署和真实 USB 验证仍未完成，原 P0 阻断结论继续有效。
