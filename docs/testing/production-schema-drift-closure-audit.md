# 生产 Schema Drift 收口审计与发布前兼容性核查

审计日期：2026-07-17

最终应用提交：`main@a5f1ee790e885c607a2eebbf2466814b060ccbc7`

生产发布前代码：`main@b7f056609996635ca235965c3662916a3150e052`

原审计结论：Drift 收口候选已在 MySQL 8.0.46 生产结构克隆库验证通过，但当时因 `OrderStatusLog` 新动作在商家后台、平台后台和顾客时间线中存在错误或重复展示而标记为 `NOT_READY_FOR_PRODUCTION`。

2026-07-17 收口更新：**7 项 Prisma 声明、三端动作日志兼容和测试变量名均已完成修复；历史 16 个 migration 与功能第 17 个 migration 的隔离验证、全量回归、生产备份、同批发布及生产最终空 diff 全部通过。原动作日志阻断已关闭。**

下文第 1 至 13 节保留原只读审计轮次的历史事实；当时只执行生产只读查询和本地隔离库写入。最终生产收口结果单独记录在第 15 节，不用后来的状态覆盖原审计证据。

## 1. 原只读审计时状态（历史快照）

| 项目 | 结果 |
|---|---|
| 本地分支 | `main` |
| 本地 HEAD / `origin/main` | `f0f1d71c2e0e08be815c465f1a8bd94f5b34033d` |
| 本地开始时工作区 | 干净 |
| 生产工作区 | 干净 |
| 生产 Commit | `b7f056609996635ca235965c3662916a3150e052` |
| PM2 | `huayue-api` online；审计时 uptime 约 19 小时，unstable restarts 为 0 |
| API | `https://api.huayueyouxuan.com/api/v1/health`：200 |
| Cashier | `https://cashier.huayueyouxuan.com/`：200 |
| Admin | `https://admin.huayueyouxuan.com/`：200 |
| 生产 MySQL | `8.0.46-0ubuntu0.22.04.2` |
| 生产 migration | 相对生产 `b7f0566` checkout 的 16 个 migration：16/16 finished，0 failed，0 pending |
| `orders` | 141 行；`user_id IS NULL` 为 0 |
| `order_status_logs` | 622 行 |
| `f0f1d71` 功能 migration | 未执行生产 migration |
| `f0f1d71` API/Cashier | 未部署 |
| 本轮生产写入 | 无 |

说明：`prisma migrate status` 只核对当前 checkout 中的 migration 记录，不能证明实际 schema 与 Prisma datamodel 无 drift。生产 `b7f0566` 的 16 个 migration 全部完成，与下文 7 项声明差异可以同时成立；相对目标 `f0f1d71` 仍另有 1 个尚未在生产执行的功能 migration。

## 2. Drift 清单纠正

原 Gate 列出 6 项，但真实 `prisma migrate diff` 稳定复现出 **7 项**。遗漏项为：

```text
merchant_business_types.updated_at
```

真实清单：

1. `capabilities.updated_at`
2. `promotion_tags.updated_at`
3. `merchant_business_types.updated_at`
4. `merchant_capabilities.updated_at`
5. `merchant_images.updated_at`
6. `merchant_business_types.default_merchant_mode`
7. `merchants.merchant_mode`

若只处理原清单中的 6 项，最终 Prisma diff 仍不会为空。

## 3. 七项 Drift 证据

### 3.1 五个 `updated_at`

生产五列定义完全一致：

```text
DATETIME(3) NOT NULL
DEFAULT CURRENT_TIMESTAMP(3)
ON UPDATE CURRENT_TIMESTAMP(3)
```

当前 Prisma 五处只声明：

```prisma
updatedAt DateTime @updatedAt @map("updated_at")
```

| 表/字段 | 历史 migration 来源 | 生产行数 | NULL | 最早 | 最晚 | 来源判断 |
|---|---|---:|---:|---|---|---|
| `capabilities.updated_at` | `20260629000000_add_merchant_platform_model/migration.sql` | 13 | 0 | 2026-06-30 14:00:26.190 | 2026-06-30 14:00:26.204 | migration 可复现 |
| `promotion_tags.updated_at` | `20260629000000_add_merchant_platform_model/migration.sql` | 5 | 0 | 2026-06-30 14:00:26.171 | 2026-06-30 14:00:26.187 | migration 可复现 |
| `merchant_business_types.updated_at` | `20260629000000_add_merchant_platform_model/migration.sql` | 8 | 0 | 2026-06-30 14:00:26.156 | 2026-07-16 13:29:05.001 | migration 可复现；原清单遗漏 |
| `merchant_capabilities.updated_at` | `20260629000000_add_merchant_platform_model/migration.sql` | 1040 | 0 | 2026-06-30 14:00:25.383 | 2026-07-16 07:26:19.379 | migration 可复现 |
| `merchant_images.updated_at` | `20260629010000_refine_merchant_platform_model/migration.sql` | 80 | 0 | 2026-06-30 14:00:26.214 | 2026-07-16 00:52:23.005 | migration 可复现 |

