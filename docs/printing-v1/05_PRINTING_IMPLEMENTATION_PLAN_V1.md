# 统一打印架构 V1：实施计划

> 文档性质：建议实施顺序。本文严格遵守已确认的 A–J 顺序；本轮只完成阶段 A 的文档，不自动开始后续阶段。
> 决策更新（2026-07-15）：A–C 的已完成范围和原始 LAN-first 计划记录继续保留；尚未开始的 D–J 改为 USB ESC/POS 优先，LAN 降为后续本地通道。硬件尚未实机验证，本文不把枚举或概念预留表述为可用。
> 阶段衔接：第一行是本文初建时的历史说明；当前任务已进入阶段 D，仅在现有 Android 终端应用内实现隔离 USB 诊断/合成 smoke 能力并构建测试 APK，不接生产 API、`PrintJob` 或正式执行链路。

## 1. 总体原则

- Web First：订单业务只实现一次，Web 收银台是面向终端的业务 UI。
- Android 是 Web 外壳和本地硬件连接器，不复制完整订单业务。
- PrintJob 是唯一任务事实来源；旧服务器直连 Socket 路径必须在新链路上线时受控退出。
- 先完成独立 Web 收银台，再建设任务中心；硬件验证结果不能被架构文档假设为成功。
- 每个阶段使用短生命周期分支、独立验收和可回滚开关，避免一个长期大分支混合数据库、前端和终端改动。
- 当前没有 Store/Branch，所有 V1 作用域使用 `merchantId`：`apps/api/prisma/schema.prisma:191-261,707-750`。

## 2. 阶段总览

```mermaid
flowchart LR
    A[阶段 A<br/>架构设计] --> B[阶段 B<br/>独立 Web 收银台]
    B --> C[阶段 C<br/>后端打印任务中心]
    C --> D[阶段 D<br/>USB 硬件验证]
    D --> E[阶段 E<br/>Android USB 连接器]
    E --> F[阶段 F<br/>手动真实订单打印]
    F --> G[阶段 G<br/>自动打印与恢复]
    G --> H[阶段 H<br/>多打印机与厨房分单]
    H --> I[阶段 I<br/>云打印]
    I --> J[阶段 J<br/>LAN 与内置打印机]
```

## 3. 阶段 A：统一打印架构设计（本轮）

| 项目 | 内容 |
|---|---|
| 开发范围 | 只读审计现有 DB/API/merchant-admin/miniapp/Android/Git 历史；定义目标架构、数据模型草案、API Contract、状态机、实施顺序和待决策项 |
| 前置条件 | 基线 `5109960`、工作区干净、独立设计分支 |
| 数据库变更 | 无；Prisma 仅以文档代码块提出草案 |
| API 变更 | 无；仅契约设计 |
| UI 变更 | 无 |
| 测试方式 | 仓库路径证据复核、跨文档一致性检查、Mermaid/Markdown 静态检查、`git diff --check` |
| 验收标准 | 7 份中文文档完整；事实与建议分开；仅 `docs/printing-v1/` 有改动；完成 docs-only Commit |
| 回滚方式 | 回退该文档 Commit；不会影响运行系统 |
| 本阶段不做 | 任何 schema、migration、API、UI、Android、打印机或部署改动 |

## 4. 阶段 B：独立 Web 收银台 V1

### 开发范围

