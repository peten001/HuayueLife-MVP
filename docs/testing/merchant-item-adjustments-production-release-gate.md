# 商家点菜、减菜、退菜 V1：Schema 与动作日志兼容同批发布 Gate

日期：2026-07-17

发布基线：`main@f0f1d71c2e0e08be815c465f1a8bd94f5b34033d`

目标提交：本报告与 Schema/动作日志兼容修复所在的 `fix(orders): align schema and action log timelines` 提交；实际 SHA 由提交 Gate 与生产部署记录确认。

生产发布前基线：`b7f056609996635ca235965c3662916a3150e052`

本报告记录 7 项 Prisma 声明收口、OrderStatusLog 三端兼容、既有功能 migration 以及 API、Cashier、Admin 同批发布 Gate。Android、小程序页面和打印执行状态不在发布范围。

## 1. Schema 收口

真实 Drift 为 7 项：

1. `capabilities.updated_at`
2. `promotion_tags.updated_at`
3. `merchant_business_types.updated_at`
4. `merchant_capabilities.updated_at`
5. `merchant_images.updated_at`
6. `merchant_business_types.default_merchant_mode`
7. `merchants.merchant_mode`

处理方式：

- 五个 `updatedAt` 补齐 `@default(now()) @updatedAt`；
- 两个 Merchant Mode 默认声明改为 `DISPLAY`；
- 保留 `DISPLAY_ONLY / PRODUCT_DISPLAY / ONLINE_ORDER / QR_ORDER` 等历史 enum 值；
- 当前规范值继续为 `DISPLAY / MANAGED`；
- 没有新增 Drift migration；
- 不对生产 7 项字段执行 DDL 或数据改写；
- 不使用 `prisma db push`。

## 2. 功能 Migration

唯一功能 migration：

```text
20260717000000_add_staff_order_origin_and_item_audit
```

它只包含已确认的 additive/compatible 变更：

- `orders.user_id` 改为 nullable；
- 新增 `orders.created_by_staff_id`、外键与员工幂等索引；
- 新增 `order_status_logs.action/metadata/request_key` 与索引；
- 旧顾客订单和旧日志不改值；
- 不修改 `OrderStatus`、`DiningTable` 或 `TableSession` 结构。

## 3. 动作日志兼容

### Merchant Admin

- `MERCHANT_ADD_ITEMS` 显示“商家点菜”；
- `ORDER_ITEM_DECREASED` 显示菜品名称及前后数量；
- `ORDER_ITEM_RETURNED` 显示菜品名称及退菜数量；
- 中文、越南语、英文均覆盖；
- 普通状态日志继续显示状态箭头；
- 动作行不显示同状态箭头、`requestKey` 或内部 ID。

### Platform

- 第一版在 API 映射中整行过滤三类内部动作；
- 普通状态时间线不变；
- 查询不选择 `metadata/requestKey`；
- 平台页面不需要新增菜品级动作 UI。

### 顾客 API / Miniapp

- 顾客 serializer 整行过滤三类内部动作；
- 普通状态日志 JSON 结构不变；
- 员工订单继续不能进入顾客列表、详情、取消或聊天；
- 小程序源码不修改、不重新发布。

### Merchant API

- 普通状态日志保留既有字段，仅移除新增的 `OrderStatusLog.requestKey`；
- 动作日志只返回 `productName/beforeQuantity/afterQuantity/returnedQuantity` 白名单；
- 动作日志剥离不必要的订单、用户、员工内部 ID；
- 既有 `Order.idempotencyKey` 是另一个历史订单 DTO 字段，不在本次动作日志收口范围。

## 4. 隔离数据库验证

环境：本地 Docker MySQL `8.0.46`，端口 3307，一次性数据库；没有导入生产业务数据。

| 验证 | 结果 |
|---|---|
| 历史 16 个 migration 从空库执行 | PASS |
| 16 migration 结构与 7 项候选声明 diff | `This is an empty migration` |
| 合成旧顾客订单、OrderItem、旧普通日志 | PASS |
| 功能第 17 个 migration | PASS |
| 旧订单及旧日志保留 | PASS |
| nullable userId、新列、外键与 4 个索引 | PASS |
| 合成员工订单与结构化动作日志 | PASS |
| 最终数据库与目标 schema diff | `This is an empty migration` |
| 隔离库与临时权限清理 | PASS |

## 5. 本地回归

| 检查 | 结果 |
|---|---|
| Prisma format / validate | PASS |
| API lint | N/A：没有 lint script |
| API typecheck | PASS |
| API unit | 35 suites / 331 tests PASS |
| API E2E | 8 suites / 70 tests PASS |
| API build | PASS |
| Merchant Admin action test | PASS |
| Merchant Admin typecheck / build | PASS；仅既有 chunk-size warning |
| Cashier lint / typecheck / build | PASS |
| Cashier unit | 26 files / 178 tests PASS |
| Cashier UI | PASS；9 个 viewport、三语言、Android UA、点菜/减菜/退菜、打印禁用 |
| Miniapp typecheck / i18n / build | PASS |
| Miniapp 源码 diff | 无 |

测试变量已从错误的 `PRINTING_AUTO_TASKS_ENABLED` 修正为 `PRINTING_AUTO_CREATE_ENABLED`。

## 6. 打印与未修改边界

- 自动任务创建保持关闭；
- 自动打印保持关闭；
- 旧服务器 LAN 直打保持关闭；
- 执行端保持既有状态；
- 不修改打印 outbox、Printer READY、USB Connector；
- 不修改 Android 源码，不重建 APK；
- 不修改或发布小程序；
- 不修改 `OrderStatus`；
- 不增加退菜原因、审批、退菜单、转桌、并桌、折扣、支付或库存。

## 7. 生产备份与发布记录

本节在完成生产 Gate 后记录，不以占位内容代替验证：

| 项目 | 结果 |
|---|---|
| 生产只读 Gate | 待执行 |
| 备份目录 | 待执行 |
| 数据库备份及 SHA-256 | 待执行 |
| API env / PM2 / Nginx 备份 | 待执行 |
| Cashier/Admin release 备份 | 待执行 |
| 功能 migration | 待执行 |
| API source commit | 待执行 |
| Cashier release | 待执行 |
| Admin release | 待执行 |
| 最终生产 Prisma diff | 待执行 |
| API/Cashier/Admin/PM2 | 待执行 |

## 8. 回滚边界

### 尚未产生员工订单

- 回退 API commit；
- 原子切回 Cashier/Admin 旧 release；
- 保留 additive schema；
- 不自动执行逆向 DDL。

### 已产生 `user_id=NULL` 员工订单或动作日志

- 禁止恢复旧 Prisma Client；
- 禁止删除新增列或索引；
- 禁止强行把员工订单归给顾客；
- 关闭新入口并前向修复。

## 9. Gate 结论

本地 Schema、兼容代码和全量回归：`PASS`。

生产状态：必须完成只读复核、完整备份、同批 migration/API/Cashier/Admin 发布、最终空 diff 与兼容冒烟后才能标记完成。
