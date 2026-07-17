# 商家点菜、减菜、退菜 V1：Migration 与发布 Gate 报告

日期：2026-07-17
本地开发基线：`main@20ea4423afd3ef7e17e17423d6117d6d66dfdcd2`
生产审计基线：`b7f056609996635ca235965c3662916a3150e052`
当前结论：**本地实现与隔离验证通过；生产发布 Gate 因既有 schema drift 停止，未执行生产写入。**

本报告明确区分本地已完成能力和生产状态。生产数据库没有执行本次 migration，生产 API、Cashier 静态站点和 PM2 均未切换。

## 1. 已批准的数据结构

本次继续使用全平台唯一的 `Order`、`OrderItem`、`OrderStatusLog` 和 `TableSession`，没有建立第二套订单或桌账模型。

### 1.1 `Order`

| 变更 | 目的 | 兼容性 |
|---|---|---|
| `userId BigInt?` | 员工追加订单不伪装成任一小程序顾客 | 旧顾客订单值不变 |
| `createdByStaffId BigInt?` | 保存员工追加订单创建者 | 新增可空列，旧数据为 `NULL` |
| `createdByStaff` 外键 | 复用现有 `MerchantStaff` | `ON DELETE RESTRICT` |
| `(merchantId, createdByStaffId, idempotencyKey)` 唯一索引 | 员工点菜防重复 | 不替代原顾客幂等索引 |
| `(createdByStaffId, createdAt)` 普通索引 | 员工来源审计 | 纯新增索引 |

服务层强制以下 XOR 不变量：

- 顾客订单：`userId` 非空且 `createdByStaffId` 为空；
- 员工追加订单：`userId` 为空且 `createdByStaffId` 非空；
- 员工必须处于启用状态，且 `MerchantStaff.merchantId` 与订单商家一致。

MySQL 8.0.46 不允许在两个带参照动作的外键列上增加所需 XOR `CHECK`。因此没有削弱现有外键语义，XOR 由统一服务事务验证，并有单元及 E2E 覆盖。

### 1.2 `OrderStatusLog`

| 变更 | 目的 | 兼容性 |
|---|---|---|
| `action VARCHAR(64) NULL` | 标识点菜、减菜、退菜动作 | 旧状态日志为 `NULL` |
| `metadata JSON NULL` | 保存数量、金额和操作者快照 | 旧状态日志为 `NULL` |
| `requestKey VARCHAR(64) NULL` | 调整请求幂等键 | 旧状态日志为 `NULL` |
| `(orderId, requestKey)` 唯一索引 | 同一订单同一调整只执行一次 | MySQL 允许多个旧 `NULL` |
| `(action, createdAt)` 普通索引 | 结构化动作审计 | 纯新增索引 |

减菜和退菜使用同状态日志：`fromStatus = toStatus = 当前订单状态`。它们不会调用状态转换打印 outbox。

### 1.3 明确未增加

- 未修改 `OrderStatus`；
- 未增加 `OrderItem` 退菜字段；
- 未给 `TableSession` 增加金额快照；
- 未增加 `ReceiptType` 或退菜单；
- 未增加账号、角色、权限、打印或 Android 数据模型。

Migration 文件：

`apps/api/prisma/migrations/20260717000000_add_staff_order_origin_and_item_audit/migration.sql`

## 2. 隔离数据库验证

所有写入验证均在本机 Docker MySQL `8.0.46`、`127.0.0.1:3307` 的一次性数据库完成。连接地址有本地端口保护，没有连接生产数据库，也没有导入生产业务数据。

### 2.1 旧数据升级

复验时使用隔离库 `huayue_item_adjustments_upgrade_final_20260717_02`，验证完成后已删除。

1. 从空库执行基线 16 个历史 migration：PASS。
2. 写入纯合成 Merchant、Staff、User、DiningTable、OPEN TableSession、顾客 Order、OrderItem 和旧 OrderStatusLog：PASS。
3. 执行本次第 17 个 migration：PASS。
4. 旧顾客订单 `userId`、数量和金额保持不变；`createdByStaffId/action/metadata/requestKey` 为 `NULL`：PASS。
5. 创建 `userId=NULL + createdByStaffId` 的员工订单并归入原 TableSession：PASS。
6. 写入结构化 `MERCHANT_ADD_ITEMS` 日志：PASS。
7. 顾客原幂等索引拒绝重复请求：PASS。
8. 员工幂等索引拒绝重复请求：PASS。
9. `(orderId, requestKey)` 拒绝重复动作日志：PASS。
10. 不存在的员工外键被拒绝：PASS。

### 2.2 全量 migration 链与 drift

- 全新空库从零执行全部 17 个 migration：PASS。
- `prisma validate`：PASS。
- `prisma migrate status`：`Database schema is up to date`。
- 旧数据升级库与全新 17-migration 数据库执行 schema diff：`This is an empty migration`。

