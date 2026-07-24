# 云桥 Life 全平台正式审计决策记录

## 1. 文档状态

| 项目 | 内容 |
|---|---|
| 状态 | <code>FORMAL / APPROVED DECISIONS</code> |
| 决策日期 | 2026-07-17（Asia/Ho_Chi_Minh） |
| 源码/生产事实截止点 | <code>dc998ad601e8f2019e6a683202225a58a849ef16</code> |
| 当前应用发布来源 | <code>a5f1ee790e885c607a2eebbf2466814b060ccbc7</code> |
| Android RC3 来源 | <code>bc24dcdefdd41422be081fbd4ef8e6f675b4c246</code> |
| 适用范围 | 六端架构、认证与权限、小程序保护、扫码点餐能力、桌账、打印、Android |
| 主基准 | [YUNQIAO_PLATFORM_MASTER_BASELINE.md](YUNQIAO_PLATFORM_MASTER_BASELINE.md) |
| 风险清单 | [YUNQIAO_PLATFORM_TECH_DEBT_AND_RISKS.md](YUNQIAO_PLATFORM_TECH_DEBT_AND_RISKS.md) |

本文把 2026-07-16 两轮审计草稿中的建议转化为用户已经确认的 D01–D14 正式产品决策。草稿中的优先级、旧生产 Commit、RC2/RC1 状态和待确认措辞，不能覆盖本文与 2026-07-17 最新发布/现场证据。

## 2. 审计背景与来源

### 2.1 第一轮：全平台 Master Audit

- 时间：2026-07-16 11:47（Asia/Ho_Chi_Minh）；
- 本地 Commit：<code>cbb6739afeca8b4192f8f472a0db550d780f79fd</code>；
- 范围：六端、monorepo、唯一 API/数据库、账号权限、订单/桌账、打印、Android、生产只读基线；
- 结果：建立 PASS/GAP/DUPLICATE/LEGACY/RISK/UNKNOWN 事实清单；
- 来源：<code>/Users/peter/Desktop/云桥Life-发布与交付/05-部署与验证记录/01-审计报告/YUNQIAO_PLATFORM_MASTER_AUDIT_DRAFT.md</code>。

### 2.2 第二轮：重点审计决策草稿

- 时间：2026-07-16；
- 本地 Commit：<code>cbb6739afeca8b4192f8f472a0db550d780f79fd</code>；
- 范围：员工 JWT、首次改密、小程序敏感日志、scene、能力字段、打印权威与 Legacy；
- 结果：形成 P01–P06 深入证据和 D01–D14 建议，但当时仍等待用户确认；
- 来源：<code>/Users/peter/Desktop/云桥Life-发布与交付/05-部署与验证记录/01-审计报告/YUNQIAO_PLATFORM_AUDIT_DECISION_DRAFT.md</code>。

### 2.3 恢复与定版

2026-07-17 恢复指令确认：

- D01–D14 的最终产品决策；
- 微信小程序审核稳定版保护；
- Android RC3 已覆盖安装且 USB/Connector/真实手动打印现场通过；
- 点菜/减菜/退菜、Schema Drift 和动作日志已完成生产发布；
- 生产真实营业写验收仍未执行；
- 本轮只形成三份正式文档，不修代码、不部署。

来源：<code>/Users/peter/Desktop/云桥Life-发布与交付/04-Codex执行指令/03-已完成/01-平台架构/yunqiao_master_baseline_docs_resume_current_state.md</code>（完成后归档位置）。

## 3. 决策状态定义

| 状态 | 含义 |
|---|---|
| <code>MUST_FIX / P0</code> | 已确认的高优先级安全/权限要求；当前未实现，须独立修复 Gate |
| <code>MUST_FIX / P1</code> | 必须修复的兼容或加固项；不得破坏现有稳定契约 |
| <code>LOCKED</code> | 产品语义已经固定；后续实现必须遵守 |
| <code>DEFERRED</code> | 目标/风险已确认，但受稳定版保护或当前发布边界约束，暂缓实施 |
| <code>LEGACY_OFF</code> | 代码或数据兼容物仍存在，但正式运行路径关闭 |
| <code>FIELD_PASS</code> | 用户最新现场证据确认通过 |
| <code>DEPLOYED_PENDING_FIELD</code> | 已发布，但没有真实业务人工写验收 |

