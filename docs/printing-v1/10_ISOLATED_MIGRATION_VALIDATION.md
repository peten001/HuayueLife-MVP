# 打印任务中心 V1 隔离 Migration 验证报告

> 文档性质：阶段 A 的实际执行与验收记录。
> 验证日期：2026-07-15。
> 验证结论：**Gate A PASS（包含已记录的数据库租户范围约束边界）**。
> 安全声明：本次只连接本机回环地址上的一次性 MySQL 容器；未连接生产或其他外部数据库，未执行生产 migration。

## 1. 验证目标与范围

本次验证针对仓库中的全部 Prisma migration，重点验证打印任务中心 V1 migration：

```text
apps/api/prisma/migrations/20260715000000_add_printing_task_center_v1/migration.sql
```

验证范围包括：

- 在全新空数据库按顺序应用全部历史 migration。
- 再次执行 deploy，确认 Prisma migration 状态幂等。
- 执行 Prisma schema validate 和 client generate。
- 核对打印任务中心新增表、索引和外键。
- 以一次性虚构数据验证唯一索引、外键和删除策略。
- 验证停用 Printer 不会删除历史 PrintJob 或 PrintAttempt。
- 验证 Printing 模块现有商家范围保护测试。
- 销毁隔离容器、独立 volume 和临时 Prisma 副本。

本次不包含：生产数据库连接、生产 migration、真实商家数据、真实打印任务执行、打印机连接、部署或 push。

## 2. 数据库类型修正与隔离方式

### 2.1 数据库类型事实

主任务说明中曾建议临时 PostgreSQL，但当前项目并非 PostgreSQL：

- `apps/api/prisma/schema.prisma` 的 datasource provider 为 `mysql`。
- `apps/api/prisma/migrations/migration_lock.toml` 的 provider 为 `mysql`。
- migration 使用 MySQL 的反引号、内联 `ENUM`、`JSON`、`DATETIME(3)` 和 MySQL 索引语法。

因此，本次使用 MySQL 隔离环境。使用 PostgreSQL 无法验证这组真实 migration，不能把 PostgreSQL 测试结果作为 Gate A 依据。

### 2.2 实际隔离环境

| 项目 | 实际值 |
|---|---|
| Docker 镜像 | 官方 `mysql:8.4` |
| 镜像 digest | `sha256:c831a0f11348d402b43d77453e17d770be2eef356615a2823fe0f5a0d6c8b9af` |
| 数据库版本 | MySQL 8.4.10 |
| 临时数据库名 | `printing_migration_test` |
| 容器名 | `yunqiao-printing-migration-test` |
| 独立 volume | `yunqiao_printing_migration_test` |
| Host 监听 | `127.0.0.1:23306` |
| 容器端口 | `3306` |
| 网络暴露范围 | 仅本机 loopback，不监听局域网或公网接口 |

隔离措施：

1. 使用全新空数据库和本轮专用 volume，不复用仓库 `docker-compose.yml` 的开发数据卷。
2. Host 端口只绑定 `127.0.0.1`，且不使用项目默认 MySQL 端口。
3. 容器使用 MySQL 官方镜像的 `MYSQL_ALLOW_EMPTY_PASSWORD=yes`，只允许本机回环地址访问；该做法只用于本轮一次性隔离数据库，不得用于共享、测试服务器或生产环境。
4. Prisma 执行时显式注入仅指向本机隔离容器的 `DATABASE_URL`，不使用生产 URL。
5. schema、migrations 和生成依赖准备在临时目录完成，避免把隔离验证指向外部数据库。
6. 验证结束后删除容器、独立 volume 和全部临时副本。

## 3. 安全命令模板

以下为本次流程的脱敏等价模板，用于复现执行顺序。`<...>` 表示临时值；不得替换为生产凭据或生产 URL，也不得开启 shell trace。

