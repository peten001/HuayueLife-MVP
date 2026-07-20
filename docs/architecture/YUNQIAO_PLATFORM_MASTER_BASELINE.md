# 云桥 Life 全平台唯一 Master Baseline

## Codex 开发前强制要求

> 开始任何云桥 Life 开发前，必须完整读取本文件。
> 未经用户明确“讨论 OK”，不得开始修改。
> 不得新增第二套账号、权限、订单、桌台、TableSession、状态机、API 或数据库逻辑。
> 商家后台变更必须同时检查电脑端与手机端。
> Android 只允许增加 Web 无法完成的本地硬件能力。
> 当前线上小程序为审核通过稳定版，未经“小程序新版发布 Gate”不得修改。

任何开发前检查项不清楚时，必须停止开发并向用户报告；不得用推测补齐产品、运行或生产事实。

## 1. 文档权威性

| 项目 | 基准 |
|---|---|
| 文档状态 | <code>FORMAL / MASTER BASELINE</code> |
| 生效日期 | 2026-07-17（Asia/Ho_Chi_Minh） |
| 权威范围 | 产品边界、六端职责、唯一业务底座、数据与 API 原则、打印与 Android 边界、发布与验证 Gate |
| 源码事实截止点 | <code>dc998ad601e8f2019e6a683202225a58a849ef16</code> |
| 生产 checkout HEAD | <code>main@dc998ad601e8f2019e6a683202225a58a849ef16</code> |
| 当前应用发布来源 | <code>a5f1ee790e885c607a2eebbf2466814b060ccbc7</code>；<code>dc998ad</code> 仅追加发布报告 |
| Android RC3 来源 | <code>bc24dcdefdd41422be081fbd4ef8e6f675b4c246</code>；Tag <code>merchant-terminal-android-v1.0.0-rc3</code> |
| 文档提交 | 以包含本文件的 Git commit 为准 |
| 唯一源码目录 | <code>/Users/peter/Desktop/HuayueLife-MVP</code> |
| 原 GitHub | <code>peten001/HuayueLife-MVP</code> |

### 1.1 文档用途

本文件是以后 Codex 开发云桥 Life 时首先读取的唯一主架构基准。正式决策细节见
[YUNQIAO_PLATFORM_AUDIT_DECISIONS.md](YUNQIAO_PLATFORM_AUDIT_DECISIONS.md)，待办、风险和验证缺口见
[YUNQIAO_PLATFORM_TECH_DEBT_AND_RISKS.md](YUNQIAO_PLATFORM_TECH_DEBT_AND_RISKS.md)。

### 1.2 状态词

| 状态 | 含义 |
|---|---|
| 目标基准 | 已确认的产品/架构方向；后续实现不得偏离 |
| 当前已实现 | 当前代码或运行证据已证明存在 |
| 已上线待人工验证 | 代码和生产发布已完成，但无生产真实业务人工验收证据 |
| 已确认待修 | 用户已确认必须修复，当前代码尚未完成 |
| 暂缓 | 问题或目标已确认，但当前稳定版保护或发布范围禁止处理 |
| 现场待验证 | 只能通过设备、网络或门店现场证明，当前仍无证据 |
| UNKNOWN | 现有证据不足；不得改写为 PASS |

自动化测试、隔离库测试、HTTP 200、代码存在和构建成功，均不得替代生产真实业务人工验收。

### 1.3 证据优先级

1. 2026-07-17 恢复指令中的用户最终确认和最新现场事实。
2. 当前 <code>dc998ad</code> 代码、Git/Tag 和 2026-07-17 非敏感生产只读核验。
3. 最终生产发布与 Schema Drift 收口报告。
4. 2026-07-16 两轮审计草稿，作为问题来源与历史证据。
5. 更早的 RC1/RC2、预检、未填写清单只保留历史身份，不得覆盖更新后的事实。

冲突时不得无声选取旧结论；必须按上述优先级记录，并在无法消除时标为 <code>UNKNOWN</code>。

## 2. 产品范围与全平台结构

云桥 Life 是一个共享业务底座的六端系统，不是六套独立业务。

~~~mermaid
flowchart LR
    Miniapp[微信小程序]
    MerchantPC[商家后台电脑端]
    MerchantMobile[商家后台手机端]
    Cashier[Web 收银台]
    Android[Android WebView]
    Platform[平台后台]
    API[同一个 NestJS API]
    DB[(同一个 MySQL 生产数据库)]
    USB[本地 USB 打印机]

    Miniapp --> API
    MerchantPC --> API
    MerchantMobile --> API
    Cashier --> API
    Android -->|同一 Web 业务与商家会话| API
    Platform --> API
    API --> DB
    Android -->|本地硬件能力| USB
~~~

