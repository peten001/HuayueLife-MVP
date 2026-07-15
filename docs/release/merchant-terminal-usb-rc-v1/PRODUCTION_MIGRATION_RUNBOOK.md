# 打印任务中心生产 Migration Runbook

## 状态

当前为 **BLOCKED**：生产数据库身份、备份目录、可用空间、备份校验值、恢复演练和生产 migration 状态均未确认。本轮没有连接生产数据库，也没有执行生产 migration。

## 强制前置条件

- [ ] 明确生产 MySQL 主机和目标数据库，但不得在报告或聊天中粘贴完整 URL。
- [ ] 由授权的只读/备份身份统计旧打印表和新表是否存在。
- [ ] 进入维护窗口并确认期间没有并发 DDL、schema 管理任务或其他 migration。
- [ ] 确认备份目录不在应用发布目录，空间至少为当前数据库的两倍。
- [ ] 完成一致性全量备份并计算 SHA-256。
- [ ] 将备份恢复到新建隔离数据库并完成基础查询。
- [ ] 审阅所有待执行 migration，只允许已审计的增量 DDL。
- [ ] API/Web 回滚包和操作人员同时就绪。

## 安全默认 Flag

Migration 和 API 部署期间必须保持：

```text
LEGACY_PRINTING_ENABLED=false
PRINTING_TASK_CENTER_ENABLED=true
PRINTING_AUTO_CREATE_ENABLED=false
PRINTING_EXECUTION_ENABLED=false
```

数据库新增的商家级 `printingEnabled`、Printer、PrintRule 和 MerchantTerminal 均必须保持关闭或未配对。

## 备份模板

以下为变量模板，不包含真实凭据：

```bash
umask 077
BACKUP_FILE="__SECURE_BACKUP_DIR__/huayue_before_printing_rc_$(date +%Y%m%d_%H%M%S).sql"
mysqldump --single-transaction --routines --triggers --events \
  -h '__MYSQL_HOST__' -u '__BACKUP_USER__' -p \
  '__PRODUCTION_DATABASE__' > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
shasum -a 256 "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
```

密码只通过交互提示、受控凭据文件或部署平台 Secret 注入，不能写进命令历史。备份文件必须使用已批准的静态加密方案或加密对象存储保存，并通过受控通道复制至少一份；记录访问权限、保留期限、文件大小和密文 SHA-256。不得把明文 dump 留在应用发布目录。

## 恢复演练模板

必须恢复到全新的隔离数据库，绝不能覆盖生产：

```bash
mysql -h '__ISOLATED_MYSQL_HOST__' -u '__RESTORE_USER__' -p \
  '__NEW_RESTORE_DATABASE__' < '__BACKUP_FILE__'
```

记录表数、核心订单/商家/桌台数量，并确认备份可读。

## Migration 执行

先在受控 shell/部署平台中注入 `DATABASE_URL`，不要把真实 URL 直接写进命令行或 shell history。然后验证 RC SQL 与已审计文件完全一致：

```bash
test "$(shasum -a 256 apps/api/prisma/migrations/20260715120000_add_terminal_connector_rc_v1/migration.sql | awk '{print $1}')" = \
  '5f793a646b82fd64da68be7cac682a43081913c7ef209007c15471e36ad47b23'
test -n "${DATABASE_URL:-}"
```

先只读查看状态：

```bash
corepack pnpm --filter @huayue-life/api exec prisma migrate status
```

确认备份和恢复演练后才允许：

```bash
corepack pnpm --filter @huayue-life/api prisma:deploy
```

禁止 `prisma migrate dev`、`db push`、手工改表或跳过失败 migration。

## 执行后检查

- `_prisma_migrations` 无 unfinished/rolled back 项。
- 打印任务中心及 RC connector 表、列、索引和外键与 schema 一致。
- 原商家、员工、订单、桌台、TableSession 计数不变。
- 所有商家打印总开关为 false。
- 没有自动 PrintJob；没有 ACTIVE 终端；没有 enabled Printer/autoPrint Rule。
- API health、登录、订单和桌台读操作正常。

## 失败处理

停止 API 新版本，保留原始错误和备份，不要继续执行其他 DDL。是否回滚数据库必须由 migration SQL、MySQL DDL 行为和备份恢复时间共同决定；不得未经审核直接反向删除表或列。