结论：本次 migration 没有引入额外 drift，旧数据升级结果与从零建库结果一致。

## 3. API 实现

### 3.1 员工点菜

接口：`POST /api/v1/merchant/tables/:tableId/orders`

- 使用现有 Merchant JWT、`MerchantRoleGuard` 和 OWNER/MANAGER/STAFF；
- 只允许当前商家 ACTIVE 桌台的当前 OPEN `TableSession`；
- 创建新的普通 `DINE_IN / PENDING_ACCEPTANCE` Order，不修改旧订单；
- 商品可售状态、分类状态和最终价格全部由服务端读取；
- 使用精确桌台/会话行锁，不做 merchant-wide session 扫描锁；
- 保存 `createdByStaffId`，`userId=NULL`；
- 写入 `MERCHANT_ADD_ITEMS` 结构化日志；
- 相同员工、相同 key、相同规范化 payload 返回同一订单；不同 payload 返回冲突。

### 3.2 未接单减菜

接口：`PATCH /api/v1/merchant/orders/:orderId/items/:itemId/quantity`

- 仅 `PENDING_ACCEPTANCE + OPEN TableSession`；
- 校验 `expectedQuantity`，只允许减少；
- 在同一事务按 session → order → request log → 全部 items 的确定顺序加锁；
- 重算 item subtotal、订单 `itemAmountVnd` 和 `totalAmountVnd`；
- 写 `ORDER_ITEM_DECREASED` 结构化日志；
- 最后一项减到 0 时复用共享事务取消逻辑，订单转 `CANCELLED`，TableSession 保持 OPEN。

### 3.3 已接单退菜

接口：`POST /api/v1/merchant/orders/:orderId/items/:itemId/return`

- 仅店内 `ACCEPTED / PREPARING / READY + OPEN TableSession`；
- 不接收原因、审批或退款字段；
- 校验当前数量并在同一事务重算金额；
- 写 `ORDER_ITEM_RETURNED` 结构化日志；
- 禁止把已送厨房订单的最后一个有效菜品全部退掉；
- 打印失败或打印未实现不会回滚退菜。

### 3.4 顾客隔离与 nullable 兼容

- 顾客列表、详情、取消和聊天都继续按非空 `userId` 隔离；
- 员工订单不能创建顾客聊天，返回 `STAFF_ORDER_CUSTOMER_CHAT_UNAVAILABLE`；
- 平台顾客统计显式忽略 `userId=NULL` 的员工订单；
- 顾客 list/detail/create/cancel/confirm-received 响应剥离新增内部字段 `createdByStaffId`；
- 顾客响应内的 status log 剥离 `action/metadata/requestKey`；
- 商家订单接口仍保留完整审计数据。

因此小程序现有订单响应结构未因本次新增数据库字段而扩大。

## 4. Web 收银台实现

- OPEN 桌台详情底部增加“点菜”，CLOSED 桌账不显示；
- 点菜工作区包含分类、搜索、菜品、数量、备注、已选数量、总额和固定操作栏；
- 点菜成功创建新订单并刷新订单与桌账，不改旧订单；
- PENDING 订单显示减菜，不能在旧订单内加数量；
- ACCEPTED/PREPARING/READY 显示无原因退菜弹窗；
- COMPLETED/CANCELLED/DELIVERING 不显示调整入口；
- 中文、越南语、英文文案同步；
- 1280×800、紧凑横屏、平板和 Android WebView UA 已覆盖。

写操作可靠性：

- 只有明确 4xx 才释放 request key；网络错误、408、429、5xx 和未知传输异常均保留原 key/payload；
- 点菜重试冻结并使用提交时的原 `tableId + payload + idempotencyKey`；
- 减菜与退菜重试冻结原数量和 requestKey，不根据回读数量推断成功；
- 强制刷新使用 revision 隔离，旧轮询响应不能覆盖 mutation 快照；
- 减到 0 后菜品行消失时仍有 Shell 级同 key 恢复入口；
- 未决写操作会阻止误关、路由切换、登出和页面离开；登录会话真实失效时允许返回登录页。

Fixture 只在显式 `VITE_CASHIER_USE_FIXTURES=true` 的测试会话启用，生产默认仍关闭。

## 5. 金额、桌账和打印边界

- `TableSession` 继续动态汇总关联订单；没有新增桌账金额字段。
- `CANCELLED` 订单继续从桌账金额中排除。
- 顾客订单和员工追加订单可共同归入同一 TableSession。
- 追加订单接单后继续沿用普通订单的既有手动打印链路。
- 本轮没有退菜单、自动打印、USB/LAN/云打印或 Connector 改动。
- 自动任务创建、自动打印和旧服务器 LAN 直打均未在本轮开启。

## 6. 本地回归结果