```bash
# 1. 创建独立 volume，并只在 loopback 暴露临时端口。
docker volume create yunqiao_printing_migration_test
docker run -d \
  --name yunqiao-printing-migration-test \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=yes \
  -e MYSQL_DATABASE=printing_migration_test \
  -p 127.0.0.1:23306:3306 \
  -v yunqiao_printing_migration_test:/var/lib/mysql \
  mysql@sha256:c831a0f11348d402b43d77453e17d770be2eef356615a2823fe0f5a0d6c8b9af

# 2. 将 schema 与 migrations 复制到本机临时目录，并在进程内构造：
# ISOLATED_DATABASE_URL=<仅指向 127.0.0.1:23306/printing_migration_test 的临时 URL>
# 该 URL 不含生产凭据；不要在共享环境使用空密码模式。

# 3. 首次和第二次应用 migration。
env DATABASE_URL="$ISOLATED_DATABASE_URL" \
  <Prisma-5.22-CLI> migrate deploy --schema <临时目录>/prisma/schema.prisma
env DATABASE_URL="$ISOLATED_DATABASE_URL" \
  <Prisma-5.22-CLI> migrate deploy --schema <临时目录>/prisma/schema.prisma

# 4. 校验 schema，并在临时 package/node_modules 准备完成后生成 Client。
env DATABASE_URL="$ISOLATED_DATABASE_URL" \
  <Prisma-5.22-CLI> validate --schema <临时目录>/prisma/schema.prisma
env DATABASE_URL="$ISOLATED_DATABASE_URL" \
  <Prisma-5.22-CLI> generate --schema <临时目录>/prisma/schema.prisma

# 5. Printing 模块单元测试（不连接真实打印机）。
corepack pnpm --filter @huayue-life/api exec \
  jest src/modules/printing --runInBand

# 6. 无论成功或失败都销毁隔离资源。
docker rm -f yunqiao-printing-migration-test
docker volume rm yunqiao_printing_migration_test
rm -rf <临时Prisma目录>
```

执行约束 SQL 时使用容器内 MySQL client。隔离数据库没有生产密码、账号或数据，也没有把任何生产连接信息保存到仓库。

## 4. 全部 Migration 执行结果

首次 `prisma migrate deploy` 从全新空数据库执行了以下 15 个 migration，全部成功：

| 顺序 | Migration | 结果 |
|---:|---|---|
| 1 | `20260610000000_init` | PASS |
| 2 | `20260611000000_add_order_idempotency` | PASS |
| 3 | `20260611010000_backfill_category_product_name_vi` | PASS |
| 4 | `20260612093000_add_platform_admin_and_password_flags` | PASS |
| 5 | `20260618090000_add_merchant_homepage_categories` | PASS |
| 6 | `20260622000000_add_order_chat` | PASS |
| 7 | `20260623000000_add_printer_settings_and_print_logs` | PASS |
| 8 | `20260627000000_add_merchant_client_visibility` | PASS |
| 9 | `20260628120000_add_merchant_daily_reports` | PASS |
| 10 | `20260629000000_add_merchant_platform_model` | PASS |
| 11 | `20260629010000_refine_merchant_platform_model` | PASS |
| 12 | `20260629020000_reconcile_daily_report_columns` | PASS |
| 13 | `20260702000000_add_table_sessions` | PASS |
| 14 | `20260710000000_add_platform_settings` | PASS |
| 15 | `20260715000000_add_printing_task_center_v1` | PASS |

第二次执行同一 `migrate deploy`：

```text
No pending migrations
```

Prisma migration 元数据核对：

| 检查项 | 实际值 | 结果 |
|---|---:|---|
| `_prisma_migrations` 总数 | 15 | PASS |
| 未完成 migration | 0 | PASS |
| rolled back migration | 0 | PASS |
| 打印任务中心 migration | 已完成 | PASS |

打印任务中心 migration 文件 SHA-256 为：

```text
f84457f2690455cc8208a05900748ef7af54fe2a756facc0103506292e52c4a1
```