这些字段不是生产手工 DDL，均不标记 `UNTRACKED_PRODUCTION_DDL`。仓库中没有后续 migration 修改它们，生产也没有相关 trigger。

`prisma db pull --print` 对生产结构反推结果为：

```prisma
updatedAt DateTime @default(now()) @updatedAt @map("updated_at")
```

因此 drift 的直接原因是当前 schema 遗漏了 `@default(now())`，不是生产多出无法追踪的 `ON UPDATE`。

### 3.2 更新时间的真实管理行为

代码审计结果：

- 当前运行代码通过 Prisma `create/update/createMany/updateMany/upsert` 写这些表；
- 没有发现运行时代码用原生 SQL 直接更新这五张表；
- 历史 migration 使用过原生 SQL；
- 仓库无法证明不存在仓库外运维脚本，因此不能假设未来永远只有 Prisma 写入。

在隔离克隆库验证：

| 写入方式 | 五张表结果 |
|---|---|
| 原生 SQL 修改业务字段 | 五个 `updated_at` 均由数据库自动更新：PASS |
| 当前 Prisma Client 修改业务字段 | 五个 `updated_at` 均由 `@updatedAt` 更新：PASS |

两层管理不会造成两次业务写入。Prisma 更新会显式提供时间，数据库默认/ON UPDATE 同时为原生 SQL 或外部写入提供兜底。直接删除任一层都会缩小当前兼容范围。

### 3.3 Merchant Mode 两项

生产两个字段类型一致：

```text
ENUM('DISPLAY','MANAGED','DISPLAY_ONLY','PRODUCT_DISPLAY','ONLINE_ORDER','QR_ORDER')
NOT NULL DEFAULT 'DISPLAY'
```

当前 Prisma 默认均为 `DISPLAY_ONLY`：

- `Merchant.merchantMode @default(DISPLAY_ONLY)`
- `MerchantBusinessType.defaultMerchantMode @default(DISPLAY_ONLY)`

生产聚合数据：

| 表 | DISPLAY | MANAGED | DISPLAY_ONLY | PRODUCT_DISPLAY | ONLINE_ORDER | QR_ORDER |
|---|---:|---:|---:|---:|---:|---:|
| `merchants` | 72 | 8 | 0 | 0 | 0 | 0 |
| `merchant_business_types` | 8 | 0 | 0 | 0 | 0 | 0 |

历史时间线：

1. `20260629000000_add_merchant_platform_model`
   - 初始 enum 为 `DISPLAY_ONLY / PRODUCT_DISPLAY / ONLINE_ORDER / QR_ORDER`；
   - 默认值为 `DISPLAY_ONLY`；
   - 经营类型 seed 使用 `DISPLAY_ONLY`；
   - 既有商家被写为 `QR_ORDER`。
2. `20260629010000_refine_merchant_platform_model`
   - 新增规范值 `DISPLAY / MANAGED`；
   - 两个数据库默认明确改为 `DISPLAY`；
   - 所有经营类型默认更新为 `DISPLAY`；
   - `DISPLAY_ONLY → DISPLAY`；
   - `PRODUCT_DISPLAY / ONLINE_ORDER / QR_ORDER → MANAGED`。

因此 `DISPLAY` 与 `DISPLAY_ONLY` 不是两个仍并行使用的新产品模式；`DISPLAY_ONLY` 是保留在 enum 中的兼容旧值，当前规范值是 `DISPLAY`。同理，三个旧经营模式统一兼容到 `MANAGED`。

代码证据：

- `apps/api/src/modules/platform/platform-merchants.service.ts` 将旧值映射到 `DISPLAY/MANAGED`；
- `apps/api/src/modules/public-merchants/public-merchants.service.ts` 使用相同兼容映射；
- `apps/merchant-admin/src/pages/PlatformMerchantsPage.vue` 保留旧值兼容；
- 平台新建展示商家、Excel 导入及默认字典明确使用 `DISPLAY`；
- 账号开通后的经营商家明确使用 `MANAGED`；
- 存在一个创建路径省略 `merchantMode`，生产数据库会使用 `DISPLAY` 默认值。

结论：生产真实数据、refine migration、API 和 UI 均以 `DISPLAY/MANAGED` 为当前权威语义。不能把生产数据或默认值改回 `DISPLAY_ONLY`。

## 4. 历史 Migration 与生产结构

生产 16 个 migration 可在全新的 MySQL 8.0.46 隔离库完整执行，并稳定产生上述 7 项 diff。由此确认：

