# 云桥 Life 技术债与风险清单

## 1. 文档用途

| 项目 | 内容 |
|---|---|
| 状态 | <code>FORMAL / CONTROLLED BACKLOG</code> |
| 基准日期 | 2026-07-17（Asia/Ho_Chi_Minh） |
| 事实截止点 | <code>dc998ad601e8f2019e6a683202225a58a849ef16</code> |
| 应用发布来源 | <code>a5f1ee790e885c607a2eebbf2466814b060ccbc7</code> |
| 主基准 | [YUNQIAO_PLATFORM_MASTER_BASELINE.md](YUNQIAO_PLATFORM_MASTER_BASELINE.md) |
| 正式决策 | [YUNQIAO_PLATFORM_AUDIT_DECISIONS.md](YUNQIAO_PLATFORM_AUDIT_DECISIONS.md) |

本文只登记技术债、风险、验证状态和开始处理前的 Gate，不授权本轮修复。状态为“已确认待修”不等于已经实现；状态为“现场完成”不等于所有恢复场景均已验证。

## 2. 字段说明

每项均包含：

- **来源编号**：正式决策 D01–D14，或第一/第二轮审计的 G/R/L/U/AUX 编号；
- **状态**：当前真实处置状态；
- **影响**：不处理或误处理的结果；
- **小程序审核影响**：是否可能触发审核稳定版保护；
- **是否需重新上传**：是否需要重新构建/提交微信小程序；
- **推荐时机**：建议进入哪一发布窗口；
- **处理前 Gate**：动手前必须完成的讨论、测试和回滚条件；
- **当前真实验证状态**：代码、生产、自动化或现场证据的准确边界。

## 3. P0 后端安全与权限

### P0-01 员工停用/删除后的旧会话

| 字段 | 内容 |
|---|---|
| 来源编号 | D01；第一轮 R01；第二轮 P01 |
| 状态 | <code>已确认待修 / MUST_FIX P0</code> |
| 影响 | 已停用或删除员工的旧 JWT 可继续调用普通商家 API，最长窗口取决于 Token 到期 |
| 小程序审核影响 | 否；商家认证链 |
| 是否需重新上传 | 否 |
| 推荐时机 | 下一次任何商家业务生产发布前的独立 Auth Gate |
| 处理前 Gate | 统一实时员工/商家 ACTIVE 校验；覆盖所有商家 Controller；401/403 契约、缓存和 Android Web 会话回归 |
| 当前真实验证状态 | 代码确认普通 JwtAuthGuard/MerchantRoleGuard 不查数据库；打印中心已有实时 Guard；尚未修复 |