静态复核还确认：从引入打印任务中心前的 Prisma schema 到当前 schema 生成的 MySQL diff，在移除注释、空行和纯格式差异后，与该 migration 一致。

## 5. Prisma Validate 与 Generate

| 检查 | 结果 | 说明 |
|---|---|---|
| Prisma CLI 版本 | 5.22.0 | 与项目依赖一致 |
| `prisma validate` | PASS | 临时 schema 验证成功 |
| 首次 `prisma generate` | 工具准备失败 | 临时目录尚无 `package.json` 和可发现的 `node_modules/@prisma/client`；不是 schema、migration 或数据库错误 |
| 补齐临时 package 和指向现有已安装依赖的链接后再次 generate | PASS | Prisma Client 5.22.0 成功生成 |

首次 generate 的失败没有被隐藏或改写为通过。它发生在 Client generator 查找项目依赖的准备阶段；补充临时 package 元数据和指向 `apps/api/node_modules` 中现有已安装依赖的链接后，使用同一份 schema 生成成功。生成器可能更新 Git 已忽略的已安装依赖缓存，但没有新增或修改 `package.json`、lockfile 或任何 tracked 依赖清单。

## 6. 打印任务中心新增数据库对象

打印任务中心 migration 是增量 migration。旧 `printer_settings`、`print_logs` 及其数据结构没有被删除或回填。

### 6.1 新增表

| 表 | 用途 | 核对结果 |
|---|---|---|
| `printers` | 通道无关打印机配置 | PASS |
| `receipt_templates` | 版本化票据模板 | PASS |
| `print_rules` | 打印触发与目标规则 | PASS |
| `print_jobs` | 打印意图和任务事实来源 | PASS |
| `print_attempts` | 每次执行尝试记录 | PASS |
| `merchant_terminals` | 商家终端基础记录 | PASS |
| `printing_audit_logs` | 配置和任务操作审计 | PASS |

新增表总数：7。

MySQL 的 `ENUM` 定义在对应列上，不是独立 enum 对象；实际列定义与 migration 中的通道、状态、票据类型、触发事件、来源、执行者和终端枚举一致。

### 6.2 显式索引

以下清单不包含每张表自身的 `PRIMARY`，共 25 个显式普通或唯一索引：

| 表 | 索引 |
|---|---|
| `printers` | `ix_printer_merchant_enabled`、`ix_printer_merchant_channel`、`ix_printer_merchant_deleted` |
| `receipt_templates` | `ix_rt_merchant_type_enabled`、`uq_receipt_template_version`（UNIQUE） |
| `print_rules` | `ix_pr_merchant_enabled_event`、`ix_pr_printer_enabled`、`ix_pr_template` |
| `print_jobs` | `uq_print_jobs_dedupe`（UNIQUE）、`ix_pj_claim`、`ix_pj_order`、`ix_pj_table_session`、`ix_pj_printer`、`ix_pj_rule`、`ix_pj_request_group`、`ix_pj_terminal_status`、`ix_pj_lease` |
| `print_attempts` | `uq_pa_job_attempt`（UNIQUE）、`ix_pa_terminal_started`、`ix_pa_result_started` |
| `merchant_terminals` | `ix_mt_merchant_status`、`ix_mt_merchant_seen` |
| `printing_audit_logs` | `ix_pal_merchant_created`、`ix_pal_resource_created`、`ix_pal_merchant_request` |

索引数量和列顺序均通过 `information_schema.statistics` 核对。

### 6.3 外键

共核对 18 个外键：