- 生产结构可由仓库 migration 链复现；
- 没有证据支持 `UNTRACKED_PRODUCTION_DDL`；
- 根因是 `20260629000000` 与 `20260629010000` 同批引入时，schema 没有完整同步 migration 的默认值；
- 后续 migration 没有修正该 datamodel 声明；
- `f0f1d71` 的新 migration 没有制造这 7 项 drift。

隔离库对原 schema 执行的 diff 摘要：

```sql
capabilities.updated_at                         DROP DEFAULT
promotion_tags.updated_at                       DROP DEFAULT
merchant_business_types.updated_at              DROP DEFAULT
merchant_capabilities.updated_at                DROP DEFAULT
merchant_images.updated_at                      DROP DEFAULT
merchant_business_types.default_merchant_mode   DEFAULT DISPLAY_ONLY
merchants.merchant_mode                         DEFAULT DISPLAY_ONLY
```

不应直接执行这份自动 diff，因为它会让数据库向过时的 schema 声明靠拢，而不是恢复历史 migration 已确认的当前业务语义。

## 5. OrderStatusLog 消费方审计

`f0f1d71` 新增以下 action：

```text
MERCHANT_ADD_ITEMS
ORDER_ITEM_DECREASED
ORDER_ITEM_RETURNED
```

点菜动作日志使用 `PENDING_ACCEPTANCE → PENDING_ACCEPTANCE`；减菜和退菜使用当前状态作为 `fromStatus` 与 `toStatus`。

### 5.1 消费方结果

| 消费方 | 结论 | 证据与影响 |
|---|---|---|
| 商家后台订单时间线 | **需要修复 / BLOCKER** | `OrderDetailPage.vue` 无 action 分支，固定显示 `fromStatus → toStatus`，会出现“待接单 → 待接单”“制作中 → 制作中” |
| 平台后台订单时间线 | **需要修复 / BLOCKER** | API `PlatformOrdersService` 丢弃 action，UI 只显示 `toStatus`；会出现重复同状态记录，无法结构化识别动作 |
| 小程序订单详情 | **需要修复 / BLOCKER** | 新字段已剥离，但 action 日志行没有过滤；顾客 DINE_IN 订单被减/退菜后会出现重复状态记录 |
| Web 收银台 | 安全 | 当前没有渲染 `statusLogs` 时间线，mutation 使用订单/桌账快照 |
| 打印 outbox | 安全 | 只在真实状态 transition 显式 enqueue；减菜/退菜日志不会扫描触发 outbox |
| 新订单声音/通知 | 安全 | Admin 与 Cashier 按 PENDING Order ID 差集提醒，不消费 statusLogs |
| 统计报表 | 安全 | 按 `Order.status` 和当前金额汇总，不按日志行计数 |
| TableSession 桌账 | 安全 | 动态汇总当前 Order/Item/金额，不读取动作日志 |
| 聊天 | 安全 | 按订单状态和 `userId` 工作，不读取动作日志 |
| 审计数据 | 安全 | action、metadata、requestKey 能正确记录操作者、数量、金额和幂等键 |

### 5.2 小程序/API兼容结论

以下兼容保护已实现：

- 顾客列表、详情、取消、聊天按非空 `userId` 隔离；
- 员工追加订单不会进入顾客接口；
- `serializeCustomerOrder` 剥离 `createdByStaffId`；
- 顾客 status log 剥离 `action/metadata/requestKey`；
- 顾客取消竞态保持原 `HTTP_409` 错误契约。

但“剥离字段”没有“剥离动作日志行”。对顾客原订单执行减菜/退菜后，小程序会收到没有 action 字段的同状态日志。这保持了 JSON 字段形状，却改变了时间线语义，因此不能标记为完全兼容。

### 5.3 原审计建议与本轮落实

1. Merchant Admin 的 `OrderStatusLog` DTO 增加 action；action 日志显示“商家点菜 / 减菜 / 退菜”，普通状态日志才显示 `from → to`。
2. Platform API 第一版过滤内部 action 日志行，平台时间线只保留普通状态变化。
3. 顾客 serializer 过滤内部 action 日志行，小程序页面与 JSON 字段结构保持冻结。
4. 增加 Admin、Platform、小程序三类契约与 UI 测试。

上述 4 项已按确认策略落实：Merchant Admin 显示动作；Platform 与顾客 API 过滤内部动作整行；契约及三语言呈现测试已增加。原审计判断与收口后判断分别为：

```text
原审计是否存在错误展示：是
是否触发重复通知：否
是否触发重复打印：否
是否影响订单状态统计：否
原审计是否阻断发布：是
收口后是否仍阻断：否
```

## 6. `b7f0566 → f0f1d71` 完整版本跨度

跨度为严格线性的 4 个 Commit，共 111 个唯一变更文件、9141 additions、922 deletions：