- 新建独立 Web 收银台应用，复用当前 API、设计系统和认证模式中可复用部分，但按 1280×800 横屏重新组织信息架构。
- 第一版仅包含：商家登录、当前 Merchant、新订单、未完成订单、订单详情、接单、制作中、完成订单、桌台总览、整桌账单、手动补打/打印状态入口占位、新订单语音提醒。
- 对当前桌台语义做真实展示：TableSession 聚合同桌订单；不得把“关闭桌台会话”自动描述成所有订单已结算。
- 保持普通浏览器可用；Android 后续仅加载该 Web 收银台。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 A 决策冻结；确认登录入口和目标域名；定义支持的浏览器/WebView 下限，真实目标终端版本留到阶段 D 验证 |
| 数据库变更 | 原则上无；若发现收银台必需的业务缺口，单独评审，不夹带打印表 |
| API 变更 | 优先复用现有 merchant orders/tables/table sessions；仅补独立收银台确实缺失的查询/动作，不新增 PrintJob |
| UI 变更 | 新应用；现有 merchant-admin 只保留管理后台，不大改其信息架构 |
| 测试方式 | 单元/组件/E2E；1280×800 浏览器矩阵；三种 OrderType；输入法、返回、刷新、断网恢复；账号权限 |
| 验收标准 | 能完成上述订单/桌台核心操作；无关键横向溢出；语音提醒可控；打印入口明确显示“尚未启用”或只读状态，不伪造成功 |
| 回滚方式 | 独立部署和路由开关回退；不影响 merchant-admin 与 miniapp |
| 本阶段不做 | 完整现场点餐、交班、会员、复杂收银、真实打印、PrintJob、终端注册、自动打印 |

风险控制：当前 merchant-admin 新订单刷新依赖轮询（如 `apps/merchant-admin/src/pages/OrdersPage.vue`、`apps/merchant-admin/src/pages/DashboardPage.vue`），阶段 B 可以先沿用可靠的有限轮询；WebSocket 不是打印任务中心的前置条件。

## 5. 阶段 C：后端打印任务中心

### 开发范围

- 按评审后的模型增加 canonical `Printer`、`MerchantTerminal`、`PrintRule`、`PrintJob`、`PrintAttempt`、`ReceiptTemplate`、`ReceiptTemplateVersion` 及必要 credential/审计能力。
- 实现 ReceiptDocument 生成与不可变快照，以及可在测试中验证的 Job/幂等/事务原语；不接入生产订单事件，不在阶段 C 创建生产自动任务。
- 实现商家配置/查询、测试 Job、首次人工打印/人工补打 Job、日志、终端注册/认证/心跳/领取/续租/回报 API。
- 实现 MySQL 原子领取、租约、幂等、重试分类和云 adapter 内部接口；阶段 C 不实现实际 LAN 或云厂商 executor。
- 设计旧 `PrinterSetting`/`PrintLog` 迁移和只读历史展示；明确切换点，避免双事实源。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 B 完成；02/03/04 文档决策获批准；确认生产 MySQL 版本、备份和发布窗口 |
| 数据库变更 | 有；新增 migration、索引、FK、加密 credential 方案和数据保留策略；旧表迁移必须可审计 |
| API 变更 | 有；实现 `03_PRINTING_API_CONTRACT_V1.md` 的 V1 子集；保留兼容层但新任务不得走旧即时 Socket |
| UI 变更 | merchant-admin 增加最小 Printer/Rule/Template/Terminal/Job 管理；Web 收银台接通状态和补打入口但在无 executor 时禁止创建不可执行的生产 LAN Job |
| 测试方式 | schema/migration 回滚演练；租约并发、幂等、租户隔离、权限、PII 脱敏、快照 hash、故障注入；API 契约测试 |
| 验收标准 | DB 是唯一事实源；并发领取不重复；重复事件不双建任务；终端凭据可撤销/轮换；无硬件时任务中心仍可用模拟 adapter 验证，但模拟结果不得进入生产 |
| 回滚方式 | 发布前备份；forward-compatible migration；功能开关关闭新任务创建；代码回退保持新表不删除；不得以恢复旧 API 服务端直连 LAN Socket 作为长期回滚 |
| 本阶段不做 | 到店验证、真实 TCP、USB、厂商 SDK、云厂商账号、自动规则生产启用、后台 Android 常驻 |

原阶段 C 计划为 `LOCAL_LAN_ESCPOS` 建立枚举、配置校验和不可执行路由，并要求未经后续验证时拒绝生产 LAN Job。这是已发生的实现边界，不表示 LAN 仍是首发通道。