| 子表/列 | 父表/列 | 删除策略 |
|---|---|---|
| `printers.merchant_id` | `merchants.id` | RESTRICT |
| `receipt_templates.merchant_id` | `merchants.id` | RESTRICT |
| `print_rules.merchant_id` | `merchants.id` | RESTRICT |
| `print_rules.printer_id` | `printers.id` | RESTRICT |
| `print_rules.receipt_template_id` | `receipt_templates.id` | RESTRICT |
| `print_jobs.merchant_id` | `merchants.id` | RESTRICT |
| `print_jobs.order_id` | `orders.id` | SET NULL |
| `print_jobs.table_session_id` | `table_sessions.id` | SET NULL |
| `print_jobs.printer_id` | `printers.id` | RESTRICT |
| `print_jobs.print_rule_id` | `print_rules.id` | RESTRICT |
| `print_jobs.receipt_template_id` | `receipt_templates.id` | RESTRICT |
| `print_jobs.claimed_by_terminal_id` | `merchant_terminals.id` | SET NULL |
| `print_jobs.created_by_staff_id` | `merchant_staff.id` | SET NULL |
| `print_attempts.job_id` | `print_jobs.id` | RESTRICT |
| `print_attempts.terminal_id` | `merchant_terminals.id` | SET NULL |
| `merchant_terminals.merchant_id` | `merchants.id` | RESTRICT |
| `printing_audit_logs.merchant_id` | `merchants.id` | RESTRICT |
| `printing_audit_logs.actor_staff_id` | `merchant_staff.id` | SET NULL |

## 7. 最小约束验证结果

约束测试只使用虚构 ID、虚构商家和最小 JSON 快照，不含生产数据、账号、Token、Cookie 或顾客隐私。测试数据随临时 volume 一并销毁。

| 验证项 | 实际结果 | 结论 |
|---|---|---|
| 重复 `PrintJob.dedupe_key` | MySQL error 1062 | UNIQUE 生效，PASS |
| 重复 `PrintAttempt(job_id, attempt_no)` | MySQL error 1062 | 复合唯一生效，PASS |
| 插入悬空外键 | MySQL error 1452 | 引用完整性生效，PASS |
| 删除仍被引用的 Printer | MySQL error 1451 | RESTRICT 生效，PASS |
| 删除仍被引用的 Merchant | MySQL error 1451 | RESTRICT 生效，PASS |
| 将 Printer 置为 `enabled=false` | 更新成功，关联 Job 和 Attempt 均仍存在 | 历史不丢失，PASS |
| 删除有关联 Job 的 Order | 删除成功，Job 的 `order_id` 变为 NULL | SET NULL 生效，PASS |

这些结果验证的是实际数据库约束，而不是只根据 Prisma model 或 migration 文件推断。

## 8. 跨商家范围验证与已知边界

### 8.1 实测事实

通过直接 SQL 绕过 API Service 后，数据库允许：

- 商家 A 的 `PrintRule` 引用商家 B 的 `Printer`。
- 商家 A 的 `PrintJob` 引用商家 B 的 `Printer`。

相关测试行在验证后立即清理，并随隔离数据库销毁。

原因是当前外键只分别保证 `merchant_id` 和关联资源 ID 存在，没有通过复合唯一键加复合外键证明两者同属一个 Merchant。这与 `docs/printing-v1/02_PRINTING_DATA_MODEL_V1.md` 已记录的 V1 设计边界一致，不应把直接 SQL 可插入伪报为“数据库已阻止跨商家关联”。

其他带独立 `merchant_id` 与资源外键的关系具有相同结构风险，这是 schema 静态推断；本轮没有把每一种资源组合都逐项执行为跨商家 SQL 实测。

### 8.2 当前保护层

现有 Printing Service 在读取和关联写入时使用认证上下文中的 `merchantId`：

- Printer、Rule、Job、Template 和 Terminal 查询均带商家范围。
- 创建 Rule 时校验目标 Printer 归属商家，并只允许本商家或系统 Template。
- 创建 Job、生成 Receipt 快照和执行状态服务校验 Job、Printer、Terminal 与商家范围。
- 客户端不能通过普通商家 API 自报其他 `merchantId` 获得跨商家权限。

本次 Printing 模块 Jest 结果：

```text
Test Suites: 11 passed, 11 total
Tests:       141 passed, 141 total
```

因此，按当前明确采用的“数据库引用完整性 + Service 商家范围校验”V1 契约，Gate A 可以通过；但数据库层的同商家一致性仍是必须保留在风险清单中的限制。