| 项目 | 结果 |
|---|---|
| Prisma format / validate | PASS |
| 旧数据升级 + 全量 migration 链 | PASS |
| API lint | 项目无 lint script；以 typecheck、unit、E2E、build 和 diff-check 替代 |
| API typecheck | PASS |
| API unit | 34 suites / 330 tests PASS |
| API 聚焦 E2E | 5 suites / 43 tests PASS |
| API 全量 E2E | 8 suites / 68 tests PASS |
| API build | PASS |
| Cashier lint | PASS |
| Cashier typecheck | PASS |
| Cashier unit | 26 files / 178 tests PASS |
| Cashier test:ui | PASS（9 个 viewport，含 1280×800、三语言和 Android UA） |
| Cashier build | PASS |
| merchant-admin typecheck / build | PASS（保留既有 chunk size warning） |
| miniapp typecheck / i18n / build | PASS |
| `git diff --check` | PASS |

Cashier UI 测试实际执行 Fixture 链：点菜新 Order → 减菜 → 接单 → 退菜，并验证订单列表和 TableSession 金额同步变化。它不代表生产业务写入。

全量 E2E 复验前仅稳定了既有测试夹具：测试进程显式开启并恢复点餐 Flag、微信二维码请求使用本地确定性 mock、员工创建 DTO 使用合法唯一测试手机号。上述变更只在 `apps/api/test`，没有修改账号、二维码或点餐业务实现，也没有访问真实微信服务。

## 7. 生产只读审计与停止原因

生产服务器：`43.161.202.113`，项目 `/opt/HuayueLife-MVP`，PM2 进程 `huayue-api`。

只读审计结果：

- 生产工作树干净；
- 生产 commit：`b7f056609996635ca235965c3662916a3150e052`；
- `huayue-api`：online；
- MySQL：`8.0.46`；
- 已完成 migration：16，无 failed migration；
- `orders`：141 行；
- `order_status_logs`：622 行；
- `orders.user_id IS NULL`：0；
- 本次新列、新外键和新索引：尚不存在；
- `/opt` 可用空间约 50.9 GB。

DDL 影响估算：`orders` 需要把既有 `user_id` 改为可空，并新增可空列、外键及两个索引；`order_status_logs` 需要新增三个可空列及两个索引。按当前 141/622 行规模，数据扫描量较小，但 MySQL DDL 仍可能获取 metadata lock，并受线上长事务影响。本次没有在生产执行 DDL，因此没有把该估算当作安全放行依据。

审计同时确认 6 项早于本次功能的生产 schema drift：

1. `capabilities.updated_at` 的数据库默认/ON UPDATE 与 Prisma `@updatedAt` 表达不一致；
2. `promotion_tags.updated_at` 同类不一致；
3. `merchant_capabilities.updated_at` 同类不一致；
4. `merchant_images.updated_at` 同类不一致；
5. `merchant_business_types.default_merchant_mode`：数据库默认 `DISPLAY`，schema 为 `DISPLAY_ONLY`；
6. `merchants.merchant_mode`：数据库默认 `DISPLAY`，schema 为 `DISPLAY_ONLY`。

这些差异不是本次 migration 产生，但原指令规定发现生产 drift 必须立即停止。因此：

- 未创建本轮生产部署备份；
- 未拉取新 commit；
- 未执行 production migration；
- 未构建或切换生产 API、Cashier 或 Admin；
- 未重启 PM2/Nginx；
- 未写入任何生产订单、桌台、TableSession 或日志。

Migration、API 与 Cashier 均未部署，未形成“只迁移数据库”或“只发布 Web/API”的半批状态；生产 Admin 也保持原发布版本。

当前数据库账号读取 `information_schema.innodb_trx` 需要 PROCESS 权限；按既有安全约束没有申请或授予该权限。由于 drift Gate 已先失败，不以此绕过停止条件。

## 8. 回滚边界

当前生产未部署，因此无需执行回滚，线上仍保持审计前状态。

未来重新通过 Gate 后：

- 即使 migration 成功，也优先回退 API commit 和 Cashier release、保留 additive schema，不自动执行逆向 DDL；
- 只有同时确认以下数据均为 0，才可另行评估恢复 `user_id NOT NULL` 或删除新增列：
  - `orders.user_id IS NULL`；
  - `orders.created_by_staff_id IS NOT NULL`；
  - `order_status_logs.action/metadata/request_key` 任一非空；
- 一旦产生员工订单或结构化动作日志，只能隐藏入口并做前向修复，禁止恢复旧 Prisma Client、强行归属顾客或自动逆向 DDL。

## 9. 最终 Gate 状态

```text
本地 schema/migration：PASS
本地 API：PASS
本地 Cashier：PASS
顾客/小程序兼容：PASS
生产只读预检：FAIL（既有 schema drift）
生产备份：未开始
生产 migration：未执行
生产 API/Cashier：未部署
生产服务：未被本轮修改，审计时 huayue-api online
```

> 商家点菜、减菜、退菜发布 Gate 已停止。未单独遗留不兼容的 Web 或 API 发布；生产数据库、回滚状态和当前服务健康情况已在报告中说明。