以上是阶段 C 按原 LAN-first 决策形成的已发生实现记录，不因 2026-07-15 的方向变化而改写。后端 `LOCAL_USB_ESCPOS` 仍只有枚举/概念预留，没有 USB 通道配置或执行；本轮在现有 Android 终端应用内新增隔离的 USB 诊断、权限、通用 adapter 和合成测试小票能力，但尚未经过目标硬件验证，也没有接入 Terminal/`PrintJob`。不能把这些 smoke 代码或现有 LAN 配置误称为正式 USB connector。生产 USB Job 在阶段 D/E 验收前必须拒绝；生产 LAN Job 则继续关闭，直到阶段 J 或后续独立 LAN 验收完成。

## 6. 阶段 D：USB 硬件可行性验证

### 开发范围

- 按独立验证流程检查目标 Android 终端的浏览器/Web 收银台体验，不把打印验证与业务写操作混在一起。
- 确认目标终端具备 USB Host 能力，并通过 Android 官方 API 观察设备枚举、权限申请、接口/端点选择、断开与重新连接。
- 在现有 `apps/merchant-terminal-android` 中使用隔离的原生 USB 诊断页和通用 smoke adapter，构建专用测试 APK；只向用户明确选择并授权的目标打印机发送一次合成 ESC/POS 测试小票，不连接云桥生产 API、Terminal API 或 `PrintJob`。
- 验证字符模式、raster 图像、纸宽、吞吐、切纸和可获得的状态反馈；中文/越南语需单独样张。
- 设备匹配规则必须由实机描述符与能力证据形成；本阶段不在文档或代码中预写固定设备型号、打印机型号或设备标识。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 C 已验收；持有目标 Android 终端、目标 USB ESC/POS 打印机、合规线材/供电与厂家资料；用户在现场提供物理操作和出纸确认 |
| 数据库变更 | 无；不得把临时测试写入生产任务表 |
| API 变更 | 无；诊断/合成测试不调用生产打印 API，也不创建 `PrintJob` |
| UI 变更 | 在现有 Android 终端应用增加隔离的原生 USB 诊断入口；WebView 收银业务和 merchant-admin 不变 |
| 测试方式 | Android lint/单元测试/测试 APK 构建；浏览器清单；USB 枚举/授权/拒绝/插拔；本轮 APK 单次连接与单次合成测试小票；字符/raster 样张和脱敏日志证据 |
| 验收标准 | 系统可稳定识别并授权目标打印机；单次点击只出一张；插拔和拒绝权限可恢复；明确 renderProfile、接口/端点选择和错误反馈边界 |
| 回滚方式 | 卸载或回退本轮诊断 APK并断开测试 USB 连接；不改云桥 API/数据库，不改变现场其他设备配置 |
| 本阶段不做 | 正式连接器、真实订单、自动打印、LAN/云打印、来源不明驱动、静默授权、任意 USB 设备访问 |

若 USB Host、权限、接口或 ESC/POS 出纸任一关键环节不可行，按阶段 D 报告停下并重新评审；不得假装通过后直接进入阶段 E，也不得自行改回 LAN 实施。

## 7. 阶段 E：Android USB ESC/POS 连接器

### 开发范围