| Commit | 内容 | 分类 | 审计结论 |
|---|---|---|---|
| `cbb6739` | Android 移除旧 Terminal Token/配对流程，使用商家 Web 会话，固定正式 Cashier/API | `APPROVED` | 已有 Android RC2 Tag；服务器发布不会构建 Android |
| `bc24dcd` | Android 隐藏 Connector 维护页 UI、正向 Switch、自动打印禁用、RC3 | `APPROVED` | 已有 Android RC3 Tag；没有改服务端 READY/Connector 状态机 |
| `20ea442` | Cashier 订单/桌账详情、账号角色、操作栏和布局优化 | `PRODUCTION_UI_MATCH` | 生产静态包与该提交的独有 UI markers 一致，高度可信；静态包未嵌入 build revision，不能据此密码学证明完整源码来源 |
| `f0f1d71` | 员工点菜、减菜、退菜、nullable `userId`、动作日志、Cashier UI | 原审计：功能代码 `APPROVED`、发布 `BLOCKER` | 依赖新 migration；动作日志兼容阻断已在本轮关闭 |

模块分类：

| 模块 | 差异 | 分类 |
|---|---:|---|
| API | 34 个唯一文件 | `APPROVED`，依赖新 migration；时间线兼容已在本轮修复 |
| Cashier | 45 个唯一文件 | 生产 UI 与 `20ea442` 高度一致；`f0f1d71` 尚未上线 |
| Merchant Admin | 0 | 目标跨度原本无源码变化；本轮增加 action-aware 时间线修复 |
| Miniapp | 0 | 源码保持不变；本轮由顾客 API 过滤动作日志保证兼容 |
| Android | 30 个唯一文件 | `APPROVED`；已有 RC2/RC3 Tag；不随服务器部署构建 |
| Prisma/migrations | schema + 1 个新 migration | 7 项声明已收口；功能 migration 等待同批生产 Gate |
| API Printing | 0 | 服务端打印逻辑无变化 |
| Auth/guards/roles | 0 | JWT、Guard、角色模型无变化 |
| Docs/tests | 测试及审计文档 | `UNRELATED_BUT_SAFE` |

唯一新增 migration：

```text
20260717000000_add_staff_order_origin_and_item_audit
```

生产 Cashier 当前静态 release 已发现与 `20ea442` 一致的 `table-summary-tab`、`account-role-account-label`、`table-detail-actions` 和 `order-item-scroll` markers，但没有 `f0f1d71` 新增点菜/退菜 endpoint 字符串。前者是高度可信的静态内容证据；由于 bundle 未嵌入 build revision，不能把它表述为对精确源码版本的密码学证明。后续必须把功能 migration、API、Cashier 作为同一发布批次，不能把现状误判为整个目标 commit 已部署。

## 7. 环境变量与 Feature Flag

生产只输出变量是否设置，不记录值：

| 变量 | 生产状态 | 代码默认/含义 |
|---|---|---|
| `DATABASE_URL` | SET | 原生产数据库 |
| `JWT_SECRET` | SET | 认证逻辑在跨度内未变 |
| `JWT_EXPIRES_IN` | SET | 代码 fallback 仍为 `7d` |
| `CORS_ALLOWED_ORIGINS` | SET | CORS 实现未变 |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | SET | 小程序生产配置未变 |
| `PLATFORM_ORDERING_ENABLED` | SET | 数据库 setting 优先于 env |
| `PRINTING_TASK_CENTER_ENABLED` | UNSET | fallback `true` |
| `PRINTING_AUTO_CREATE_ENABLED` | UNSET | fallback `false`，自动任务创建关闭 |
| `PRINTING_EXECUTION_ENABLED` | SET | 执行端变量存在；不是自动任务开关 |
| `LEGACY_PRINTING_ENABLED` | UNSET | fallback `false`，旧服务器直打关闭 |

生产 `platform_settings.platformOrderingEnabled` 的有效数据库设置为启用。商家打印总开关数据分布为 78 个关闭、2 个开启；本轮没有修改任何商家开关。

打印有效状态摘要（不披露环境变量原值）：任务中心按既有 fallback 启用；自动任务创建按既有 fallback 关闭，因此不会自动形成打印任务；旧服务器直打按既有 fallback 关闭；执行端变量已显式配置，但本轮未改变其状态。`b7f0566 → f0f1d71` 没有修改这些服务端打印 Flag 或打印模块，自动打印仍保持关闭。

版本跨度内：

- API、Cashier、Miniapp 的 env example 均未变化；
- `VITE_API_BASE_URL` 的生产 fallback 仍是正式 API；
- `VITE_CASHIER_USE_FIXTURES` 只有精确 `true` 才开启，生产默认关闭；
- `VITE_MERCHANT_ADMIN_URL` 仍指向正式商家后台；
- 新增 `CASHIER_SCREENSHOT_DIR` 只用于本地截图脚本；
- Android release 地址被固定为正式 Cashier/API，debug 和签名变量仍保留。