## 4. D01–D14 正式决策

### D01：停用或删除员工后旧登录立即失效

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>MUST_FIX / P0</code> |
| 正式决策 | 员工停用或删除后，所有旧登录状态必须在下一次受保护请求立即失效 |
| 当前事实 | 普通商家 API 的 JwtAuthGuard 只验证签名/过期，MerchantRoleGuard 信任 JWT 内旧角色；只有打印中心额外实时查员工 |
| 影响 | 旧设备可能继续接单、操作订单/桌台或关闭桌账 |
| 实施 Gate | 所有商家业务 API 必须实时确认员工和 Merchant ACTIVE；不能只隐藏菜单 |
| 小程序影响 | 无直接影响；不得借机修改小程序 |

代码证据：
[JwtAuthGuard](../../apps/api/src/common/guards/jwt-auth.guard.ts#L12)、
[MerchantRoleGuard](../../apps/api/src/common/guards/merchant-role.guard.ts#L13)、
[ActiveMerchantStaffGuard](../../apps/api/src/modules/printing/guards/active-merchant-staff.guard.ts#L16)。

### D02：降权或改密后旧权限与旧登录立即失效

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>MUST_FIX / P0</code> |
| 正式决策 | 员工降权、密码重置或改密后，旧权限和旧登录必须立即失效 |
| 当前事实 | 更新 role/passwordHash/mustChangePassword 不会撤销已签发 JWT；生产 JWT TTL 的审计值为 7 天 |
| 影响 | 已降权员工可继续使用旧 MANAGER/OWNER claim；改密不能驱逐遗失设备 |
| 实施 Gate | 采用实时角色和可撤销会话/版本机制；明确自助改密后的当前会话体验，但不能保留旧权限 |
| 小程序影响 | 无直接影响 |

当前员工更新和重置证据见
[merchant-staff.service.ts](../../apps/api/src/modules/merchant-staff/merchant-staff.service.ts#L56)，
自助改密证据见
[auth.service.ts](../../apps/api/src/modules/auth/auth.service.ts#L185)。

### D03：主账号默认密码与首次改密最小 API

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>MUST_FIX / P0</code> |
| 正式决策 | 商家主账号初始密码固定为 <code>12345678</code>；首次改密前只允许最小 API |
| 当前事实 | 平台创建/重置 OWNER 已使用固定初始密码和 <code>mustChangePassword=true</code>；服务端尚无统一最小 API Guard |
| 最小范围 | 当前账号信息、改密所必需路径；其余经营、订单、桌台、打印业务必须拒绝 |
| 实施 Gate | 白名单必须在服务端执行，并与 D01/D02 会话撤销一起测试 |
| 小程序影响 | 无直接影响 |

OWNER 规则证据见
[platform-merchants.service.ts](../../apps/api/src/modules/platform/platform-merchants.service.ts#L603)
和同文件
[resetPassword](../../apps/api/src/modules/platform/platform-merchants.service.ts#L1248)。

### D04：小程序敏感日志风险确认，当前暂缓

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>DEFERRED / 小程序新版 Gate</code> |
| 正式决策 | 小程序生产日志中的顾客隐私、认证材料、tableToken、位置和业务 payload 风险成立 |
| 当前处理 | 当前审核稳定版保护期不修改；下次小程序新版 Gate 统一处理 |
| 当前证据 | <code>apps/miniapp/src/api/http.ts</code> 的 <code>DEBUG_REQUESTS=true</code>，关键请求会进入 console |
| 实施 Gate | production 零敏感 payload、字段白名单/脱敏、认证/QR/订单/聊天回归 |
| 小程序影响 | 影响审核稳定版；需要重新构建并上传新版 |

代码证据见
[miniapp http.ts](../../apps/miniapp/src/api/http.ts#L7)。

### D05：当前不修改 scene，不使已有二维码失效

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>DEFERRED / 小程序新版 Gate</code> |
| 正式决策 | 当前不修改二维码 scene，不主动使已有二维码失效；随机/签名 scene 后续处理 |
| 当前事实 | scene 为 <code>t{id}v{version}</code>；强 <code>qrToken</code> 本身为随机值 |
| 风险边界 | 风险是可枚举 scene 经公开 resolver 兑换强 token，不是 256-bit token 本身可预测 |
| 实施 Gate | 新旧 scene/API 兼容、已印二维码迁移、rotate、限流、门店换码和小程序新版发布 |
| 小程序影响 | 直接影响审核版和既有二维码；需要重新上传新版 |

scene 证据见
[tables.service.ts](../../apps/api/src/modules/tables/tables.service.ts#L87)
和
[qr.service.ts](../../apps/api/src/modules/qr/qr.service.ts#L68)。

### D06：保持 scene/API 兼容的纯后端限流与严格校验

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>MUST_FIX / P1</code> |
| 正式决策 | 保持当前 scene 与 API 契约，可单独设计纯后端限流、严格格式校验、统一错误和安全审计 |
| 当前事实 | resolver 公开；当前代码未见应用层专用限流 |
| 兼容要求 | 现有二维码、scene、请求/响应字段和小程序行为保持不变 |
| 实施 Gate | 先测正常门店峰值与失败模式，再定 IP/设备/scene 分层阈值；禁止把限流错误变成小程序破坏性契约 |
| 小程序影响 | 设计正确时不需重新上传；若契约或交互变化则必须进入新版 Gate |

公开 Controller 证据见
[qr.controller.ts](../../apps/api/src/modules/qr/qr.controller.ts#L5)。

### D07：qrOrderEnabled 是扫码点餐平台授权

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LOCKED / 实现暂缓</code> |
| 正式决策 | <code>qrOrderEnabled</code> 是平台授予商家的扫码点餐能力 |
| 当前事实 | QR resolver 与 Cart/Order 的能力来源仍未完全统一 |
| 当前处理 | 目标确认，代码统一暂缓；本轮不改小程序或 API 判断 |
| 实施 Gate | 平台能力、public serializer、QR、Cart、Order、商家 profile 和历史数据兼容一起设计 |
| 小程序影响 | 统一时可能影响审核版显示/下单；按小程序新版 Gate 管理 |

当前 QR 读取证据见
[qr.service.ts](../../apps/api/src/modules/qr/qr.service.ts#L173)，
Cart 读取证据见
[cart.service.ts](../../apps/api/src/modules/cart/cart.service.ts#L139)。

### D08：桌台、堂食与未来扫码点餐组合条件

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LOCKED / 实现暂缓</code> |
| 正式决策 | <code>tableManagementEnabled</code> 是桌台能力；<code>dineInEnabled</code> 是商家实际提供堂食 |
| 未来目标条件 | 平台订单能力 + <code>qrOrderEnabled</code> + <code>tableManagementEnabled</code> + <code>dineInEnabled</code> |
| 当前处理 | 不修改当前小程序/API 判断 |
| 实施 Gate | 定义唯一 resolver、服务端强制点、商家 profile 写入边界、历史 capability 回填与回滚 |
| 小程序影响 | 可能影响扫码入口、菜单、购物车和结算；需小程序新版 Gate |

能力字典证据见
[platform-dictionary-seed.ts](../../apps/api/src/modules/platform/platform-dictionary-seed.ts#L127)。

### D09：员工密码保持当前逻辑

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LOCKED</code> |
| 正式决策 | 员工密码不强制套用主账号 <code>12345678</code> |
| 当前逻辑 | 创建员工时 OWNER 输入初始密码；重置时服务端生成随机临时密码；两者均要求首次改密 |
| 审计修订 | 第一轮 G01/G02“员工必须等同 OWNER 默认密码”的前提关闭 |
| 实施 Gate | D03 服务端首次改密 Gate 和 D02 会话撤销仍必须实施 |
| 小程序影响 | 无 |

代码证据见
[merchant-staff.service.ts](../../apps/api/src/modules/merchant-staff/merchant-staff.service.ts#L36)。

### D10：打印能力与角色权限

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LOCKED / VERIFIED</code> |
| 正式决策 | 平台控制打印总能力；OWNER/MANAGER 配置；STAFF 按权限查看、手动打印和补打，不默认有配置权限 |
| 当前事实 | 新打印 Controller 顶层允许 ACTIVE STAFF 读取和执行；打印机、规则、模板、测试任务及设置 mutation 另限 OWNER/MANAGER；ActiveMerchantStaffGuard 每次从数据库复核角色 |
| 实施 Gate | 保持逐 API 权限矩阵与角色测试；前端隐藏不能替代服务端 Guard |
| 小程序影响 | 无 |

Controller 证据见
[merchant-printing.controller.ts](../../apps/api/src/modules/printing/controllers/merchant-printing.controller.ts#L65)。

### D11：旧服务器 LAN/TCP 永久不是正式方案

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LEGACY_OFF / P1 保护复核</code> |
| 正式决策 | 旧服务器 Socket/TCP/LAN 直打永久不作为正式方案；生产保持关闭；未来 LAN 由 Android 本地 LAN Adapter 实现 |
| 当前事实 | Legacy 源码/路由仍存在；生产 Legacy Flag 关闭；旧路径不完整遵守 <code>Merchant.printingEnabled</code> |
| 当前判断 | 正式路径关闭；不是现场阻断 |
| 实施 Gate | 复核永久关闭保护和所有可达路径的 Merchant Gate；删除前保留兼容/回滚分析 |
| 小程序影响 | 无 |

旧 order print 路由证据见
[merchant-orders.controller.ts](../../apps/api/src/modules/merchant-orders/merchant-orders.controller.ts#L175)，
Legacy Flag 证据见
[printing-feature-flags.service.ts](../../apps/api/src/modules/printing/services/printing-feature-flags.service.ts#L94)。

### D12：平台关闭后的在途任务语义

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LOCKED</code> |
| 正式决策 | 平台关闭打印后，未开始任务不得领取或开始；已进入 PRINTING 的任务可回报 SUCCESS、FAILED 或 UNCERTAIN |
| 原因 | 服务器无法撤回已经发往 USB 的字节；仍需对账真实结果 |
| 安全边界 | 允许结果回报不允许新任务创建、领取、续租或开始硬件输出 |
| 实施 Gate | 开关竞态、租约过期、重复回报、UNCERTAIN 与恢复测试 |
| 小程序影响 | 无 |

开始执行前 Merchant 条件证据见
[print-attempts.service.ts](../../apps/api/src/modules/printing/services/print-attempts.service.ts#L55)。

### D13：Merchant.printingEnabled 是唯一数据库权威

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LOCKED</code> |
| 正式决策 | <code>Merchant.printingEnabled</code> 是平台打印总能力唯一数据库权威；执行 Gate 实时校验 |
| 写入者 | 仅平台后台 |
| 商家范围 | 商家只在授权范围内配置，不得自行开启总能力 |
| 兼容债 | auth/profile 的旧 capability 表达需统一，但不得影响执行权威 |
| 小程序影响 | 无 |

schema 证据见
[schema.prisma](../../apps/api/prisma/schema.prisma#L324)，
商家写入拒绝证据见
[printing-settings.service.ts](../../apps/api/src/modules/printing/services/printing-settings.service.ts#L31)。

Android 执行端的固定边界：本地不再提供打印总开关或自动打印规则开关；连接器启动与领取只服从当前商家会话、<code>Merchant.printingEnabled</code>、服务端 Feature Gate、Printer/PrintRule 和本机 USB 正向证据。SignedOut 只停止当前会话执行，不删除 USB 绑定、纸宽、用途或自动打印规则；USB 离线只改变连接状态，不得关闭能力或配置。

### D14：完成桌账不等于支付成功

| 字段 | 决策 |
|---|---|
| 最终状态 | <code>LOCKED</code> |
| 正式决策 | 完成桌账 = 关闭 TableSession + 桌台恢复空闲 |
| 明确否定 | 不等于现金、线上或其他支付成功；不等于收款登记 |
| 当前事实 | 关闭前拒绝未完成订单；当前不强制所有完成订单均 SETTLED |
| 实施 Gate | 未来支付、分账或结算功能不得倒推改写本决策，需新产品决策 |
| 小程序影响 | 顾客端仍不显示整桌账单 |

代码证据见
[table-sessions.service.ts](../../apps/api/src/modules/table-sessions/table-sessions.service.ts#L137)。

## 5. 决策汇总矩阵

| ID | 主题 | 最终状态 | 当前是否已实现 | 当前是否允许实施 |
|---|---|---|---:|---:|
| D01 | 停用/删除立即失效 | MUST_FIX / P0 | 否 | 需独立 Auth Gate |
| D02 | 降权/改密旧会话失效 | MUST_FIX / P0 | 否 | 需独立 Auth Gate |
| D03 | 首次改密最小 API | MUST_FIX / P0 | 否 | 需独立 Auth Gate |
| D04 | 小程序敏感日志 | DEFERRED | 否 | 仅小程序新版 Gate |
| D05 | 随机 scene | DEFERRED | 否 | 仅小程序新版 Gate |
| D06 | 兼容限流/严格校验 | MUST_FIX / P1 | 否 | 可单独后端 Gate |
| D07 | qrOrderEnabled 权威 | LOCKED / 暂缓统一 | 部分 | 当前不改判断 |
| D08 | 四条件扫码点餐 | LOCKED / 暂缓统一 | 否 | 当前不改判断 |
| D09 | 员工密码保持当前逻辑 | LOCKED | 是 | 不改产品逻辑 |
| D10 | 打印角色权限 | LOCKED / P1 复核 | 部分 | 需独立权限 Gate |
| D11 | 旧 LAN/TCP 永久关闭 | LEGACY_OFF | 正式路径关闭 | 仅做保护复核 |
| D12 | 在途任务可对账 | LOCKED | 新链已实现 | 保持 |
| D13 | printingEnabled 唯一权威 | LOCKED | 新链已实现 | 保持/补显示一致性 |
| D14 | 完成桌账非支付 | LOCKED | 是 | 保持 |

## 6. 小程序保护与暂缓项

当前线上微信小程序是审核通过稳定版，任何后端开发必须兼容它。以下保持冻结：

- 审核安全页面、审核文案；
- 点餐入口隐藏逻辑；
- 菜单、购物车、结算、订单入口灰度逻辑；
- Feature Flag、白名单；
- scene；
- API 请求/响应契约；
- 已审核页面、路由和导航结构。

D04、D05、D07、D08 及相关 Flag/白名单重构只可在“小程序新版发布 Gate”处理。D06 只有在不改变 scene/API/交互时，才可作为纯后端任务单独实施。

2026-07-17 点菜发布没有修改或重新发布小程序，顾客 API 通过过滤内部动作日志维持现有契约；证据见
[production-schema-drift-closure-audit.md](../testing/production-schema-drift-closure-audit.md#L576)。

## 7. 后端可修项

| 分组 | 项目 | 开始条件 |
|---|---|---|
| Auth P0 | D01 + D02 + D03 | 完整会话撤销、实时员工/商家状态、当前 role、首次改密白名单方案与测试先讨论 OK |
| QR P1 | D06 | scene/API 冻结、限流阈值、错误契约、监控与回滚先确认 |
| Printing P1 | D10 | 逐 API 权限矩阵先确认 |
| Legacy Printing P1 | D11 | 证明不会打开旧执行路径，且删除/隔离策略可回滚 |
| Display consistency | D13 兼容债 | 不改变 <code>Merchant.printingEnabled</code> 执行权威 |

本文不授权直接修复。每组必须独立讨论、独立分支、独立测试和独立发布 Gate。

## 8. 最新生产证据

### 8.1 Git 与运行

2026-07-17 非敏感只读核验：

- 本地开始前 <code>main = origin/main = dc998ad...</code>，工作区干净；
- 生产 <code>/opt/HuayueLife-MVP</code> 为 <code>main@dc998ad...</code>；
- 当前生产 HEAD 没有精确 Tag；
- <code>huayue-api</code> 在线，运行 <code>apps/api/dist/src/main.js</code>；
- MySQL <code>8.0.46</code>，Nginx <code>1.18.0</code>；
- API health、Admin、Cashier 均 HTTPS 200；
- Cashier 指向 <code>/var/www/huayue-cashier-releases/20260717-130330-a5f1ee7-item-adjustments</code>。

<code>dc998ad</code> 只追加发布报告，实际应用构建来源为 <code>a5f1ee7</code>。不得把 <code>b7f0566</code> 或 <code>f0f1d71</code> 写成当前生产 HEAD，也不得把 Android RC3 Tag 写成服务器 Tag。

### 8.2 Schema 与点菜发布

- 7 项 Prisma 声明已收口；
- 没有 Drift migration、Drift DDL 或 Merchant Mode 数据改写；
- 功能 migration 已执行，17/17 完成；
- 生产最终 Prisma diff 为空；
- API、Cashier、Admin 同批发布；
- Merchant Admin 正确显示三类动作；
- Platform 与顾客 API 过滤内部动作；
- 小程序源码未修改、未重新发布。

证据：
[生产 Schema Drift 收口审计](../testing/production-schema-drift-closure-audit.md#L544)、
[点菜生产发布 Gate](../testing/merchant-item-adjustments-production-release-gate.md#L131)。

点菜、减菜、退菜的生产真实营业写验收没有执行，没有使用生产账号创建测试营业数据。正式状态为
<code>DEPLOYED_PENDING_FIELD / 已上线，待现场业务验证</code>，不得写成人工 PASS。

### 8.3 打印与 Android RC3

RC3：

- <code>YunQiao-Merchant-Terminal-v1.0.0-rc3.apk</code>；
- applicationId <code>com.yunqiao.life.merchantterminal</code>；
- versionName/versionCode <code>1.0.0-rc3 / 7</code>；
- Tag <code>merchant-terminal-android-v1.0.0-rc3</code>；
- SHA-256 <code>586cca31278b1ad0b5b410a86980199ed0f134e4bb4a63ce80a8758e4bf25672</code>。

最新现场确认：

- RC3 覆盖安装 OK；
- P10/D10 USB 识别与 permission OK；
- Binding 与 Connector OK；
- Web 收银台显示可打印；
- Merchant Admin Printer ONLINE；
- 隐藏维护页 UI OK；
- 真实 USB 手动打印已验证。

当前打印状态：

- <code>Merchant.printingEnabled</code> 管理平台总能力；
- 执行端开启；
- 自动任务创建关闭；
- 自动打印关闭；
- enabled 且 autoPrint 的 PrintRule 为 0；
- 旧服务器 LAN/TCP 关闭。

原 <code>USB_BINDING_MISSING</code> 与 <code>PRINTER_STATUS_NOT_READY</code> 阻断已关闭。早期 onsite preflight、RC1 报告和空白 P10 模板不得覆盖这一最新事实。

## 9. 现场验证边界

### 9.1 已完成

- RC3 覆盖安装；
- USB 识别与授权；
- Binding；
- Connector 在线；
- Web/后台 READY 表达；
- 隐藏维护页 UI；
- 真实 USB 手动打印。

### 9.2 仍待独立证据

- USB 拔插恢复；
- P10/D10 重启恢复；
- 断网恢复；
- 未来自动打印防重复；
- 多打印机；
- 未来 Android LAN Adapter；
- 点菜/减菜/退菜生产真实业务人工验收。

现场打印已经通过，但目前未找到一份完成后填妥、带实物结果和签字的独立正式验收报告。此项是证据归档缺口，不得重新定义为硬件阻断。

## 10. 明确未授权事项

本决策记录不授权：

- 直接实施 D01/D02/D03/D06；
- 修改小程序日志、scene、能力字段、Flag、白名单、页面或路由；
- 开启自动任务、自动打印或旧 LAN/TCP；
- 恢复 Terminal Token、配对码或独立 Android 账号；
- 修改数据库、执行 migration 或部署生产；
- 实现转桌、并桌、售罄、分账、折扣、赠送、免单、支付、库存或退菜单。

任何后续开发必须先完整读取 Master Baseline，并在用户明确“讨论 OK”后单独执行。