- 在现有 Android WebView 外壳内，为阶段 D 已验证的诊断/smoke adapter 增加独立 Terminal 注册/认证、服务端打印机配置和正式 `PrintJob` 领取/租约/回报，使其成为受控 USB executor；不得直接把诊断按钮当生产执行入口。
- 将 WebView 入口切换到阶段 B 的独立 Web 收银台，并为其真实页面 Origin/资源 Host 更新最小白名单；不得继续把 merchant-admin 当最终收银 UI，也不得放宽为任意 HTTPS。
- 实现长轮询领取（失败时退化短轮询）、start/lease/succeed/fail、一次只执行一个 Job。
- 实现经阶段 D 验证的 ESC/POS renderer/profile；只访问服务端绑定且 Android 已授权、能力匹配的 USB 打印机，不接受网页传入设备标识、接口、端点或任意打印字节。
- WebView 与打印连接器通过受控 App 内部协调层展示状态；不暴露可传任意字节或任意地址的 JavaScript Bridge。
- 阶段 E/F 只保证 App 前台的领取与执行；持久执行台账、进程/设备重启和开机恢复属于阶段 G。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 D USB Host、授权、插拔、ESC/POS、raster/字符方案通过；阶段 C API 已稳定；Terminal credential 与 Printer 绑定可用 |
| 数据库变更 | 原则上无；如阶段 D 发现 capability schema 必须调整，单独小 migration 评审 |
| API 变更 | 只做契约修正和兼容；不重新设计任务模型 |
| UI 变更 | Android 原生终端绑定、USB 授权/连接状态和错误诊断；“测试连接”只做不出纸诊断，“测试打印”必须创建 `source=TEST` PrintJob，不能另走直连旁路；Web 收银台显示只读打印状态 |
| 测试方式 | Android USB mock/单元测试 + 真机；授权允许/拒绝、插拔、设备不匹配、写入超时、按钮防重、进程生命周期和契约测试 |
| 验收标准 | App 加载独立 Web 收银台且 Origin 白名单正确；测试 PrintJob 可被唯一领取、通过已授权 USB 打印机真实出纸并回报 Attempt；无任意 device/bytes bridge；终端撤销后不能领取；App 前台使用稳定 |
| 回滚方式 | 服务端禁用 Terminal/Printer/本地通道；回退 APK；未执行 Job 保留并可取消，不切回旧服务端 Socket |
| 本阶段不做 | 真实订单自动打印、开机恢复、复杂后台常驻、LAN、云打印、多打印机分单 |

## 8. 阶段 F：手动真实订单打印

### 开发范围

- Web 收银台订单详情创建人工打印/补打 Job；首次打印从当前订单和已发布模板生成快照，历史补打默认复制原 Job 快照。
- 展示任务、Attempt、失败、结果不确定和补打标识；要求补打原因并审计操作者。
- 用少量测试订单验证完整链路：Web→API→DB→Android→USB ESC/POS 打印机→结果回报。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 E 测试 Job 真机通过；确认测试商家、测试订单、模板、打印机和隐私处理；对试点商家先关闭旧 `OrdersService → PrintersService.printOrder()` 自动直打，避免旧自动与新手动 Job 双打 |
| 数据库变更 | 原则上无；使用阶段 C 模型 |
| API 变更 | 启用人工订单打印/补打契约；只修复真实链路暴露的问题 |
| UI 变更 | Web 收银台手动打印、补打原因、打印状态/日志；merchant-admin 可诊断 |
| 测试方式 | DINE_IN/PICKUP/DELIVERY 测试订单；内容快照；重复点击/HTTP 重试；失败与人工补打；客户 PII 脱敏 |
| 验收标准 | 单次操作只产生预期份数；小票内容正确；失败可见；补打新建 Job 且标识清楚；原成功 Job 不被重开 |
| 回滚方式 | 关闭手动打印 capability/UI；保留审计和历史，不删除任务 |
| 本阶段不做 | 自动规则启用、后台恢复、多打印机、厨房分单、LAN/云打印 |

## 9. 阶段 G：自动打印与恢复

### 开发范围