测试卫生项已关闭：`merchant-item-adjustments.e2e-spec.ts` 已将不存在的 `PRINTING_AUTO_TASKS_ENABLED` 修正为真实 key `PRINTING_AUTO_CREATE_ENABLED`；测试显式保持 auto-create 关闭。

## 8. 候选收口方案

### 8.1 `updated_at`

#### 方案 A：schema 补齐 `@default(now()) @updatedAt`（推荐）

优点：

- 与历史 migration、生产定义和 `db pull` 完全一致；
- 保留 Prisma `@updatedAt`；
- 保留数据库 DEFAULT/ON UPDATE 对原生 SQL 的兼容；
- 不需要生产 DDL、数据更新或锁表；
- 克隆库 diff 已验证为空。

风险：两层时间管理继续存在，但隔离验证证明 Prisma 与原生 SQL 均正常更新时间；业务语义不变。

回滚：恢复 schema 声明即可，数据库不变，但会重新出现 drift。

#### 方案 B：按当前自动 diff 删除数据库 DEFAULT

优点：减少一项默认声明差异。

风险：需要 5 个 ALTER；可能获取 metadata lock；非 Prisma INSERT 需要显式提供时间；与历史 migration 原设计相反；仍必须仔细确认 ON UPDATE 表达。**不推荐。**

#### 方案 C：移除数据库自动时间，完全交给 Prisma

风险：需要修改五张生产表；原生 SQL/外部写入不再自动更新时间；回滚复杂；没有业务收益。**不推荐。**

#### 方案 D：移除 Prisma `@updatedAt`，只依赖数据库

风险：Prisma datamodel 丢失明确更新时间语义，也不能完整表达所有客户端行为。**不推荐。**

综合比较：

| 方案 | 现有数据 | Prisma 写入 | 非 Prisma 写入 | 未来 migration | 锁表/重建 | 回滚 | 业务语义 |
|---|---|---|---|---|---|---|---|
| A：schema 补 `@default(now()) @updatedAt` | 完全兼容，不改数据 | 继续由 `@updatedAt` 更新时间 | 保留 DB DEFAULT/ON UPDATE 兜底 | 克隆库已验证 empty diff | 无生产 DDL、无锁表、无需重建 | 恢复 schema 声明即可；会重现 drift | 不变 |
| B：数据库删除 DEFAULT | 数据本身不改 | Prisma create/update 可继续工作 | 非 Prisma INSERT 必须自行提供时间；ON UPDATE 行为仍需保留 | 需要显式 ALTER migration，后续更易误删兼容能力 | 5 张表存在 metadata lock；MySQL 是否原地变更取决于版本/算法，不能保证无需重建 | 再 ALTER 恢复 DEFAULT；需重新验证原生写入 | 缩小非 Prisma 写入兼容范围 |
| C：数据库删除 DEFAULT/ON UPDATE，完全交给 Prisma | 数据本身不改 | 正常 | 原生 SQL/外部写入不再自动维护时间 | 需要显式 ALTER，未来 schema 更简单但与历史设计相反 | 5 张表 metadata lock，不能预先保证无重建 | 重新添加 DEFAULT/ON UPDATE | 改变更新时间权威来源 |
| D：移除 Prisma `@updatedAt`，只依赖数据库 | 数据本身不改 | 更新时间依赖数据库；Prisma 模型不再声明更新语义 | 正常 | 需要 schema/migration 特殊维护，存在持续 introspection 差异风险 | 若仅改 schema 无锁；若为消除 diff 追加 baseline 会掩盖真实差异 | 恢复 `@updatedAt` 并重新验证 diff | 改变 Prisma 层契约 |

### 8.2 Merchant Mode

#### 方案 A：schema 默认改为 `DISPLAY`，保留全部 enum 值（推荐）

优点：

- 与 refine migration、生产默认、生产数据和当前 API/UI 语义一致；
- 不修改现有 80 条商家或 8 条经营类型数据；
- 不需要生产 DDL；
- 旧 enum 值继续用于兼容历史数据/API；
- 不改变小程序审核版或能力开关。

回滚：恢复 schema 默认声明即可，数据库和数据不变，但 drift 会重新出现。

#### 方案 B：生产默认改回 `DISPLAY_ONLY`

会让未来新记录重新采用旧兼容值，与 refine migration 和当前代码方向相反，需要两张表 ALTER。**不推荐。**

#### 方案 C：数据 `DISPLAY → DISPLAY_ONLY`

需要改写所有展示商家和经营类型，没有业务收益，并可能改变可见性分支。**禁止采用。**

#### 方案 D：继续依靠映射并忽略 drift

违反本 Gate“不得强行忽略 drift”，未来 migration 仍会报告差异。**禁止采用。**

综合比较：