### 8.3 后续风险控制建议

在开放终端领取、真实订单打印或任何数据库旁路写入前，应继续满足：

1. 所有关联查询和写入必须同时带认证 `merchantId`，不能只按资源 ID 查询。
2. 终端凭据中的 merchant scope 必须由服务端签发，不能接受请求体自报。
3. 必须保留跨商家 Service 测试，并为新增 connector API 增加相同负向测试。
4. 若未来允许数据库旁路导入或要求数据库自身形成租户安全边界，应单独设计复合唯一键与复合外键 migration；不得在本次验证中临时改 schema。

## 9. 其他静态约束风险

以下是静态审计发现、但未阻塞本次 migration 执行的事实：

### 9.1 `PrintJob.dedupe_key` 是全局唯一

当前索引为：

```text
UNIQUE(dedupe_key)
```

不是早期设计草案曾建议的 `UNIQUE(merchant_id, dedupe_key)`。自动任务的 dedupe hash 当前包含 merchant scope，因此正常服务调用不会因不同商家复用同一业务事件而碰撞；但数据库约束范围应以当前 migration 为准，后续文档和实现不得误写成复合唯一。

### 9.2 系统模板 nullable 唯一语义

`receipt_templates` 使用：

```text
UNIQUE(merchant_id, name, version)
```

MySQL 允许唯一索引中存在多条 NULL，因此 `merchant_id IS NULL` 的系统模板不能仅依靠该索引阻止同名同版本重复。V1 不提供商家端创建系统模板的入口，当前不阻塞 Gate A；未来若开放系统模板发布，应在受控服务或单独 schema 设计中补足唯一性策略。

### 9.3 JSON 内容约束位于应用层

`connection_config`、`capabilities`、`receipt_snapshot` 和模板 `definition` 的数据库类型为 JSON，但通道字段、ReceiptDocument 字段白名单和数值范围主要由 DTO/Service 校验。任何未来写接口都必须复用这些校验，不能把“JSON 类型合法”误认为“业务结构合法”。

## 10. 清理与生产隔离证明

验证结束后执行并确认：

| 清理项 | 结果 |
|---|---|
| 容器 `yunqiao-printing-migration-test` | 已删除，PASS |
| volume `yunqiao_printing_migration_test` | 已删除，PASS |
| 临时 Prisma/schema/migrations 副本 | 已删除，PASS |
| 临时密码或环境文件 | 未创建，PASS |
| 仓库数据库文件或配置 | 未新增，PASS |
| 生产数据库连接 | 未发生，PASS |
| 生产 migration | 未执行，PASS |

由于容器和 volume 已销毁，本次虚构约束测试数据不再存在。

## 11. Gate A 验收结论

| Gate 条件 | 结果 |
|---|---|
| 所有历史 migration | PASS |
| 打印任务中心 migration | PASS |
| 第二次 deploy 无 pending migration | PASS |
| Prisma validate | PASS |
| Prisma generate | PASS（首次工具准备问题已如实记录） |
| 新表、索引和外键核对 | PASS |
| 唯一、外键和删除策略约束 | PASS |
| Printing Service 商家范围测试 | PASS |
| 临时数据库、容器和 volume 已销毁 | PASS |
| 生产数据库未连接 | PASS |
| 生产 migration 未执行 | PASS |

最终结论：**Gate A PASS，可以继续本任务中已限定的 Android Web 收银终端外壳、通用 USB 诊断和 USB ESC/POS 测试打印开发。**

该结论不表示：

- 生产 migration 已获准或已执行。
- Android 已具备 PrintJob 领取或终端配对能力。
- 任意 USB 打印机、VID/PID、接口、端点或 ESC/POS 兼容性已经过门店实机验证。
- 真实订单打印、自动打印、后台恢复或云打印已经可用。

数据库层不能单独阻止跨商家关联的限制继续有效，必须在后续 connector/API 设计与测试中保持显式保护。