- 将获批 triggerEvent 的订单事件通过同事务或可靠 outbox 创建自动 Job；完成所有启用商家的旧 `OrdersService → PrintersService.printOrder()` 即时执行路径退出。
- 启用自动幂等、重试、告警、心跳、连接器本地执行台账、进程/设备重启对账、网络恢复。
- 根据 Android 13 约束实现必要的前台服务/开机恢复；权限、通知和电池优化必须透明，不做 Device Owner/kiosk。
- WebSocket/FCM 仅可作为唤醒加速，数据库任务与 claim 仍是可靠机制。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 F 连续真机通过；用户确认各 OrderType 触发点、未知结果策略和自动重试参数 |
| 数据库变更 | 原则上无；如需 outbox/事件唯一键，作为本阶段前置 migration 单独评审 |
| API 变更 | 自动触发器、恢复协调器、告警/健康状态；契约兼容 |
| UI 变更 | Rule 启停、失败告警、自动/补打标识、终端后台状态；Android 前台服务通知和恢复诊断 |
| 测试方式 | 重复订单事件、API重启、进程回收、目标终端重启、API网络中断、USB打印机断开/重连、回报丢失、租约竞争、长时间 soak test |
| 验收标准 | 自动任务不丢且不因重复事件双建；明确失败可恢复；未知结果不盲打；重启后可对账；旧即时路径不再执行 |
| 回滚方式 | 逐商家/规则关闭自动 Job 生成；保留手动打印与任务查询；停用后台 connector，不恢复双通道 |
| 本阶段不做 | 厨房分类分单、LAN、云打印、厂商内置 SDK |

## 10. 阶段 H：多打印机和厨房分单

### 开发范围

- 扩展 PrintRule 支持前台/厨房/水吧、多目标、菜品分类过滤和受控分单。
- 定义客单、厨房总单、厨房分单、加菜单、退菜单等真正需要的 ReceiptType；不直接照搬竞品。
- 明确一条规则的 copies、多 Printer、部分失败和 requestGroup 展示。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 G 单打印机稳定；云桥实际厨房流程和分类数据调研完成 |
| 数据库变更 | 可能；受控 filterConfig、商品分类快照或规则目标关系需 migration |
| API 变更 | 规则预览/冲突检测、分组任务和部分失败查询 |
| UI 变更 | merchant-admin 规则配置/预览；厨房用途和分单日志；Web 收银台组状态 |
| 测试方式 | 多打印机并发、类别边界、加菜/退菜、部分离线、多份、规则版本迁移 |
| 验收标准 | 每个业务事件产生可解释的目标任务；无漏项/重复项；部分失败可单独处理 |
| 回滚方式 | 禁用复杂规则，回到单前台规则；保留已生成快照和日志 |
| 本阶段不做 | 云厂商、LAN、厂商内置 SDK、任意表达式脚本、未经需求确认的竞品模板全集 |

## 11. 阶段 I：云打印

### 开发范围

- 按真实商业选择逐个实现 `CLOUD_FEIE`、`CLOUD_XINYE` 或 `CLOUD_GPRINTER` adapter；一次只接一个厂商。
- 服务端加密 credential、独立 worker/可恢复执行循环、厂商 idempotency/status 查询、限流和错误映射。
- ReceiptDocument 转厂商格式；不向网页或 Android 下发密钥。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 H 已验收；选定厂商、正式文档/测试设备/账号、合规和费用批准 |
| 数据库变更 | PrinterCredential/厂商 metadata 若阶段 C 预留不足，做最小 migration |
| API 变更 | 服务端内部 adapter；商家只见脱敏配置状态和统一 Job，不见 credential |
| UI 变更 | merchant-admin 厂商绑定/状态/错误；不在 Web 收银台暴露密钥 |
| 测试方式 | 厂商 sandbox/测试机、超时、限流、重复提交、状态查询、credential轮换、费用与配额 |
| 验收标准 | 同一 PrintJob 经云 adapter 可追踪；厂商响应映射 Attempt；密钥不泄漏；超时不盲目重复 |
| 回滚方式 | 禁用单一 cloud adapter/Printer；任务停止新领取；不影响已验证的 USB 通道 |
| 本阶段不做 | 同时接入所有厂商、把 SDK/密钥放入网页或 Android、修改本地 USB 状态语义 |

## 12. 阶段 J：LAN 与厂商内置打印机

### 开发范围

- 在已有 adapter 接口上按真实设备优先级实现 `LOCAL_LAN_ESCPOS`、`BUILTIN_SUNMI`、`BUILTIN_IMIN`。
- LAN 只允许 Android 本地连接器访问受控私网 endpoint，服务器和网页均不得直连；内置打印机使用官方受信 SDK，并隔离为 adapter。
- 能力探测、纸宽、状态回执和 renderer profile 均以具体机型实测为准。