| 方案 | 当前生产值/读取 | 新建商家 | 旧商家兼容 | 小程序审核与平台能力 | 锁表/重建 | 回滚 | 业务语义 |
|---|---|---|---|---|---|---|---|
| A：schema 默认改为 `DISPLAY`（推荐） | 与 72 个 DISPLAY、8 个 MANAGED 及当前 enum 读取一致 | 省略字段时继续得到 DISPLAY | 保留全部旧 enum 和兼容映射 | 不改变审核可见性或 capability | 无生产 DDL、无锁表、无需重建 | 恢复 schema 默认；会重现 drift | 承认 refine migration 后的规范语义 |
| B：生产默认改回 `DISPLAY_ONLY` | 现有值仍可读取，但默认与当前数据/代码方向分裂 | 新记录重新产生旧兼容值 | 旧值可读，但长期增加兼容负担 | 可能进入旧值分支，必须重测审核与能力映射 | 两表 ALTER 有 metadata lock；是否重建不可预先保证 | 再 ALTER 回 DISPLAY | 倒退到已被 refine migration 替换的语义 |
| C：数据 `DISPLAY → DISPLAY_ONLY` 后改默认 | 需要改写 72 个商家和 8 个经营类型相关默认数据 | 新记录使用旧值 | MANAGED 与其他旧值仍需兼容 | 有改变商家可见性、审核分支和能力判定的实质风险 | 数据更新加两表 ALTER；锁范围最大，可能长事务 | 必须保留映射清单并反向改数据/默认，风险高 | 实质改变当前规范语义 |
| D：只增加映射/过渡 migration 或忽略 drift | 当前代码已存在映射，读取不报错 | 数据库仍写 DISPLAY、Prisma 声明仍为 DISPLAY_ONLY | 表面兼容 | 页面暂时可工作，但未来 migration 持续给出错误变更 | 若只忽略则无锁；若 baseline 则掩盖差异 | 删除过渡层仍回到原 drift | 不收口权威默认，违反 Gate |

## 9. 唯一推荐方案

本轮已按用户确认只修正 Prisma schema 声明：

```prisma
Merchant.merchantMode                    @default(DISPLAY)
MerchantBusinessType.defaultMerchantMode @default(DISPLAY)

MerchantBusinessType.updatedAt @default(now()) @updatedAt
PromotionTag.updatedAt          @default(now()) @updatedAt
Capability.updatedAt            @default(now()) @updatedAt
MerchantCapability.updatedAt    @default(now()) @updatedAt
MerchantImage.updatedAt         @default(now()) @updatedAt
```

Drift 收口本身：

```text
生产 DDL：无
生产数据更新：无
metadata lock：无
业务语义变化：无
小程序审核版变化：无
打印变化：无
```

这不是 baseline 掩盖，也不是忽略 drift，而是让 datamodel 准确描述仓库历史 migration 已建立且生产正在使用的结构。

第 5 节的 OrderStatusLog 消费方问题已按确认策略修复并完成全量本地回归。Drift 收口与动作日志兼容的本地结论更新为：

```text
READY_FOR_PRODUCTION_GATE
```

## 10. 隔离数据库验证

隔离数据库：

```text
huayue_schema_drift_prodclone_20260717
```

环境：本机 Docker MySQL `8.0.46`，端口 3307。未导入任何生产顾客、账号、订单或商家数据，只使用 migration seed 和合成数据。

执行过程与结果：

1. 从 `b7f0566` 归档执行生产 16 个历史 migration：PASS。
2. `prisma migrate status`：16 个 migration，Database schema is up to date。
3. 原 b7 schema diff：稳定复现 7 项差异，PASS。
4. 写入合成 Merchant、Staff、User、DiningTable、OPEN TableSession、顾客 Order、OrderItem 和旧状态日志：PASS。
5. 省略 Merchant Mode 创建商家/经营类型：数据库均写入 `DISPLAY`，PASS。
6. 原生 SQL 更新五张表：五个 `updated_at` 均更新，PASS。
7. Prisma Client 更新五张表：五个 `updated_at` 均更新，PASS。
8. 仅使用候选 b7 schema 声明对比：`This is an empty migration`，PASS。
9. 执行 `20260717000000_add_staff_order_origin_and_item_audit`：PASS。
10. 旧顾客订单及旧状态日志值保持不变：PASS。
11. 创建 `user_id=NULL + created_by_staff_id` 员工追加订单及结构化 action 日志：PASS。
12. 新外键、员工幂等索引和动作 requestKey 索引存在：PASS。
13. 全部 API E2E：8 suites / 68 tests PASS。
14. 最终数据库与候选 f0 schema diff：`This is an empty migration`，PASS。
15. 临时数据库已删除；为该库临时增加的本地权限已撤销：PASS。

候选 schema 仅保存在仓库外的审计临时目录，没有修改已提交 `schema.prisma`，没有生成可误执行的生产 migration 草案。

