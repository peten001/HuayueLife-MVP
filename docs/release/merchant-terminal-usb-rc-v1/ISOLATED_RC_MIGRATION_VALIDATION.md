# USB RC Migration 隔离验证记录

> 验证日期：2026-07-15（Asia/Ho_Chi_Minh）
> 结论：隔离数据库 Gate **PASS**；生产数据库未连接、未备份、未执行 migration。

## 验证对象

从空库顺序重放仓库全部 16 个 migration，重点验证：

```text
apps/api/prisma/migrations/20260715120000_add_terminal_connector_rc_v1/migration.sql
SHA-256: 5f793a646b82fd64da68be7cac682a43081913c7ef209007c15471e36ad47b23
```

该 migration 只新增/扩展 RC 所需结构：商家打印总开关、Terminal 独立凭据/绑定/诊断字段、PrintJob 内容 Hash、Attempt 写入结果，以及 durable `print_trigger_outbox`。没有删除旧 `printer_settings`、`print_logs` 或恢复旧直打。

## 隔离环境

| 项目 | 实际值 |
|---|---|
| Docker CLI | 29.5.3 |
| 镜像 | 官方 `mysql:8.4` |
| image ID | `sha256:c831a0f11348d402b43d77453e17d770be2eef356615a2823fe0f5a0d6c8b9af` |
| MySQL | 8.4.10 |
| Prisma CLI/Client | 5.22.0 |
| Host | 仅 `127.0.0.1:33307` |
| 数据目录 | 一次性 tmpfs，1 GiB |
| 数据 | 全新虚构空库，无生产数据或凭据 |

脱敏等价启动命令：

```bash
docker run -d \
  --name yunqiao-rc-migration-validation-20260715 \
  --tmpfs /var/lib/mysql:rw,noexec,nosuid,size=1g \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=yes \
  -e MYSQL_DATABASE=huayue_rc_validation \
  -p 127.0.0.1:33307:3306 \
  mysql:8.4 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci
```

空密码只用于仅回环、一次性 tmpfs 容器，禁止用于共享环境或生产。

## 执行结果

首次执行：

```bash
cd apps/api
DATABASE_URL='<isolated-loopback-url>' \
corepack pnpm exec prisma migrate deploy --schema prisma/schema.prisma
```

结果：识别 16 个 migration，全部成功；`_prisma_migrations` 为 16 行，unfinished=0、rolled_back=0。

第二次执行相同命令：

```text
No pending migrations to apply.
```

顺序为：

1. `20260610000000_init`
2. `20260611000000_add_order_idempotency`
3. `20260611010000_backfill_category_product_name_vi`
4. `20260612093000_add_platform_admin_and_password_flags`
5. `20260618090000_add_merchant_homepage_categories`
6. `20260622000000_add_order_chat`
7. `20260623000000_add_printer_settings_and_print_logs`
8. `20260627000000_add_merchant_client_visibility`
9. `20260628120000_add_merchant_daily_reports`
10. `20260629000000_add_merchant_platform_model`
11. `20260629010000_refine_merchant_platform_model`
12. `20260629020000_reconcile_daily_report_columns`
13. `20260702000000_add_table_sessions`
14. `20260710000000_add_platform_settings`
15. `20260715000000_add_printing_task_center_v1`
16. `20260715120000_add_terminal_connector_rc_v1`

## 默认值与约束

| 检查 | 实际结果 |
|---|---|
| `merchants.printing_enabled` | `NOT NULL DEFAULT 0` |
| `printers.enabled` | `DEFAULT 0` |
| `print_rules.enabled / auto_print` | 均 `DEFAULT 0` |
| `merchant_terminals.status` | `UNPAIRED` |
| Terminal token/pairing 计数 | tokenVersion=0、attemptCount=0、maxAttempts=5 |
| `print_trigger_outbox.status` | `PENDING` |
| Outbox attempt/lease | attemptCount=0、maxAttempts=20、leaseVersion=0 |
| `uq_mt_bound_printer` | UNIQUE 生效 |
| `uq_pto_event_key` | UNIQUE 生效 |
| Outbox 外键 | merchant/order/status log/rule/printer/template 共 6 个，DELETE RESTRICT、UPDATE CASCADE |

## Schema drift 核对

执行 `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --exit-code`，exit=2。报告的差异全部是仓库在本 RC 前已存在的历史 drift：若干 `updated_at`、`merchant_mode` 的 DISPLAY/DISPLAY_ONLY 默认差异；没有 Terminal、Outbox 或 RC printing 表/列/索引/FK drift。

这项历史 drift 必须保留在生产 migration 风险中，不能把 exit=2 写成全量 schema 无差异；它也不是本次 RC migration 执行失败。

## API 验证

- API unit：28 suites / 262 tests，PASS。
- API typecheck/build：PASS。
- 隔离空库全 e2e：merchant-orders 与 user-orders 2 suites PASS；其余 5 suites 因仓库既有空库 Feature 配置、过期 fixture（用户名已改手机号规则）或真实微信 QR 外部配置依赖失败，共 28 PASS / 28 FAIL。本轮没有修改这些既有业务或伪造外部配置。

因此，RC migration 与打印模块单元 Gate 通过；仓库全量 e2e 不能声明全绿，生产部署 Gate 仍受备份、恢复演练和目标环境信息阻塞。

## 清理

执行 `docker rm -f yunqiao-rc-migration-validation-20260715`，并用精确名称检查确认容器不存在。tmpfs 随容器销毁；未创建 volume、数据库文件、生产连接配置或临时密码文件。