证据：
[jwt-auth.guard.ts](../../apps/api/src/common/guards/jwt-auth.guard.ts#L12)、
[merchant-role.guard.ts](../../apps/api/src/common/guards/merchant-role.guard.ts#L13)、
[active-merchant-staff.guard.ts](../../apps/api/src/modules/printing/guards/active-merchant-staff.guard.ts#L16)。

### P0-02 降权、改密和重置后的旧权限

| 字段 | 内容 |
|---|---|
| 来源编号 | D02；第一轮 R01；第二轮 P01 |
| 状态 | <code>已确认待修 / MUST_FIX P0</code> |
| 影响 | 降权员工继续使用旧 OWNER/MANAGER claim；改密或重置无法驱逐遗失设备与旧会话 |
| 小程序审核影响 | 否 |
| 是否需重新上传 | 否 |
| 推荐时机 | 与 P0-01 同一个 Auth Gate |
| 处理前 Gate | 会话版本/撤销机制、当前会话 UX、并发请求和多设备测试；不能只缩短前端缓存 |
| 当前真实验证状态 | role/passwordHash/mustChangePassword 更新不改变旧 JWT；生产审计 TTL 为 7 天；尚未修复 |

证据：
[merchant-staff.service.ts](../../apps/api/src/modules/merchant-staff/merchant-staff.service.ts#L56)、
[auth.service.ts](../../apps/api/src/modules/auth/auth.service.ts#L185)。

### P0-03 首次改密最小 API

| 字段 | 内容 |
|---|---|
| 来源编号 | D03；第二轮 P05-C |
| 状态 | <code>已确认待修 / MUST_FIX P0</code> |
| 影响 | 使用固定初始密码或临时密码登录后，可绕过前端重定向直接调用经营 API |
| 小程序审核影响 | 否 |
| 是否需重新上传 | 否 |
| 推荐时机 | 与 P0-01/P0-02 同批 Auth Gate |
| 处理前 Gate | 列出最小 API 白名单；验证 merchant-admin、cashier、Android 改密路径；服务端 fail-closed |
| 当前真实验证状态 | OWNER 的 <code>12345678 + mustChangePassword</code> 已实现；服务端业务 Guard 尚未限制最小 API |

证据：
[platform-merchants.service.ts](../../apps/api/src/modules/platform/platform-merchants.service.ts#L603)、
[auth.service.ts](../../apps/api/src/modules/auth/auth.service.ts#L97)。

## 4. P1 后端兼容与加固

| ID / 来源编号 | 状态 | 影响 | 小程序审核影响 / 是否需重新上传 | 推荐时机 | 处理前 Gate | 当前真实验证状态 |
|---|---|---|---|---|---|---|
| P1-01 / D06、R07 | <code>已确认待修 / MUST_FIX P1</code> | 可枚举 scene 的公开 resolver 缺少专用应用层限流，可能产生垃圾订单和枚举流量 | 有条件影响；若严格保持 scene/API/错误契约则否 / 否，否则必须新版 Gate | 独立纯后端安全发布 | 正常门店峰值、IP/设备/scene 阈值、统一错误、监控和回滚；冻结小程序契约 | 当前 resolver 公开，格式校验存在；未见专用限流；尚未修复 |
| P1-02 / D10、R08 | <code>权限表达待复核</code> | STAFF 对 PrintJob、retry、Connector 等权限面可能宽于最终产品矩阵 | 否 / 否 | 下一次打印权限发布前 | settings/printers/rules/templates/jobs/retry/cancel/connector 逐 API 矩阵和角色测试 | 顶层 Controller 允许 ACTIVE STAFF，部分配置另限 OWNER/MANAGER；产品边界已确认，代码尚未逐项收口 |
| P1-03 / D11、R11、L02/L03 | <code>Legacy 正式关闭，保护待复核</code> | 若误开 Legacy Flag，旧 Socket/TCP/LAN 可绕过平台打印总能力并真实出纸 | 否 / 否 | 下一次打印后端或运维 Flag 变更前 | 永久关闭保护、启动互斥、Merchant Gate、路由可达性和回滚分析 | 生产 Legacy Flag 关闭；旧代码仍在；不是当前现场阻断 |
| P1-04 / 第一轮 R02 | <code>部署加固</code> | 未显式设置 JWT secret 时代码存在 development fallback，错误部署可能使用弱 secret | 否 / 否 | 下一次 API 配置发布前 | 生产启动 fail-fast、secret 存在性测试、不得输出 secret | 生产报告确认 JWT_SECRET 已设置；代码 fallback 仍存在 |
| P1-05 / 第一轮 R03 | <code>输入验证待加固</code> | capability 嵌套布尔若被宽松转换，字符串 false 可能被误作 true | 可能影响页面能力 / 通常否，若响应契约不变 | 下一次平台能力 API 发布 | 严格 DTO、布尔边界单测、平台 UI 回归、生产数据不改写 | 代码审计确认风险；无生产误写数据证据 |
| P1-06 / D13、第一轮 R04 | <code>显示一致性债</code> | auth/profile 旧 capability 可能显示与 <code>Merchant.printingEnabled</code> 不一致，造成用户误判 | 否 / 否 | 下一次商家后台兼容发布 | serializer 统一但不改变执行权威；旧会话与页面刷新回归 | 新打印执行链实时查 Merchant；属于显示债，不是执行绕过 |
| P1-07 / 第一轮 U01 | <code>制品 provenance UNKNOWN</code> | 无法以逐字 SHA 证明生产全部静态 bundle 与目标源码完全一致 | 否 / 否 | 下一次 Web 发布流程建设 | build revision、manifest、release SHA、服务器原子切换和回滚校验 | Cashier release 路径与特征已确认；完整逐字证明仍 UNKNOWN |

P1-01 证据：
[qr.controller.ts](../../apps/api/src/modules/qr/qr.controller.ts#L5)。
P1-02 证据：
[merchant-printing.controller.ts](../../apps/api/src/modules/printing/controllers/merchant-printing.controller.ts#L65)。
P1-03 证据：
[printing-feature-flags.service.ts](../../apps/api/src/modules/printing/services/printing-feature-flags.service.ts#L53)。
P1-04 证据：
[app.module.ts](../../apps/api/src/app.module.ts#L39)。

## 5. 小程序新版发布 Gate 处理

| ID / 来源编号 | 状态 | 影响 | 小程序审核影响 | 是否需重新上传 | 推荐时机 | 处理前 Gate | 当前真实验证状态 |
|---|---|---|---|---|---|---|---|
| MINI-01 / D04、R06 | <code>暂缓</code> | production console 可能记录手机号、地址、位置、认证材料、tableToken、订单/聊天 payload | 是 | 是 | 下次小程序新版 | 零 payload Logger、递归脱敏、认证/QR/订单/聊天测试、微信开发者工具与真机验证 | 风险由源码/构建审计确认；当前稳定版未修改 |
| MINI-02 / D05、R07 | <code>暂缓</code> | 可枚举 <code>t{id}v{version}</code> scene 可兑换强 tableToken；换码后新 scene 仍可推导 | 是 | 是 | 下次小程序新版及门店换码窗口 | 新旧 scene/API 兼容、随机/MAC 设计、rotate、已印二维码迁移、回滚 | 强 token 本身随机；scene 当前仍可预测；本轮不改 |
| MINI-03 / D07、R05 | <code>目标锁定，代码统一暂缓</code> | QR 与 Cart/Order 使用不同能力来源，出现页面关/API 仍可下单的风险 | 是 | 很可能是 | 与 MINI-04 同一能力统一窗口 | 唯一 resolver、public serializer、QR/Cart/Order/profile 全链测试、历史 capability 对账 | 目标确认；当前双来源仍存在 |
| MINI-04 / D08、R05 | <code>目标锁定，代码统一暂缓</code> | tableManagement/dineIn/qrOrder/全局能力语义不统一，页面和服务端可能漂移 | 是 | 很可能是 | 与 MINI-03 同批 | 四条件真值表、服务端 Gate、商家 profile 写入边界、小程序全流程回归 | 未来四条件已确认；当前判断未修改 |
| MINI-05 / 恢复指令 6.1 | <code>保护中</code> | 重构 Flag/白名单可能使审核安全页面或点餐入口提前暴露 | 是 | 是 | 仅经用户批准的小程序新版 | 当前线上配置留档、审核场景、白名单/Flag 真值表、回滚包、重新审核 | 当前审核稳定版保持原样 |
| MINI-06 / 恢复指令 6.1 | <code>保护中</code> | 页面、路由、导航或文案变化可能破坏已审核版本 | 是 | 是 | 仅小程序新版 | 页面清单、路由 diff、三语言、API 契约、微信真机和审核 Gate | 当前 <code>apps/miniapp</code> 自 RC2 后无本次发布源码变化 |

代码证据：

- 敏感日志：
  [http.ts](../../apps/miniapp/src/api/http.ts#L7)；
- scene：
  [tables.service.ts](../../apps/api/src/modules/tables/tables.service.ts#L87)；
- QR 能力：
  [qr.service.ts](../../apps/api/src/modules/qr/qr.service.ts#L173)；
- Cart 堂食能力：
  [cart.service.ts](../../apps/api/src/modules/cart/cart.service.ts#L139)；
- 小程序页面：
  [pages.json](../../apps/miniapp/src/pages.json#L1)。

## 6. Legacy 保留

| ID / 来源编号 | 状态 | 影响 | 小程序审核影响 / 是否需重新上传 | 推荐时机 | 处理前 Gate | 当前真实验证状态 |
|---|---|---|---|---|---|---|
| LEG-01 / L01、G10 | <code>LEGACY_KEEP</code> | 旧 PrinterSetting/PrintLog 与新 PrintJob/Attempt 并存，历史视图不统一 | 否 / 否 | 打印历史治理窗口 | 数据归属、历史查询、回滚与删除 migration 设计 | 旧表仍在；新任务中心是正式事实源 |
| LEG-02 / D11、L02/L03 | <code>LEGACY_OFF</code> | 旧 printers CRUD/order print/服务器 TCP 路径误启可造成双路径和总 Gate 绕过 | 否 / 否 | 优先做永久关闭保护；物理删除另立窗口 | Feature Flag、路由、Merchant Gate、生产零调用证据、回滚 | 生产关闭；源码/Controller 保留 |
| LEG-03 / L04/L05 | <code>LEGACY_KEEP / 休眠</code> | Terminal pair、heartbeat、credential 与 MerchantTerminal 字段可能被误认为当前架构或被误注册 | 否 / 否 | Android/打印模型下一次大版本 | 模块注册扫描、调用统计、schema 兼容、历史 RC 回滚分析 | PrintingModule 未注册 Terminal Controller；schema/Provider 仍存在；当前 Android 不依赖 |
| LEG-04 / L06 | <code>LEGACY_KEEP</code> | merchant-admin Terminal API client/page 可能被错误恢复为正式入口 | 否 / 否 | 前端路由清理窗口 | 当前路由、历史链接、权限与回滚核对 | 文件存在，无正式路由 |
| LEG-05 / Schema Drift / Merchant Mode | <code>兼容保留</code> | 删除 DISPLAY_ONLY/PRODUCT_DISPLAY/ONLINE_ORDER/QR_ORDER 旧 enum 值可能破坏历史数据/API | 可能 / 视契约而定 | 独立数据迁移窗口 | 生产值统计、双读兼容、迁移与回滚；禁止直接改写现有 Merchant Mode | 当前规范值 DISPLAY/MANAGED；7 项声明已收口，未改生产数据 |
| LEG-06 / 第一轮 D02 | <code>兼容别名</code> | 顾客 <code>/me</code> 与 <code>/auth/me</code> 重复，贸然删除会破坏旧客户端 | 是 / 可能是 | 小程序新版和 API 兼容窗口 | 调用统计、弃用期、双路由契约测试 | 两个路由仍保留；未删除 |
| LEG-07 / L07 | <code>LEGACY_KEEP</code> | 多个无路由旧页面增加维护和误引用成本 | 否 / 否 | 前端清理窗口 | 路由/链接/截图/回滚核对 | 文件保留，正式路由已合并或重定向 |
| LEG-08 / L08 | <code>历史证据</code> | RC1 Terminal Token/配对 runbook 可能被误用于现场 | 否 / 否 | 文档治理窗口 | 明确历史标记、现场目录扫描，不覆盖原始审计证据 | 当前 RC3 不使用旧路径；历史文件仍保留 |

PrintingModule 当前只注册
[MerchantPrintingController](../../apps/api/src/modules/printing/printing.module.ts#L19)。
MerchantTerminal 模型仍存在于
[schema.prisma](../../apps/api/prisma/schema.prisma#L1085)。

## 7. 现场验证

### 7.1 已完成

| ID / 来源编号 | 状态 | 影响 | 小程序审核影响 / 是否需重新上传 | 推荐时机 | 处理前 Gate | 当前真实验证状态 |
|---|---|---|---|---|---|---|
| FIELD-01 / RC3 | <code>FIELD_PASS</code> | 覆盖升级失败会丢失既有会话/绑定或阻断现场 | 否 / 否；Android APK 已验证 | 已完成；下次 Android 版本需重跑 | 同包名、同签名、递增 versionCode、不得清数据 | RC3 覆盖安装现场 OK |
| FIELD-02 / USB | <code>FIELD_PASS</code> | 未识别/未授权会阻止本地打印 | 否 / 否 | 已完成；换设备需重跑 | 真实 USB 设备、权限与脱敏诊断 | P10/D10 USB 识别和 permission OK |
| FIELD-03 / Binding | <code>FIELD_PASS</code> | 绑定错误会使 READY fail-closed | 否 / 否 | 已完成；换打印机需重跑 | 设备/interface/endpoint 精确绑定 | 本地 Binding OK |
| FIELD-04 / Connector | <code>FIELD_PASS</code> | Connector 离线会阻止 claim/执行 | 否 / 否 | 已完成；每次大版本需冒烟 | 同一商家会话、远端 Gate、本地 Gate | 本地 Connector OK；Web 显示可打印；后台 Printer ONLINE |
| FIELD-05 / Hidden UI | <code>FIELD_PASS</code> | 入口公开化会破坏产品边界，关闭页面若误停 Connector 会中断打印 | 否 / 否 | 已完成；Android UI 变化需重跑 | 非导出 Activity、隐藏入口、“关闭页面”仅 finish | 隐藏维护页现场 UI 已验证 |
| FIELD-06 / Manual USB print | <code>FIELD_PASS</code> | 真机兼容失败会使软件 READY 无法落地 | 否 / 否 | 已完成；更换硬件/渲染策略需重跑 | 真实打印机、人工确认、无敏感订单 | 真实 USB 手动打印已验证；原两个现场阻断关闭 |

最新现场结果来源是 2026-07-17 用户确认的恢复指令。较早
<code>onsite-gate-preflight-report.md</code> 是 RC1 安装前阻断历史，
[P10_USB_PRINTER_STORE_VALIDATION.md](../testing/P10_USB_PRINTER_STORE_VALIDATION.md)
仍是未填写模板；两者不得覆盖 FIELD-01 至 FIELD-06。

### 7.2 仍待验证或证据归档

| ID / 来源编号 | 状态 | 影响 | 小程序审核影响 / 是否需重新上传 | 推荐时机 | 处理前 Gate | 当前真实验证状态 |
|---|---|---|---|---|---|---|
| FIELD-07 / 恢复指令 §9 | <code>现场待验证</code> | USB 拔插后绑定、权限或 Connector 可能不能自动恢复 | 否 / 否 | 下一次门店维护窗口 | 断开/插回、权限、重复打印防护、人工记录 | 无独立完成证据 |
| FIELD-08 / 恢复指令 §9 | <code>现场待验证</code> | P10/D10 重启后 Connector/会话/USB 可能未恢复 | 否 / 否 | 下一次可控维护窗口 | 重启前后状态、不得自动重打、人工确认 | 无独立完成证据 |
| FIELD-09 / 恢复指令 §9 | <code>现场待验证</code> | 断网/恢复可能产生 lease、重复 claim 或 UNCERTAIN | 否 / 否 | 下一次可控网络测试 | 网络隔离、任务状态、恢复和无重复打印 | 无独立完成证据 |
| FIELD-10 / 恢复指令 §9 | <code>暂不启用</code> | 自动打印若未来开启，可能重复出纸或错误恢复 | 否 / 否 | 仅未来自动打印专项 Gate | 自动创建 Flag、PrintRule、dedupe、lease、本地账本、断网/重启矩阵 | 当前自动创建/自动打印关闭，auto rule=0；未做未来现场 PASS |
| FIELD-11 / 恢复指令 §9、R09 | <code>现场/架构待验证</code> | 多打印机或多 Connector 可能竞争、归因不清 | 否 / 否 | 未来多设备版本 | 身份、claim 范围、撤销、并发和防重复设计 | 当前单现场链通过；多设备未确认 |
| FIELD-12 / D11 | <code>未来功能</code> | Android LAN Adapter 的发现、网络、协议和重复打印风险未知 | 否 / 否 | 未来 LAN 专项 | 不恢复服务器 TCP；本地 Adapter 架构、安全与门店验证 | 尚未实现/验证 |
| FIELD-13 / 发布 Gate | <code>已上线待现场业务验证</code> | 点菜/减菜/退菜在真实营业桌台的权限、金额和并发仍未人工验收 | 小程序不改 / 否 | 用户指定安全测试桌台后 | 测试商家/桌台、数据清理、业务负责人验收、不得影响真实订单 | 隔离库与自动化 PASS；生产接口已发布；真实写未执行 |
| STAFF-OPEN-01 / 开台点菜 | <code>待现场联合验证</code> | 员工开台并点菜功能在隔离库和并发/回滚语义下通过验证 | 无 / 否 | 用户指定安全测试场景后 | 无需小程序、无 Android 修改、无 migration | 已实现、已上线、待现场人工验证 |
| STAFF-OPEN-02 / 仅开台 | <code>待现场联合验证</code> | 员工仅开台在无 OPEN 时创建会话、已有 OPEN 返回冲突，且不写订单 | 无 / 否 | 用户指定安全测试场景后 | 无需小程序、无 Android 修改、无 migration | 已实现、已上线、待现场人工验证 |
| STAFF-OPEN-03 / Session 复用 | <code>待现场联合验证</code> | 顾客首单可复用员工已创建 OPEN Session，不返回 TABLE_ALREADY_OPEN | 无 / 否 | 用户指定安全测试场景后 | 无需小程序、无 Android 修改、无 migration | 自动化E2E验证PASS，待现场联合验证 |
| FIELD-14 / 证据归档 | <code>归档缺口</code> | 已完成 USB 现场结论缺少填妥、签字、照片/截图索引的独立正式报告 | 否 / 否 | 尽快补证据，不重做已通过测试除非用户要求 | 脱敏、时间/设备/APK/SHA/验收人、实物结果索引 | 最新用户确认有效；独立报告未找到；不构成当前打印阻断 |

## 8. 后续 UI、工程与功能

| ID / 来源编号 | 状态 | 影响 | 小程序审核影响 / 是否需重新上传 | 推荐时机 | 处理前 Gate | 当前真实验证状态 |
|---|---|---|---|---|---|---|
| UI-01 / G03 | <code>LATER_OPTIMIZATION</code> | 平台后台窄屏缺等价导航 | 否 / 否 | 平台移动端 UX 版本 | 页面清单、权限、响应式回归 | 代码审计确认，未修 |
| UI-02 / G04 | <code>PRODUCT_SCOPE</code> | 平台后台多处中文硬编码，运营语言范围不一致 | 否 / 否 | 先确认平台操作员语言范围 | i18n 范围、术语表、全页回归 | 未形成最终产品范围 |
| UI-03 / G05 | <code>LATER_OPTIMIZATION</code> | readonly 搜索和无行为控件造成误导 | 否 / 否 | 平台 UI 清理 | 删除或补行为、可访问性与截图回归 | 代码审计确认 |
| ENG-01 / G06 | <code>工程债</code> | merchant-admin 缺 lint/完整自动单测，回归依赖 typecheck/build | 否 / 否 | 下一次较大 Admin 变更前 | 测试框架、基线、CI 时间预算 | 当前发布 action test/typecheck/build PASS，但覆盖仍有限 |
| ENG-02 / G07、U02 | <code>工程/现场债</code> | miniapp 缺 lint/unit/E2E；线上 release、合法域名和真机证据不完整 | 是 / 新版时是 | 下次小程序新版前 | 微信后台、真机、合法域名、自动化和审核证据 | 当前审核稳定版由用户确认；工程覆盖不足仍在 |
| ENG-03 / G09 | <code>LATER_OPTIMIZATION</code> | 订单只靠 HTTP 轮询，可能有延迟与额外请求 | 否 / 否 | 业务量证明需要实时链路时 | SSE/WebSocket/FCM 选型、断线、权限和回滚 | 当前轮询生产可用 |
| ENG-04 / 第一轮 D01 | <code>维护债</code> | 多端重复 DTO 容易发生字段和枚举漂移 | 可能 / 视契约而定 | 渐进 shared-types 迁移 | 每端契约测试、版本兼容、禁止一次性重写 | <code>packages/shared</code> 尚非权威类型源 |
| ENG-05 / AUX-01 | <code>LATER_OPTIMIZATION</code> | GET conversation 带关闭过期会话的写副作用，语义和缓存不清 | 可能 / 通常否 | Chat API 整理窗口 | 调用统计、显式维护动作、兼容测试 | 代码审计观察，未单独复核生产影响 |
| ENG-06 / AUX-02 | <code>PRODUCT_SCOPE</code> | Product 类型/英文名称能力范围未明确 | 可能 / 若展示变更则是 | 产品明确后 | 模型、API、小程序/后台显示和 migration Gate | 当前不进入本轮 |
| ENG-07 / AUX-03 | <code>LATER_OPTIMIZATION</code> | 平台登录页环境身份硬编码增加误导和维护风险 | 否 / 否 | 平台登录 UI 清理 | 不记录真实账号、部署环境回归 | 代码审计确认；本文不记录身份值 |
| ENG-08 / R09 | <code>LATER_OPTIMIZATION</code> | 多物理 Connector 无独立撤销/归因 | 否 / 否 | 未来多设备需求确定后 | 不得恢复旧 Terminal Token；设计设备归因但保持统一商家账号 | 当前单 Connector 现场通过 |
| ENG-09 / R12 | <code>LATER_OPTIMIZATION</code> | nullable merchantId 的模板唯一索引不能保证全局模板唯一 | 否 / 否 | 启用全局模板管理前 | 唯一语义、数据扫描、安全 migration | 当前未证实生产冲突 |

### 8.1 明确不进入当前实现的功能

| 来源编号 | 状态 | 影响 | 小程序审核影响 | 是否需重新上传 | 推荐时机 | 处理前 Gate | 当前真实验证状态 |
|---|---|---|---|---|---|---|---|
| FUTURE-01 / 恢复指令 §9 | <code>OUT_OF_SCOPE</code> | 转桌、并桌、今日售罄、拆单/分账、折扣/赠送/免单、支付、库存、退菜单均会扩展状态机、金额、权限或端间契约 | 视功能而定 | 视功能而定 | 各自独立产品与架构任务 | 先读 Master、逐项讨论 OK、六端矩阵、数据与回滚 Gate | 本轮没有实现、修改或授权 |

## 9. 已关闭或被新证据覆盖的旧项

| 旧项 | 当前结论 |
|---|---|
| 第一轮 G01/G02：员工必须使用 12345678 | 关闭误报；D09 确认员工保持当前逻辑 |
| 第一轮 U03：打印 Feature Flag UNKNOWN | 已由只读运行证据关闭；当前 task 开、auto-create 关、execution 开、legacy 关 |
| RC1 onsite <code>BLOCKED</code> | 历史；RC3 已覆盖安装并现场通过 |
| <code>USB_BINDING_MISSING</code> | 已关闭，不是当前阻断 |
| <code>PRINTER_STATUS_NOT_READY</code> | 已关闭，不是当前阻断 |
| 较早点菜 migration Gate 的生产 Drift FAIL | 历史；17/17 migration 和最终 empty diff 已关闭 |
| 点菜功能“未部署” | 已被最终生产报告覆盖；当前为已上线待现场业务验证 |

## 10. 当前生产与打印控制快照

| 项目 | 当前真实状态 |
|---|---|
| 生产 checkout | <code>main@dc998ad...</code>，无精确 Tag |
| 应用构建来源 | <code>a5f1ee7...</code> |
| API / Admin / Cashier | HTTPS 200 |
| PM2 | <code>huayue-api</code> online |
| MySQL / migration | 8.0.46；17/17；最终 empty diff |
| 小程序 | 审核稳定版；本次未修改、未上传 |
| Android | RC3；本次文档任务未修改、未重建 |
| printingEnabled | 平台唯一数据库总能力 |
| 执行端 | 开启 |
| 自动任务创建 / 自动打印 | 关闭 / 关闭 |
| enabled 且 autoPrint 的规则 | 0 |
| 旧服务器 LAN/TCP | 关闭 |
| 真实 USB 手动打印 | 现场已验证 |
| 点菜/减菜/退菜生产写验收 | 未执行；待现场业务验证 |

证据：
[production-schema-drift-closure-audit.md](../testing/production-schema-drift-closure-audit.md#L544)
和
[merchant-item-adjustments-production-release-gate.md](../testing/merchant-item-adjustments-production-release-gate.md#L131)。

## 11. 使用规则

1. 开始任何条目前先完整读取 Master Baseline。
2. 用户未明确“讨论 OK”时，不得把本清单当作实施授权。
3. 先确认影响端、数据、审核、APK、Flag、migration 和回滚，再创建分支。
4. 一个风险组使用一个清晰发布 Gate；不得顺手修复其他组。
5. 现场 PASS、自动化 PASS、生产部署和用户业务验收必须分开记录。
6. 无法确认的事实保持 <code>UNKNOWN</code>。
7. 修复完成后必须同时更新本清单状态、证据和 Master Baseline；不得只改代码不改基准。