## 11. 回滚边界

### Drift schema 声明修正

- 无生产 DDL，因此数据库无需回滚；
- 代码层恢复旧 schema 会重新出现 drift，但不会改变数据；
- 不建议回滚，因为候选来自生产结构和 migration 事实。

### 功能 migration 后

- 尚未产生员工订单时：可回退 API/Cashier，保留 additive schema，不自动逆向 DDL；
- 已产生 `user_id IS NULL` 员工订单时：禁止恢复旧 Prisma Client，必须关闭入口并前向修复；
- 已产生 action 日志时：保留结构化字段，不能伪装成普通状态日志；
- 任何场景都不自动删除列、索引或强行把员工订单归给顾客。

## 12. 原审计时发布计划（现已完成）

已完成：

1. 用户确认真实 Drift 为 7 项，并接受“schema 对齐生产、零 Drift DDL”方案。
2. Merchant Admin 时间线按 action 展示。
3. Platform API 过滤内部动作日志。
4. 顾客 API 过滤内部动作日志，小程序页面保持冻结。
5. 为三端增加同状态动作日志契约和 UI 测试。
6. 在修复后重新运行 Prisma、API、Cashier、Admin、Miniapp 全量回归。

原审计时仍待完成、现已由第 15 节关闭：

1. 重新执行生产只读 Gate，确认 schema/data/环境变量未变化。
2. 正式部署前创建完整生产数据库、环境、PM2、Nginx 和静态 release 备份。
3. 将 schema 修正、功能 migration、API、Cashier、Admin 和时间线兼容修复作为同一受控批次发布。
4. Migration 后核对旧订单数量、NULL 分布、索引、最终空 diff 与 API/三端兼容性。

## 13. 原只读审计轮次边界

- 未执行生产 migration、DDL、`db push` 或手工改表；
- 未修改生产环境变量、Feature Flag 或商家打印开关；
- 未部署 API、Cashier、Admin；
- 未重启 PM2、Nginx；
- 未创建生产订单或 PrintJob；
- 当时未修改源码或已提交 migration；
- 未 Commit、未 Push。

## 14. 动作日志兼容与 Schema 收口实施结果

### 14.1 已实施的 Schema 声明

- `Merchant.merchantMode` 与 `MerchantBusinessType.defaultMerchantMode` 已声明为 `@default(DISPLAY)`；
- `MerchantBusinessType`、`PromotionTag`、`Capability`、`MerchantCapability`、`MerchantImage` 的 `updatedAt` 已补齐 `@default(now()) @updatedAt`；
- 保留全部历史 Merchant Mode enum 值；
- 没有新增 Drift migration，也没有生成或执行针对这 7 项的生产 `ALTER TABLE`。

### 14.2 已关闭的动作日志兼容问题

| 消费端 | 实施结果 |
|---|---|
| Merchant Admin | 三类动作按中文、越南语、英文显示“商家点菜 / 减菜 / 退菜”；普通状态继续显示状态箭头；动作行不再显示同状态箭头 |
| Platform | API 在 DTO 映射前整行过滤三类内部动作；查询不选择 `metadata/requestKey`，普通状态时间线保持 |
| 顾客 API / Miniapp | 顾客 serializer 整行过滤三类内部动作；普通状态 JSON 契约保持；小程序源码和构建产物契约不变 |
| Merchant API | 普通日志保留既有字段并移除新 `requestKey`；动作日志只返回展示白名单 metadata，并剥离不必要的订单、用户、员工内部 ID |
| Cashier | 继续使用最新 Order/TableSession 快照，不新增 statusLogs 时间线 |

这里的 `OrderStatusLog.requestKey` 是本次结构化动作日志的内部幂等字段，已从 Web 响应收口。既有 `Order.idempotencyKey` 属于另一个历史订单 DTO 契约，不在本次动作日志收口范围内。

### 14.3 最终隔离验证

在一次性本地 MySQL `8.0.46` 库中重新验证：

1. 历史 16 个 migration 从空库执行成功；
2. 16 migration 结构与仅含 7 项声明修正的候选 schema diff 为空；
3. 写入纯合成旧顾客订单、OrderItem 与普通 OrderStatusLog；
4. 功能第 17 个 migration 执行成功，旧订单和旧日志均保留；
5. `orders.user_id` 变为 nullable，四个新索引与结构化动作字段存在；
6. 可创建 `userId=NULL + createdByStaffId` 的合成员工订单及结构化动作日志；
7. 最终数据库与目标 schema diff 为 `This is an empty migration`；
8. API 全量 E2E 8 suites / 70 tests PASS；
9. 隔离库已删除，临时授权已撤销。

### 14.4 全量本地回归