代码入口证据：唯一 API 在
[apps/api](../../apps/api)，商家与平台后台共用
[merchant-admin 路由](../../apps/merchant-admin/src/router/index.ts#L99)，独立收银台使用
[merchant-cashier 路由](../../apps/merchant-cashier/src/router/index.ts#L12)，小程序页面由
[pages.json](../../apps/miniapp/src/pages.json#L1) 定义，Android 位于
[apps/merchant-terminal-android](../../apps/merchant-terminal-android)。

## 3. 六端固定定位

| 端 | 目标基准 | 当前事实 | 明确禁止 |
|---|---|---|---|
| 微信小程序 | 顾客端：商家展示、扫码点餐、独立购物车、独立下单、只看自己的订单；同桌订单归入同一 TableSession；不显示整桌账单 | 审核通过稳定版；当前页面、路由和线上契约受保护 | 整桌账单、商家经营操作、未经新版 Gate 修改审核逻辑 |
| 商家后台电脑端 | 完整餐厅运营端：工作台、订单、桌台、TableSession、菜品分类、营业设置、员工、权限、消息、打印配置和历史 | <code>apps/merchant-admin</code> 同一 SPA 的商家区域 | 复制另一套手机业务规则或数据 |
| 商家后台手机端 | 与电脑端功能、数据、权限、API、业务规则一致，只允许 UI 适配差异 | 与电脑端共用 SPA、路由和 API | 手机专用 Order、权限、API 或数据库逻辑 |
| Web 收银台 | 店员高频端：新订单、接单/拒单、制作/完成、桌台、TableSession、桌账、点菜/减菜/退菜、手动打印 | 生产已上线上述能力、三语言和右侧详情优化 | 变成第二套商家后台；复制员工、商品或状态机 |
| Android APP | 同一 Web 收银台 WebView + Android 本地硬件能力 | RC3 使用正式 Cashier/API；本地 USB Connector 已现场验证 | 独立账号、Terminal Token、绑定码、设备账号、原生订单/桌台、第二套 API |
| 平台后台 | 平台管理员创建商家和主账号，管理商家状态、展示和平台能力，提供平台级诊断 | 位于 <code>merchant-admin</code> 的 <code>/platform/*</code>，由平台账号 Guard 隔离 | 代替商家执行日常经营配置或建立另一套商家模型 |

固定权责：

~~~text
平台后台决定有没有能力
→ 商家后台在授权范围内配置
→ Web 收银台使用能力
→ Android 执行 Web 无法完成的本地硬件能力
~~~

## 4. 全平台唯一业务底座

以下对象必须全平台共享：

- 同一个 API 与同一个生产数据库；
- 同一个 <code>Merchant</code> 经营作用域；
- 同一套商家主账号、员工账号、角色和权限；
- 同一个 <code>Category</code> / <code>Product</code>；
- 同一个 <code>Order</code> / <code>OrderItem</code> / <code>OrderStatusLog</code>；
- 同一个 <code>DiningTable</code> / <code>TableSession</code>；
- 同一个订单状态机；
- 同一个打印任务中心。

核心模型证据见
[schema.prisma](../../apps/api/prisma/schema.prisma#L287)：
<code>Merchant</code> 从第 287 行开始，<code>MerchantStaff</code> 从第 511 行开始，
<code>Category/Product</code> 从第 535/552 行开始，
<code>DiningTable/TableSession</code> 从第 576/597 行开始，
<code>Order/OrderItem/OrderStatusLog</code> 从第 657/709/729 行开始，
新打印模型从第 873 行开始。

禁止新增：

- 第二套商家账号、员工、角色或权限；
- Cashier、Android 或手机后台专用订单/桌台/TableSession；
- Android 专用业务订单 API；
- 同一业务动作的第二套状态机；
- 打印失败驱动订单状态改变；
- 为规避兼容问题复制数据库字段或服务逻辑。

## 5. 账号、登录与权限

### 5.1 唯一账号体系

| 账号 | 模型/身份 | 创建与登录 | 基准 |
|---|---|---|---|
| 平台管理员 | <code>PLATFORM_ADMIN</code> | 平台独立登录 | 只管理平台范围 |
| 商家主账号 | <code>MerchantStaff / OWNER</code> | 平台创建；统一商家登录 | 初始密码固定 <code>12345678</code>，首次必须改密 |
| 商家员工 | <code>MerchantStaff / MANAGER 或 STAFF</code> | OWNER 创建；与主账号同一登录 | 保持当前：创建时 OWNER 输入初始密码，重置时系统生成随机临时密码；均标记首次改密 |
| 顾客 | <code>USER</code> | 微信登录 | 与商家/平台身份隔离，只能访问本人数据 |
| Android | 不创建账号 | 复用 Web 收银台 MerchantStaff 会话 | 不得增加设备账号、配对码或 Terminal Token |

账号类型证据见
[auth-user.type.ts](../../apps/api/src/common/types/auth-user.type.ts#L1)。
OWNER 默认密码与首次改密证据见
[platform-merchants.service.ts](../../apps/api/src/modules/platform/platform-merchants.service.ts#L603)；
员工创建和随机重置证据见
[merchant-staff.service.ts](../../apps/api/src/modules/merchant-staff/merchant-staff.service.ts#L36)。

### 5.2 角色基准

| 操作 | OWNER | MANAGER | STAFF |
|---|---:|---:|---:|
| 员工管理 | 是 | 否 | 否 |
| 菜品/分类/桌台配置 | 是 | 是 | 否；可进行获准的业务使用 |
| 订单与桌账高频操作 | 是 | 是 | 是 |
| 打印机、规则、模板配置 | 是 | 是 | 否 |
| 查看打印状态、手动打印、补打 | 是 | 是 | 按权限允许 |
| 平台打印总能力 | 否 | 否 | 否；仅平台可开关 |

员工管理仅 OWNER 的 Controller 证据见
[merchant-staff.controller.ts](../../apps/api/src/modules/merchant-staff/merchant-staff.controller.ts#L22)。
打印权限的最终产品边界以 D10 为准，后续实现必须逐 API 复核。

### 5.3 已确认待修

- D01：员工停用/删除后，旧登录状态必须立即失效。
- D02：员工降权或改密后，旧权限与旧登录必须立即失效。
- D03：主账号首次改密前只允许最小 API 集合。

当前普通
[JwtAuthGuard](../../apps/api/src/common/guards/jwt-auth.guard.ts#L12)
仅验证 Token，
[MerchantRoleGuard](../../apps/api/src/common/guards/merchant-role.guard.ts#L13)
读取 JWT 内角色；打印中心的
[ActiveMerchantStaffGuard](../../apps/api/src/modules/printing/guards/active-merchant-staff.guard.ts#L16)
才实时查询员工。故 D01–D03 状态为“已确认待修”，不得写成当前已实现。

## 6. 微信小程序审核稳定版保护

当前线上微信小程序属于腾讯/微信审核通过稳定版。任何后端开发必须兼容当前线上小程序。

当前阶段禁止修改：

- <code>apps/miniapp</code>；
- 审核安全页面和审核文案；
- 点餐入口隐藏逻辑；
- 菜单、购物车、结算、订单入口现有灰度逻辑；
- Feature Flag、白名单；
- 二维码 scene；
- 线上小程序请求/响应契约；
- 已审核导航和页面结构。

下列任一变化必须进入“小程序新版发布 Gate”：

1. 修改 <code>apps/miniapp</code>、页面或路由；
2. 修改 Feature Flag、白名单、点餐入口或审核逻辑；
3. 修改 scene；
4. 修改小程序请求或响应契约；
5. 修改登录、菜单、购物车、结算或订单交互；
6. 修改审核文案或已审核导航结构。

2026-07-17 点菜/减菜/退菜发布中，小程序源码未修改、未重新发布，兼容由顾客 API 过滤内部动作日志保证；证据见
[生产 Schema Drift 收口报告](../testing/production-schema-drift-closure-audit.md#L576)。

已知小程序敏感日志、scene 随机化、能力字段统一等事项状态为“暂缓”，只可在小程序新版 Gate 中处理；D06 的纯后端限流/严格校验可以另行设计，但必须保持现有 scene/API 兼容。

## 7. 平台能力与 Feature Flag

| 能力/Flag | 权威与写入者 | 当前状态 | 目标/约束 |
|---|---|---|---|
| <code>PlatformSetting.platformOrderingEnabled</code> | 平台全局订单 Gate；平台写 | 生产已启用 | 关闭时 QR/Cart/Order 必须服务端 fail-closed |
| <code>MerchantCapability.qrOrderEnabled</code> | 平台授予扫码点餐能力 | 当前 QR 与 Cart/Order 读取尚未完全统一 | 目标已确认；统一暂缓 |
| <code>tableManagementEnabled</code> | 平台授予桌台能力 | 页面与服务端表达仍待统一 | 明确定义为桌台能力 |
| <code>Merchant.dineInEnabled</code> | 商家实际提供堂食的业务属性 | 当前服务端仍参与堂食判断 | 不与 qrOrderEnabled 混为同义字段 |
| 未来扫码点餐总条件 | 平台订单能力 + qrOrderEnabled + tableManagementEnabled + dineInEnabled | 目标基准 | 当前不改小程序/API 判断 |
| <code>Merchant.printingEnabled</code> | 平台打印总能力唯一数据库权威；仅平台写 | 生产按该字段管理 | 所有正式执行 Gate 必须实时校验 |
| <code>PRINTING_TASK_CENTER_ENABLED</code> | 部署 Flag | 当前开启 | 新打印中心总 Gate |
| <code>PRINTING_AUTO_CREATE_ENABLED</code> | 部署 Flag | 当前关闭 | 未单独批准不得开启 |
| <code>PRINTING_EXECUTION_ENABLED</code> | 部署 Flag | 当前保持开启 | 仍须叠加 Merchant 与 READY Gate |
| <code>LEGACY_PRINTING_ENABLED</code> | Legacy 部署 Flag | 当前关闭 | 永久不作为正式方案 |

全局订单 Gate 证据见
[app-config.service.ts](../../apps/api/src/modules/app-config/app-config.service.ts#L8)。
当前 QR 双来源证据见
[qr.service.ts](../../apps/api/src/modules/qr/qr.service.ts#L18)；
堂食 Cart 判断见
[cart.service.ts](../../apps/api/src/modules/cart/cart.service.ts#L139)。
打印 Flag 默认和互斥保护见
[printing-feature-flags.service.ts](../../apps/api/src/modules/printing/services/printing-feature-flags.service.ts#L24)。

## 8. 商品、订单与动作日志

### 8.1 Product / Category

- <code>Category</code> 与 <code>Product</code> 是全平台唯一商品底座；
- 商家后台 OWNER/MANAGER 管理，其他端只按职责读取和使用；
- 小程序、Cashier、Android 不得复制商品事实源；
- 价格与可售状态必须由服务端权威读取，不信任客户端提交价格。

### 8.2 Order / OrderItem

- <code>Order</code> 是唯一订单模型；
- 顾客订单：<code>userId</code> 非空，<code>createdByStaffId</code> 为空；
- 员工点菜订单：<code>userId=null</code>，<code>createdByStaffId</code> 为当前员工；
- <code>OrderItem</code> 保存商品名称、价格和数量快照；
- 状态动作必须复用既有 Service，在事务中原子更新并写 <code>OrderStatusLog</code>；
- 顾客列表、详情、取消和聊天继续按非空 <code>userId</code> 隔离。

nullable user 与员工来源字段证据见
[schema.prisma](../../apps/api/prisma/schema.prisma#L657)。

### 8.3 OrderStatusLog

- 普通状态变化继续记录 <code>fromStatus → toStatus</code>；
- 点菜、减菜、退菜使用结构化 <code>action/metadata/requestKey</code>；
- Merchant Admin 正确显示“商家点菜 / 减菜 / 退菜”；
- Platform 与顾客 API 整行过滤内部动作日志；
- Cashier 使用最新 Order/TableSession 快照，不新增重复状态时间线；
- 动作日志不得重复触发通知、统计或打印。

生产兼容证据见
[生产 Schema Drift 收口报告](../testing/production-schema-drift-closure-audit.md#L493)。

## 9. DiningTable、TableSession 与完成桌账

- <code>DiningTable</code> 是唯一桌台模型；
- 同一桌的顾客订单和员工点菜订单进入同一个当前 OPEN <code>TableSession</code>；
- 一桌最多一个开放桌账，由唯一键、事务和锁保证；
- 顾客端只看自己的订单，不读取整桌账单；
- 商家后台和收银台按职责读取整桌账单；
- 关闭前若仍有未完成订单，服务端拒绝关闭；
- 完成桌账只等于：关闭 TableSession，并使桌台恢复空闲；
- 完成桌账不等于现金、线上或其他支付成功，也不等于已经登记收款。

关闭逻辑证据见
[table-sessions.service.ts](../../apps/api/src/modules/table-sessions/table-sessions.service.ts#L137)。
D14 已固化上述语义，不得自行把 <code>settlementStatus</code> 变成关闭前提或支付事实。

## 10. 商家点菜、减菜、退菜 V1

| 能力 | 正式规则 | 当前状态 |
|---|---|---|
| 服务员开台点菜 | 员工在同一张空闲桌台发起开台并点菜时，items>0 与服务员/桌台锁同事务完成 `OPEN` 会话与首单创建 | 已实现、已上线、待现场人工验证 |
| 仅开台 | 员工仅提交空订单时创建 `OPEN` 会话并更新桌台就餐中；若桌台已存在 `OPEN` 会话则返回 `TABLE_ALREADY_OPEN` | 已实现、已上线、待现场人工验证 |
| 点菜 | 在当前 ACTIVE 桌台的 OPEN TableSession 中创建新的普通 DINE_IN、PENDING_ACCEPTANCE Order；<code>userId=null</code>、<code>createdByStaffId=当前员工</code>；不修改顾客原订单 | 已上线待人工验证 |
| 顾客复用服务员Session | 顾客首单若遇到员工已开会话，复用同一 `TableSession` 并继续下单，不触发 `TABLE_ALREADY_OPEN` | 自动化E2E验证PASS，待现场联合验证 |
| 减菜 | 仅 <code>PENDING_ACCEPTANCE</code>；只允许减少数量；重算订单与桌账金额 | 已上线待人工验证 |
| 退菜 | 仅 <code>ACCEPTED / PREPARING / READY</code>；只做数量和确认；无原因、无审批、无退款字段、无退菜单；已送厨房订单最后一个有效菜品不得全部退为 0 | 已上线待人工验证 |

接口证据：

- 点菜：
  [merchant-table-orders.controller.ts](../../apps/api/src/modules/merchant-orders/merchant-table-orders.controller.ts#L13)；
- 减菜和退菜：
  [merchant-orders.controller.ts](../../apps/api/src/modules/merchant-orders/merchant-orders.controller.ts#L138)；
- 事务与动作日志：
  [merchant-orders.service.ts](../../apps/api/src/modules/merchant-orders/merchant-orders.service.ts#L175)。

验证状态必须保持以下边界：

| 层级 | 结果 |
|---|---|
| 本地与隔离 MySQL 8.0.46 | PASS |
| 自动化测试 | PASS |
| 生产 migration / API / Cashier / Admin | 已发布 |
| 生产真实营业写验收 | Codex 未执行 |
| 用户现场人工验收 | 无明确证据，不能写 PASS |

最终状态：**已上线，待现场业务验证**。生产发布依据见
[商家点菜发布 Gate](../testing/merchant-item-adjustments-production-release-gate.md#L131)。

## 11. Schema Drift 与数据库基准

2026-07-17 已完成：

- 7 项 Prisma 声明收口；
- 没有新增 Drift migration；
- 没有执行 Drift DDL；
- 没有改写 Merchant Mode 生产数据；
- 只执行功能 migration <code>20260717000000_add_staff_order_origin_and_item_audit</code>；
- 17/17 migration 完成；
- 生产最终 Prisma diff 为 <code>This is an empty migration</code>。

七项收口仅让 datamodel 准确描述历史 migration 已建立且生产正在使用的结构；历史 Merchant Mode enum 值继续作为兼容值保留，规范值为 <code>DISPLAY / MANAGED</code>。详见
[production-schema-drift-closure-audit.md](../testing/production-schema-drift-closure-audit.md#L493)。

数据库原则：

1. 只允许从权威 Prisma schema 和受审计 migration 前进；
2. 禁止用 <code>prisma db push</code> 代替生产 migration；
3. migration 前必须完成备份、恢复验证、drift diff、锁影响和回滚边界；
4. additive schema 已产生新数据后不得自动逆向 DDL；
5. 不得为“消除 diff”把生产数据改回旧兼容语义；
6. 不得在文档任务中连接数据库执行写操作。

## 12. 打印唯一架构

### 12.1 权威与职责

- <code>Merchant.printingEnabled</code> 是平台打印总能力唯一数据库权威；
- 平台后台开通/关闭总能力；
- OWNER/MANAGER 在授权范围内配置 Printer、PrintRule、模板和相关参数；
- STAFF 按权限查看、手动打印和补打，不默认具有配置权限；
- Web 收银台创建和查看受控 PrintJob；
- Android 使用同一商家会话执行本地 USB；
- 打印任务、尝试和结果与订单状态机独立；
- 打印失败不得改变订单业务状态。

平台总能力只读/禁止商家写入的代码证据见
[printing-settings.service.ts](../../apps/api/src/modules/printing/services/printing-settings.service.ts#L21)。

### 12.2 正式执行 Gate

未开始的任务必须依次满足：

1. Task Center 开启；
2. Merchant 为 ACTIVE 且 <code>printingEnabled=true</code>；
3. 当前账号有效且权限允许；
4. execution Flag 开启；
5. Printer enabled、通道已实现、配置合法；
6. Printer 状态 ONLINE；
7. Android/USB 正向证据新鲜且全部为 true；
8. Claim、lease、快照 hash 和本地 USB Gate 通过。

READY 是正向白名单。<code>UNKNOWN / UNVERIFIED / OFFLINE / ERROR / DISABLED</code> 均不得转换成 READY。代码证据见
[printer-readiness.ts](../../apps/api/src/modules/printing/utils/printer-readiness.ts#L22)。

D12 固定平台关闭语义：

- PENDING、RETRY_WAIT 和尚未开始的 CLAIMED 任务不得再领取或进入 PRINTING；
- 已进入 PRINTING 的任务可回报 <code>SUCCESS / FAILED / UNCERTAIN</code>，用于对账真实硬件结果；
- 允许在途结果回报不等于允许新打印。

### 12.3 当前生产与现场状态

| 项目 | 当前状态 |
|---|---|
| 平台总能力 | 按 <code>Merchant.printingEnabled</code> 管理 |
| Task Center | 开启 |
| 执行端 | 保持开启 |
| 本地 Connector | 现场验证 OK |
| 自动任务创建 | 关闭 |
| 自动打印 | 关闭 |
| enabled 且 autoPrint 的 PrintRule | 0 |
| 旧服务器 LAN/TCP 直打 | 关闭 |
| Web 收银台手动打印 | 已上线；现场真实 USB 手动打印已验证 |

原 <code>USB_BINDING_MISSING</code> 和 <code>PRINTER_STATUS_NOT_READY</code> 现场阻断已经关闭，不得继续列为当前阻断。

### 12.4 Legacy 打印

旧 <code>PrinterSetting / PrintLog</code>、旧 <code>/merchant/printers</code>、服务器 Socket/TCP/LAN 直打及旧自动打印源码仍保留。旧 Controller 只受 Legacy Flag 控制，正式路径关闭；证据见
[merchant-orders.controller.ts](../../apps/api/src/modules/merchant-orders/merchant-orders.controller.ts#L175)
和
[printing-feature-flags.service.ts](../../apps/api/src/modules/printing/services/printing-feature-flags.service.ts#L94)。

固定决策：

- 旧服务器 LAN/TCP 永久不作为正式方案；
- 生产持续保持关闭；
- 未来 LAN 打印只能由 Android 本地 LAN Adapter 承担；
- 在删除 Legacy 前，必须复核所有可达路径是否也受 <code>Merchant.printingEnabled</code> 保护；
- 当前 Legacy 风险不是现场打印阻断。

## 13. Android RC3

| 项目 | 基准 |
|---|---|
| APK | <code>YunQiao-Merchant-Terminal-v1.0.0-rc3.apk</code> |
| applicationId | <code>com.yunqiao.life.merchantterminal</code> |
| versionName / versionCode | <code>1.0.0-rc3 / 7</code> |
| Git Commit | <code>bc24dcdefdd41422be081fbd4ef8e6f675b4c246</code> |
| Android Tag | <code>merchant-terminal-android-v1.0.0-rc3</code> |
| SHA-256 | <code>586cca31278b1ad0b5b410a86980199ed0f134e4bb4a63ce80a8758e4bf25672</code> |
| 正式 Web | <code>https://cashier.huayueyouxuan.com/</code> |
| Connector API | <code>https://api.huayueyouxuan.com/api/v1</code> |

版本与正式地址的代码证据见
[build.gradle.kts](../../apps/merchant-terminal-android/app/build.gradle.kts#L17)。
正式发布原件位于
<code>/Users/peter/Desktop/云桥Life-发布与交付/02-Android正式发布/yunqiao-merchant-terminal-rc3</code>。

### 13.1 架构规则

- Android 只包装同一个 Web 收银台，并增加 Web 无法完成的本地硬件能力；
- 复用 MerchantStaff 会话调用 <code>/merchant/printing/connector/*</code>；
- 不保存账号密码，不增加独立登录；
- 不增加 Terminal Token、配对码、设备账号、原生订单/桌台或第二套 API；
- <code>ConnectorControlActivity</code> 必须保持非导出；
- “关闭页面”只退出维护页，不关闭 Connector；
- 自动打印开关继续关闭；
- 维护入口继续保持隐藏，不新增公开菜单入口。

非导出 Activity 证据见
[AndroidManifest.xml](../../apps/merchant-terminal-android/app/src/main/AndroidManifest.xml#L33)；
“关闭页面”调用 <code>finish()</code> 而不关闭 Connector 的代码见
[ConnectorControlActivity.kt](../../apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/connector/ConnectorControlActivity.kt#L93)。

现场操作描述为：点击 Web 收银台顶部时间显示区域，打开 Android 原生 USB 打印连接器维护页。技术实现由覆盖/位于该顶部区域的 Android 原生入口触发，Web 时钟本身不承担维护页业务逻辑；代码锚点见
[activity_main.xml](../../apps/merchant-terminal-android/app/src/main/res/layout/activity_main.xml#L62)
和
[MainActivity.configureTerminalMenu](../../apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/MainActivity.kt#L503)。
此交互属于现场运行基准，不得新增公开业务菜单入口。

### 13.2 已完成现场验证

- RC3 覆盖安装；
- P10/D10 USB 识别；
- USB permission；
- 本地 Binding；
- 本地 Connector；
- Web 收银台显示可打印；
- 商家后台 Printer ONLINE；
- 隐藏维护页 UI；
- 真实 USB 手动打印。

### 13.3 仍属现场待验证

只有没有独立完成证据时才保持为待验证：

- USB 拔插恢复；
- P10/D10 重启恢复；
- 断网与网络恢复；
- 未来自动打印防重复；
- 多打印机并发；
- 未来 Android LAN Adapter。

当前没有一份现场完成后填妥、含实物结果和签字的独立正式报告；最新现场 PASS 来自用户确认的恢复指令。该证据归档缺口不改变已确认的现场结果。

## 14. 跨端联动矩阵

| 能力 | 小程序 | 平台后台 | 商家电脑/手机 | Web 收银台 | Android | 权威模型/API |
|---|---|---|---|---|---|---|
| 商家展示 | 浏览 | 创建、状态、展示与能力 | 维护授权范围内资料 | 显示当前商家 | WebView 显示 | Merchant |
| 顾客登录 | 微信 USER | 用户诊断 | 无 | 无 | 无 | User/Auth |
| 商家账号 | 无 | 创建/重置 OWNER | 同一 MerchantStaff | 同一 MerchantStaff | 复用 Web 会话 | MerchantStaff/Auth |
| 员工 | 无 | 平台诊断 | OWNER 管理 | 显示当前账号 | 不建独立员工 | MerchantStaff |
| 商品 | 浏览与下单 | 诊断 | OWNER/MANAGER 管理 | 点菜时读取 | WebView | Category/Product |
| 桌台 | 扫码使用 | 诊断/能力 | 配置与桌账 | 总览与桌账 | WebView | DiningTable/TableSession |
| 订单 | 仅本人 | 平台诊断 | 商家订单 | 高频状态操作 | WebView | Order/OrderItem/StatusLog |
| 整桌账单 | 不展示 | 诊断 | 查看/关闭 | 查看/关闭 | WebView | TableSession |
| 点/减/退菜 | 不承担员工操作 | 动作日志过滤 | Admin 显示动作 | 执行操作 | WebView | 统一 Merchant Order API |
| 打印总能力 | 无 | 唯一开关 | 只读 | 真实状态 | 执行前 Gate | Merchant.printingEnabled |
| 打印配置 | 无 | 诊断 | OWNER/MANAGER | 不做复杂配置 | 读取本地绑定 | Printer/Rule/Template |
| 手动打印/补打 | 无 | 诊断 | 按角色 | 按角色 | USB 执行 | PrintJob/Attempt |

## 15. API 与数据库原则

- API 全局前缀为 <code>/api/v1</code>；证据见
  [main.ts](../../apps/api/src/main.ts#L15)；
- 所有端必须调用同一 API；不得为 Android、手机后台或 Cashier 创建重复业务 API；
- Guard、Service、Prisma relation 和事务是服务端授权边界，前端隐藏不是授权；
- Merchant scope、user scope 和 TableSession scope 必须在服务端校验；
- 订单状态改变必须走现有状态机并写 OrderStatusLog；
- PrintJob/PrintAttempt 不得替代或驱动 OrderStatus；
- 响应契约变更必须检查所有调用端，尤其是审核稳定版小程序；
- 无法证明的生产事实必须标 <code>UNKNOWN</code>。

## 16. 本地、Git 与生产运行基准

### 16.1 本地与 Git

| 项目 | 真实值 |
|---|---|
| 唯一源码项目 | <code>/Users/peter/Desktop/HuayueLife-MVP</code> |
| origin | <code>git@github-peter001:peten001/HuayueLife-MVP.git</code> |
| GitHub | <code>peten001/HuayueLife-MVP</code> |
| 文档开始前 main/origin/main | <code>dc998ad601e8f2019e6a683202225a58a849ef16</code> |
| 点菜应用 Commit | <code>a5f1ee790e885c607a2eebbf2466814b060ccbc7</code> |
| Android RC3 Tag | <code>merchant-terminal-android-v1.0.0-rc3 → bc24dcd...</code> |

### 16.2 生产

2026-07-17 只读核验：

| 项目 | 真实值 |
|---|---|
| 服务器 / SSH | <code>43.161.202.113</code> / <code>ubuntu</code> |
| hostname | <code>VM-0-3-ubuntu</code> |
| 项目目录 | <code>/opt/HuayueLife-MVP</code> |
| 生产分支 / HEAD / origin/main | <code>main / dc998ad... / dc998ad...</code> |
| 当前 HEAD 精确 Tag | 无；不得用最近祖先 Tag 代替 |
| 历史服务器 RC2 Tag | <code>merchant-terminal-usb-v1.0.0-rc2 → b7f0566...</code>，仅历史 |
| PM2 | <code>huayue-api</code>；脚本 <code>apps/api/dist/src/main.js</code>；在线 |
| API | <code>https://api.huayueyouxuan.com/api/v1</code>；health 200 |
| Admin | <code>https://admin.huayueyouxuan.com</code>；200 |
| Cashier | <code>https://cashier.huayueyouxuan.com</code>；200 |
| MySQL | <code>8.0.46</code> |
| Nginx | <code>1.18.0</code> |
| Cashier 静态目录 | <code>/var/www/huayue-cashier</code> → <code>/var/www/huayue-cashier-releases/20260717-130330-a5f1ee7-item-adjustments</code> |
| Admin 静态目录 | <code>/var/www/huayue-admin</code> |

<code>dc998ad</code> 是发布报告提交；当前应用构建来源仍为 <code>a5f1ee7</code>。不得把旧
<code>b7f0566</code> 或 <code>f0f1d71</code> 写成当前生产 HEAD，也不得把 Android RC3 Tag 写成服务器 Tag。

### 16.3 备份规范

生产变更前必须：

- 备份数据库、API 环境、PM2、Nginx、当前 Git commit、Cashier release 和 Admin dist；
- 备份目录权限 0700、文件权限 0600；
- 生成并验证 SHA-256；
- 验证数据库对象数、结束标记和恢复能力；
- 不在报告中输出秘密或业务数据。

点菜发布备份实例为
<code>/opt/backups/huayue-item-adjustments-20260717-125138</code>，详见
[发布 Gate](../testing/merchant-item-adjustments-production-release-gate.md#L131)。

## 17. 发布与变更流程

固定流程：

~~~text
完整读取 Master Baseline
→ 讨论需求、影响端、数据与兼容 Gate
→ 用户明确“讨论 OK”
→ 从最新 origin/main 创建功能分支
→ 实现与跨端回归
→ RC / 制品 / 备份 / migration Gate
→ fast-forward main
→ 普通 Push
→ 新 Tag（需要发布制品时）
→ 受控部署
→ 生产只读冒烟与明确的人工验收
~~~

禁止：

- 未经讨论 OK 直接修改；
- 绕过 RC 直接改 main；
- force push、rebase 共享历史、覆盖 Tag；
- 未备份执行 migration；
- 将构建通过写成生产人工 PASS；
- 在生产工作树遗留运行时或临时文件；
- 因修复一端而破坏审核稳定版小程序。

## 18. 发布与交付目录

唯一发布与交付根目录：
<code>/Users/peter/Desktop/云桥Life-发布与交付</code>。

~~~text
00-临时收件箱
01-现场安装包
02-Android正式发布
03-历史版本归档
04-Codex执行指令
  01-待执行
  02-执行中
  03-已完成
05-部署与验证记录
  01-审计报告
  02-验证截图
  03-诊断日志
  04-部署记录
98-Codex临时文件
99-待确认文件
~~~

敏感文件不得进入 Git、现场安装包、Android 正式发布目录或普通交付目录，包括：
keystore、私钥、签名密码、<code>.env</code>、数据库连接串、dump、JWT、Cookie、Token、API key、真实密码、未脱敏顾客信息和未脱敏生产日志。

## 19. Legacy 与兼容边界

| Legacy | 当前状态 | 固定处理 |
|---|---|---|
| <code>PrinterSetting / PrintLog</code> | 表和代码保留 | 不是新任务中心事实源 |
| 旧 <code>/merchant/printers</code> 与 order print | 注册但 Legacy Flag 默认/生产关闭 | 不得作为正式方案 |
| 服务器 Socket/TCP/LAN 与旧自动打印 | 代码保留、生产关闭 | 未来 LAN 只走 Android 本地 Adapter |
| Terminal pair/heartbeat/jobs Controller | 源码存在但 PrintingModule 未注册 | 保持休眠，不得恢复 |
| MerchantTerminal token/pair 字段与 Provider | schema/源码兼容保留 | 当前 Android 不依赖 |
| merchant-admin Terminal 页面/API client | 文件存在、无正式路由 | 保持 Legacy 身份 |
| Merchant Mode 旧 enum 值 | 数据兼容保留 | 规范值为 DISPLAY/MANAGED，不改写历史 |
| 顾客 <code>/me</code> 与 <code>/auth/me</code> | 兼容别名 | 调用统计和弃用 Gate 前不得删除 |
| 无路由旧页面与历史 RC1 runbook | 历史保留 | 禁止当作当前运行或现场手册 |

当前 PrintingModule 只注册
[MerchantPrintingController](../../apps/api/src/modules/printing/printing.module.ts#L19)，因此休眠 Terminal Controller 不得描述为当前可达 API。

## 20. 当前限制与验证状态总表

| 事项 | 状态 | 说明 |
|---|---|---|
| 六端唯一底座 | 当前已实现 / 目标基准 | 禁止新增重复模型 |
| 小程序审核稳定版 | 当前已实现 / 保护中 | 未经新版 Gate 不得修改 |
| D01–D03 认证撤销与首次改密 | 已确认待修 | P0，不在本文档任务中修复 |
| D04 小程序敏感日志 | 暂缓 | 下次小程序新版 Gate |
| D05 随机 scene | 暂缓 | 当前不使既有二维码失效 |
| D06 纯后端限流/严格校验 | 已确认待修 | P1，必须兼容现有 scene/API |
| D07/D08 能力统一 | 暂缓 | 目标已确认，当前不改判断 |
| 点菜/减菜/退菜 V1 | 已上线待人工验证 | 生产真实营业写验收未执行 |
| Schema Drift | 当前已实现 | 17/17、最终 empty diff |
| Android RC3 覆盖安装与手动 USB 打印 | 现场已验证 | 原现场阻断关闭 |
| USB 拔插/重启/断网恢复等 | 现场待验证 | 仅在缺少独立证据时保持 |
| 自动任务创建/自动打印 | 当前关闭 | 不得误写为已启用能力 |
| 旧服务器 LAN/TCP | Legacy、正式路径关闭 | 不是当前现场阻断 |
| 生产静态 bundle 与 commit 的逐字 SHA 证明 | UNKNOWN | Cashier release 路径已确认，但完整制品 provenance 未逐字证明 |

当前阶段不进入实现范围：转桌、并桌、今日售罄、拆单/分账、折扣、赠送、免单、支付、库存和退菜单。

## 21. 开发前 15 项检查清单

以下 15 项保留自第一轮 Master Audit。任何一项不清楚，停止开发并报告。

- [ ] 1. 工作分支从当前 <code>origin/main</code> 创建，工作区干净。
- [ ] 2. 需求明确属于六端中的哪一端，是否会复制现有业务模型/API。
- [ ] 3. 新页面先复用现有 MerchantStaff/User 认证与 Guard。
- [ ] 4. 不新增 cashier/app 专用 Order、DiningTable、TableSession、员工或权限接口。
- [ ] 5. 平台 capability 指定唯一权威字段、唯一写入者、默认值和关闭行为。
- [ ] 6. 商家关闭/员工禁用后，后端而非仅前端立即阻断。
- [ ] 7. 订单状态动作复用现有 service，原子更新并写 OrderStatusLog。
- [ ] 8. 关闭 TableSession 的支付语义得到产品确认。
- [ ] 9. 打印任务必须先过 <code>Merchant.printingEnabled</code>、Feature Flags 与 READY 正向白名单。
- [ ] 10. UNKNOWN/UNVERIFIED/OFFLINE/ERROR/DISABLED 不得转换为 READY。
- [ ] 11. Android 不新增独立登录、订单、桌台、Terminal Token、配对码或 Heartbeat。
- [ ] 12. 任何 USB/纸张能力只在真机证据后标记通过。
- [ ] 13. 敏感配置、日志、截图和测试数据完成扫描/脱敏。
- [ ] 14. API、merchant-admin、cashier、miniapp、Android 按现有脚本回归。
- [ ] 15. 功能分支 → RC → 回归 → fast-forward main → 新 Tag → 部署 Gate。

原草稿在这 15 项之后另有三项任务/交付控制。为避免丢失，其中两项转为永久发布 Gate：

- DB migration 只在备份、恢复验证和 additive 审计通过后执行；
- 部署包必须带 Commit、SHA、版本、签名和回滚清单。

原第三项“当前 Codex 指令保持执行中”只属于 2026-07-16 审计任务生命周期，不是永久开发检查项。

## 22. 支持文档与证据索引

### 22.1 仓库内正式证据

- [生产 Schema Drift 收口审计](../testing/production-schema-drift-closure-audit.md)
- [点菜/减菜/退菜生产发布 Gate](../testing/merchant-item-adjustments-production-release-gate.md)
- [点菜/减菜/退菜历史 migration Gate](../testing/merchant-cashier-add-reduce-return-migration-gate.md)：只作为较早阻断历史，最终生产状态以上两份为准
- [统一平台运行审计](UNIFIED_PLATFORM_RUNTIME_AUDIT.md)：较早架构证据，不覆盖本文件
- [打印平台 Gate 与 READY](../printing-v1/11_PLATFORM_PRINTING_GATE_AND_READINESS.md)
- [P10 USB 验证模板](../testing/P10_USB_PRINTER_STORE_VALIDATION.md)：未填写模板，不是当前现场 PASS 的独立报告

### 22.2 外部发布与审计证据

- 第一轮草稿：<code>/Users/peter/Desktop/云桥Life-发布与交付/05-部署与验证记录/01-审计报告/YUNQIAO_PLATFORM_MASTER_AUDIT_DRAFT.md</code>
- 第二轮草稿：<code>/Users/peter/Desktop/云桥Life-发布与交付/05-部署与验证记录/01-审计报告/YUNQIAO_PLATFORM_AUDIT_DECISION_DRAFT.md</code>
- 最终恢复指令：<code>/Users/peter/Desktop/云桥Life-发布与交付/04-Codex执行指令/03-已完成/01-平台架构/yunqiao_master_baseline_docs_resume_current_state.md</code>（任务完成后归档位置）
- Android RC3 发布清单：<code>/Users/peter/Desktop/云桥Life-发布与交付/02-Android正式发布/yunqiao-merchant-terminal-rc3/manifest/RELEASE_MANIFEST.md</code>
- Android RC3 构建信息：<code>/Users/peter/Desktop/云桥Life-发布与交付/02-Android正式发布/yunqiao-merchant-terminal-rc3/manifest/BUILD_INFO.txt</code>
- 早期 onsite preflight：<code>/Users/peter/Desktop/云桥Life-发布与交付/05-部署与验证记录/yunqiao-p10-usb-onsite-validation/onsite-gate-preflight-report.md</code>；RC1 历史阻断，不代表当前状态

### 22.3 2026-07-17 非敏感只读核验

- 本地：工作区干净，<code>main = origin/main = dc998ad...</code>，origin 未修改；
- 生产：<code>/opt/HuayueLife-MVP main@dc998ad...</code>，当前 HEAD 无精确 Tag；
- <code>huayue-api</code> 在线，Node <code>22.22.3</code>、MySQL <code>8.0.46</code>、Nginx <code>1.18.0</code>；
- API health、Admin、Cashier 均为 HTTPS 200；
- 只读取版本、路径和健康状态；未读取秘密、业务数据或环境值，未修改生产。

## 23. 变更规则

本文件只能在以下流程中变更：

1. 先提供真实代码、运行、发布或现场证据；
2. 明确标出是目标变化、实现变化还是验证状态变化；
3. 评估六端、数据库、小程序审核、Android 和 Legacy 兼容影响；
4. 用户明确“讨论 OK”；
5. 独立文档/功能分支修改并审阅；
6. 普通提交与 fast-forward 流程同步。

任何后续文档若与本文件冲突，必须先修订本文件；不得建立第二份并行 Master Baseline。