| 项目 | 内容 |
|---|---|
| 前置条件 | 阶段 I 已验收；拥有真实 LAN/内置打印设备、官方 SDK/协议和许可证；现场网络与安全评审通过 |
| 数据库变更 | 通常只增加 capability/config schema version；确需强类型字段再 migration |
| API 变更 | 统一 Job/Attempt 不变；增加受控 channel config 和 error mapping |
| UI 变更 | Android LAN/内置设备诊断；merchant-admin 通道配置 |
| 测试方式 | 每个通道/机型真机；LAN 断网、地址变化和超时；内置 SDK 异常、进程重启及兼容性回归 |
| 验收标准 | 新 adapter 不改变统一任务语义；权限最小；断连和回报丢失按相同可靠性规则处理 |
| 回滚方式 | 按 channel/adapter 功能开关禁用；保留 USB/云通道 |
| 本阶段不做 | 服务器直连商家 LAN、任意地址/端口访问、来源不明 SDK、让厂商 SDK 侵入订单业务 |

## 13. Git 分支拆分建议

所有名称为建议，实际从各阶段已验收主干/集成基线创建；每个 PR 只处理一个可审查主题。

| 阶段 | 建议分支/PR |
|---|---|
| A | `design/printing-architecture-v1` |
| B | `feature/merchant-pos-web-shell`、`feature/merchant-pos-orders`、`feature/merchant-pos-tables`、`feature/merchant-pos-terminal-ui` |
| C | `feature/printing-schema-v1`、`feature/printing-job-core`、`feature/printing-terminal-auth`、`feature/printing-merchant-api`、`feature/printing-admin-ui` |
| D | `apps/merchant-terminal-android` 内的隔离 USB 诊断/合成 smoke 能力与测试 APK；硬件证据单独保存为脱敏报告 |
| E | `feature/android-terminal-enrollment`、`feature/android-usb-escpos`、`feature/android-print-diagnostics` |
| F | `feature/manual-order-printing` |
| G | `feature/automatic-print-trigger`、`feature/android-print-recovery`、`feature/printing-alerts` |
| H | `feature/printing-routing-rules`、`feature/kitchen-ticketing` |
| I | 每厂商独立，例如 `feature/cloud-print-feie` |
| J | 每通道/厂商独立，例如 `feature/android-lan-print-adapter`、`feature/sunmi-print-adapter` |

分支约束：

- schema migration、后端、管理 UI、Android adapter 不混在一个不可回退的大 Commit 中。
- migration 合入后优先 forward fix；不得在已部署环境删除历史 migration。
- 旧打印链路切换使用显式 feature flag/商家白名单，保证同一商家同一事件只有一个任务产生源。
- 阶段 D 的临时脚本、APK、账号和硬件日志不进入正式项目；必要的脱敏结论以文档单独提交。
- 每阶段验收后再从更新后的基线创建下一阶段分支，不在本设计分支继续写功能。

## 14. 跨阶段门禁

| 从 | 到 | 必须满足 |
|---|---|---|
| A | B | 架构/术语/待决策清楚，用户批准 Web 收银台范围 |
| B | C | 独立收银台核心订单与桌台流程可用，不依赖打印完成 |
| C | D | 任务模型/API可测试，生产自动规则保持关闭，硬件验证计划获批准 |
| D | E | 目标 Android 终端与目标 USB 打印机的 Host、授权、接口/端点、ESC/POS/render profile 有真实证据 |
| E | F | 测试 Job 真机成功，终端认证/租约/回报可验证 |
| F | G | 人工真实订单打印稳定，内容和未知结果处理获确认 |
| G | H | 自动打印经断网/重启/重复事件 soak test |
| H | I | 统一规则和日志能承载新通道，选定真实云厂商 |
| I | J | adapter 边界稳定，持有真实 LAN/内置打印设备、现场网络和官方资料 |