| 项目 | 结果 |
|---|---|
| Prisma format / validate | PASS |
| API lint | N/A：项目没有 lint script |
| API typecheck | PASS |
| API unit | 35 suites / 331 tests PASS |
| API E2E | 8 suites / 70 tests PASS |
| API build | PASS |
| Merchant Admin action test / typecheck / build | PASS；仅保留既有 chunk-size warning |
| Cashier lint / typecheck / build | PASS |
| Cashier unit | 26 files / 178 tests PASS |
| Cashier UI | PASS；9 个 viewport、三语言、Android UA、点菜/减菜/退菜和打印禁用状态 |
| Miniapp typecheck / i18n / build | PASS；源码无修改 |

测试代码中的错误变量 `PRINTING_AUTO_TASKS_ENABLED` 已修正为真实的 `PRINTING_AUTO_CREATE_ENABLED`。自动任务创建、自动打印与旧服务器 LAN 直打仍保持关闭；执行端状态未修改。

> 本段保留发布前结论：7 项 Schema 声明与动作日志兼容的本地 Gate 已通过，当时生产功能 migration 尚未执行。最终生产结果见第 15 节。

## 15. 生产发布收口结果

### 15.1 Git、备份与构建

- 应用提交：`a5f1ee790e885c607a2eebbf2466814b060ccbc7`；生产由 `b7f056609996635ca235965c3662916a3150e052` fast-forward；
- 备份目录：`/opt/backups/huayue-item-adjustments-20260717-125138`；目录 `700`、文件 `600`；
- 数据库备份：`production-huayueyouxuan-20260717-125138.sql`，589,386 bytes，SHA-256 `c64725a20c773b61956a19e5562742ec42ca6f8dfc2c49cb91ab23fc7d490a22`；
- 34 张表、0 trigger、0 routine、0 event 与生产对象数一致；CREATE TABLE、业务 INSERT、结束标记和全部 SHA-256 校验通过；
- API `.env`、PM2、Nginx、旧 Commit、旧 Cashier release 与旧 Admin dist 均已备份；敏感内容未输出；
- 锁文件安装、Prisma Client 生成及 API/Cashier/Admin 生产构建全部通过；Admin 仅保留既有 chunk-size warning。

### 15.2 Migration 与最终结构

- 只执行既有功能 migration `20260717000000_add_staff_order_origin_and_item_audit`；
- 17/17 migration finished，0 pending，0 rolled back；
- `orders.user_id` nullable，`created_by_staff_id`、员工外键和幂等索引存在；
- `order_status_logs.action/metadata/request_key` 及动作/requestKey 索引存在；
- 发布前计数为 `orders=142`、`order_status_logs=627`、`user_id IS NULL=0`；最终计数为 `orders=143`、`order_status_logs=628`、`user_id IS NULL=0`；新增 1 单/1 普通日志来自同批发布期间正常线上流量，旧数据没有减少；
- 功能尚未在生产写入员工订单或动作日志：`created_by_staff_id IS NOT NULL=0`、`action IS NOT NULL=0`；
- 7 项 Drift 只通过 Prisma 声明收口，没有 Drift migration，没有对应生产 DDL 或数据改写；
- 生产数据库到当前 datamodel 的最终结果为 `-- This is an empty migration.`。

### 15.3 同批发布与兼容

- API 已从提交 `a5f1ee7` 构建并只重启既有 `huayue-api` 一次；PM2 `online`，`unstable_restarts=0`，没有新 Prisma/migration error；
- Cashier release：`/var/www/huayue-cashier-releases/20260717-130330-a5f1ee7-item-adjustments`，通过软链原子切换；
- Admin 构建产物：`/opt/huayue-item-adjustments-staging-20260717-125138/merchant-admin`，哈希资源先就位、`index.html` 最后原子替换；
- API、Cashier、Admin 在服务器与外部网络均为 HTTPS 200，新 JS/CSS 资源均为 200；
- Merchant Admin 生产 bundle 包含中、越、英三语动作呈现；Platform 与顾客 API 使用服务端过滤；Cashier 生产 bundle 包含点菜和菜品调整接口；
- 无凭据探测的新接口返回 401 而非 404；没有使用生产账号执行写操作；
- 因没有用户明确指定的安全测试桌台，生产点菜、减菜、退菜与 TableSession 写验收为 `NOT EXECUTED`，未创建真实营业数据；隔离库和 API E2E 已覆盖相同业务链路。

### 15.4 冻结边界与打印状态

- 小程序源码未修改，也未重新发布；顾客端兼容由 API 过滤保证；
- Android 未修改，APK 未重建；
- 自动任务创建有效值为关闭；启用且自动打印的 PrintRule 数量为 0；
- 旧服务器 LAN 直打有效值为关闭；执行端保持发布前既有状态；
- 没有创建 PrintJob，没有修改商家打印总开关、OrderStatus、订单状态机或任何超范围业务。

生产收口结论：`PASS`。
