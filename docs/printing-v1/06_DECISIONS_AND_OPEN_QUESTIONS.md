# 统一打印架构 V1：决策与待确认问题

> 本文是决策登记表。只有“已确认”部分是产品方向；“本轮建议”仍需在对应阶段开始前确认，不能作为已批准功能实施。

## 1. 已确认方向与变更记录

### 1.1 当前有效决策（2026-07-15 更新）

| 决策 | 已确认内容 | 约束 |
|---|---|---|
| 产品形态 | Web First | 订单业务不在 Android 重写一套 |
| 收银界面 | 后续新增独立 Web 收银台 | 现有 merchant-admin 继续承担管理后台，不作为最终收银 UI |
| Android 定位 | Web 收银台外壳 + 本地打印连接器 | 不承载完整商家订单业务 |
| 打印核心 | 所有正式打印先形成统一 PrintJob | 浏览器、Android 本地队列、WebSocket 均不是任务事实源 |
| 通道方向 | 同一任务中心支持本地与云打印 | 通道由受控 adapter 隔离 |
| 第一优先本地通道 | USB ESC/POS | 尚未完成目标终端与目标打印机实机验证；枚举或概念预留不等于可用 |
| 后续通道 | LAN ESC/POS、云打印、厂商内置打印机 SDK | LAN 不删除，只从首发通道降为后续受控 adapter；其他通道仍按真实硬件与官方资料单独评审 |
| 硬件顺序 | 架构、Web 与任务中心之后先验证 USB | 不预设设备标识、接口、端点、协议、字符集、切纸或状态回执 |
| 实施顺序 | A 架构 → B Web 收银台 → C 任务中心 → D USB 硬件验证 → E Android USB → F 手动真单 → G 自动打印 → H 多机分单 → I 云打印 → J LAN/内置 | A–C 已完成的记录不重写；后续阶段按本次决策执行 |

### 1.2 已被取代但保留的历史决策

以下是本文最初确认的通道顺序摘要，已于 2026-07-15 被 1.1 的 USB-first 决策取代。保留这些历史决策是为了追溯，不再作为后续实施依据；原始逐字版本仍可由对应 Git 历史核对：

| 决策 | 原确认内容 | 原约束 | 当前状态 |
|---|---|---|---|
| 第一优先本地通道 | LAN ESC/POS | 尚未通过目标终端/打印机真机验证，不得写成已可用 | 已被 USB ESC/POS 首通道决策取代 |
| 后续通道 | USB ESC/POS、云打印、厂商内置打印机 SDK | 只预留概念，不在 V1 一次性实现 | USB 已提升为首通道；其余仍为后续 |
| 硬件顺序 | 架构与 Web/任务中心之后到店验证 LAN | 不假设 IP、端口、协议、字符集、切纸或状态回执已确认 | LAN 验证后移，先做 USB 实机验证 |
| 实施顺序 | A 架构 → B Web 收银台 → C 任务中心 → D LAN 硬件验证 → E Android LAN → F 手动真单 → G 自动打印 → H 多机分单 → I 云打印 → J USB/内置 | 除不可绕过依赖外不得自行调整 | D–J 的未来顺序已由 1.1 取代 |

## 2. 当前事实约束

以下不是新决策，而是方案必须遵守的仓库事实：

- 当前数据库为 MySQL：`apps/api/prisma/schema.prisma:5-8`。
- 当前无 Store/Branch，Merchant 是业务和数据隔离作用域：`apps/api/prisma/schema.prisma:191-261`。
- 当前已有 `PrinterSetting`/`PrintLog`，以及 API 服务器直接 Socket 打印；不存在统一 Job/Attempt/Terminal：`apps/api/prisma/schema.prisma:707-750`；`apps/api/src/modules/printers/printers.service.ts:205-367`。
- 当前自动打印发生在订单创建后的 `PENDING_ACCEPTANCE` 阶段，并非已确认的未来产品规则：`apps/api/src/modules/orders/orders.service.ts:56-64,128-146`。
- `TableSession.CLOSED`、`Order.status=COMPLETED`、`Order.settlementStatus=SETTLED` 当前不是同一状态变化：`apps/api/src/modules/table-sessions/table-sessions.service.ts:121-165`；`apps/api/src/modules/merchant-orders/merchant-orders.service.ts:158-175`。
- 当前 Android 仍以 WebView 外壳为主，本轮已在同一应用内加入隔离的 USB 设备诊断、系统权限、通用 ESC/POS smoke adapter 和合成测试小票能力；这些能力尚未经过目标硬件验证，也不连接生产 API/`PrintJob`。正式终端认证、任务领取/租约/回报、Room、WorkManager、Foreground Service 和生产 USB executor 仍不存在：`apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/diagnostics/`；`apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/printing/`。

## 3. 需要本轮给出建议

这些是本轮架构建议，不自动等于用户最终批准。

| 议题 | 本轮推荐 | 理由 | 最迟确认阶段 |
|---|---|---|---|
| 商家/门店归属 | V1 所有模型只用 `merchantId` | 当前没有 Store/Branch；虚构 storeId 会形成无来源权限 | C |
| V1 任务领取 | MySQL PrintJob + 单一 bounded long-poll claim loop + 原子条件更新/租约；代理不支持时退化 10–15 秒短轮询 | 与当前 NestJS/Prisma/MySQL兼容；断网不丢；不必先引入消息中间件 | C/E |
| Receipt 内容 | 服务器生成不可变、结构化 ReceiptDocument；本地 adapter 按经硬件验证的 profile 渲染；云 adapter 转厂商格式 | 兼顾多语言、58/80mm、二维码、云通道和历史补打 | C/D |
| 图片文字策略 | 设计首选 Android 使用固定字体的 raster/Bitmap；阶段 D 验证点宽、命令和吞吐后才能确认 | 中越英字符集更一致，但硬件能力尚未验证 | D/E |
| Job 状态 | `PENDING/CLAIMED/PRINTING/SUCCEEDED/FAILED/RETRY_WAIT/CANCELLED`；结果未知用 `FAILED + PRINT_OUTCOME_UNKNOWN + retryBlocked` | 避免增加模糊状态，同时阻止盲目自动重打 | C |
| Terminal 认证 | 一次性绑定码 + Android Keystore 生成高熵 terminal secret + 服务端 tokenHash + 短期 Terminal JWT；关键请求查 DB status/tokenVersion | 响应丢失时设备仍持有自己生成的凭据；不长期复用员工 JWT | C/E |
| 测试打印 | 正式产品测试也创建 `source=TEST` PrintJob；阶段 D 不接生产 API、只含合成内容的 USB 硬件 smoke 是受控例外 | 产品测试验证完整链路并留下统一日志；硬件 smoke 只验证设备能力，不形成第二执行通道 | C/E |
| 首次自动触发 | 默认建议 `ORDER_ACCEPTED`，按 DINE_IN/PICKUP/DELIVERY 独立规则且初始 disabled | 比当前顾客下单即打更少无效单；仍需业务确认 | G |
| 模板版本 | `ReceiptTemplate` + 发布后不可变的 `ReceiptTemplateVersion`；Job 冻结版本和内容快照 | 规则变更不能改变历史任务/补打内容 | C |
| 多份打印 | 每一份展开为一个 PrintJob，用 copyIndex 去重 | 能准确表示某一份失败，而不是在一条日志里循环 | C |
| 不确定结果 | 不自动重试；连接器对账后仍未知则由人员确认并创建补打新 Job | RAW Socket 通常无法证明纸张是否物理输出 | F/G |

## 4. 后续需用户确认

### 4.1 旧打印表和旧执行路径的迁移方式

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 原地扩展 `PrinterSetting`/`PrintLog` | 表少 | 旧日志、任务、Attempt 和通道语义混在一起；迁移风险大 |
| B. 新建 canonical 表，迁移配置并只读保留旧日志 | 边界清楚；可逐商家切换；新 Job 不被旧薄日志限制 | 需要兼容展示和一次性数据迁移 |

**推荐：B。** 新 Printer 保存 `legacyPrinterSettingId` 映射；新 Job 只引用新 Printer ID；旧 PrintLog 仅作为 `legacy` 历史展示，不运行时双读择一。切换时必须同时关闭该商家的旧即时 `printOrder()`，防止双打。

不确认会影响：阶段 C schema、migration、灰度开关和回滚方案。

### 4.2 V1 首批 ReceiptType

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. `TEST` + `ORDER_RECEIPT` | 最小可闭环；符合阶段 F 手动订单打印 | 厨房流程暂不覆盖 |
| B. 同时增加厨房单、预结单、结账单、加/退菜单 | 一次看似完整 | 业务事件、桌台结算和分单尚未定义，容易照搬竞品 |

**推荐：A。** 枚举可预留受控名称，但只实现和启用 `TEST`、`ORDER_RECEIPT`。厨房/账单类留到 H 或完成真实业务定义后。

不确认会影响：阶段 C 模板、快照 schema、阶段 F 验收样张。

### 4.3 各订单类型的首次自动打印触发点

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 全部 `ORDER_CREATED` | 最快；延续当前行为 | 未接单也打印，取消/无效单风险高 |
| B. 全部 `ORDER_ACCEPTED` | 业务意图明确，减少无效纸张 | 接单前依赖 Web/声音提醒 |
| C. 按 OrderType 配置 | 最贴合堂食/自取/配送 | 需要逐流程验收和配置管理 |

**推荐：数据模型支持 C，V1 默认规则采用 B 且 disabled。** 在阶段 G 开始前确认是否堂食厨房单需要 `ORDER_CREATED`。

不确认会影响：阶段 G 自动任务生成，不阻塞阶段 B–F。

### 4.4 桌台“完成结账”的真实业务语义

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. TableSession CLOSED 即视为桌账已结 | 实现简单 | 与当前独立 `settlementStatus` 不一致，可能错误打印结账单 |
| B. 先补齐显式结算事件/状态，再定义预结/结账票 | 语义可审计 | 需订单/桌台业务专项设计 |

**推荐：B。** 阶段 B 先如实展示当前状态；在设计账单类打印前完成业务决策。本轮不修改订单或桌台逻辑。

不确认会影响：预结单/结账单 ReceiptType 和阶段 H，不阻塞基础客单。

### 4.5 一台本地 Printer 的活动 Terminal 数量

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. V1 同时只绑定一个 ACTIVE Terminal | 领取和物理设备所有权清楚；降低重复 | 终端坏掉需人工重新绑定 |
| B. 多终端竞争同一 Printer | 可高可用 | 同一局域网设备并发、切换和结果未知显著复杂 |

**推荐：A。** 数据库/服务校验一台 local Printer 只有一个主 Terminal；高可用切换在稳定后设计。坏机重绑时，仅允许把没有 Attempt 且处于 `PENDING/RETRY_WAIT` 的 Job 做审计式原子 retarget；`CLAIMED/PRINTING` 不迁移，先完成租约或结果未知处理。

不确认会影响：阶段 C 约束、阶段 E 领取和恢复。

### 4.6 Receipt 渲染 profile

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 字符模式 | 数据小、速度快 | 中文/越南语重音依赖打印机代码页，跨机型不一致 |
| B. 固定字体 Bitmap/raster | 中越英视觉一致，可带 Logo/二维码 | 数据大、速度慢；必须验证 raster 命令、点宽和缓存 |
| C. 混合模式 | 可优化性能 | profile/回归矩阵复杂 |

**推荐：设计首选 B，但以阶段 D 真机结果为门禁。** 如果目标 USB 打印机的 raster 能力或效果不可接受，再选择经过实测的 A/C；不能仅凭型号或协议名称猜测。

不确认会影响：阶段 E renderer，不阻塞任务中心的结构化快照。

### 4.7 `PRINT_OUTCOME_UNKNOWN` 的人工策略

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 自动重试 | 尽量不漏单 | 很可能重复出纸 |
| B. 阻止自动重试，人员确认后补打 | 控制重复；审计清楚 | 需要现场处理，可能延迟 |

**推荐：B。** UI 显示“可能已出纸”；不能把它显示成普通连接失败。人工操作生成新 `MANUAL_REPRINT` Job。

不确认会影响：阶段 F/G 交互和告警。

### 4.8 Job、Attempt 与 Receipt PII 保留期限

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 所有快照长期保留 | 随时可按原内容补打 | 客户姓名、电话、地址长期暴露风险高 |
| B. 状态/错误长期，完整快照短期加密保留，过期后删除或不可逆脱敏 | 隐私风险更低 | 过期后不能保证按原小票补打 |

**推荐：B。** 初始建议：完整 receipt snapshot 加密保留 90 天，Attempt 诊断 180 天，任务审计摘要 1 年；正式期限需结合越南法规、业务售后和基础设施成本确认。过期后 UI 必须明确“原始内容已过保留期，无法原样补打”，不能静默用当前订单替代。

不确认会影响：阶段 C 数据保留任务、加密、备份和日志 UI。

### 4.9 LAN 地址安全边界

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 仅 RFC1918 literal IPv4 + 受控端口 | 最小化利用终端扫描网络/访问特殊地址的风险 | 某些现场可能使用非典型私网或受控 DNS |
| B. 任意合法 IP/hostname | 兼容性广 | 容易成为局域网探测/SSRF 通道，DNS 重绑定风险高 |

**推荐：A 作为后续 LAN adapter 默认。** 阻止 loopback、link-local、multicast、unspecified、broadcast 和公网地址；host/port 只能来自绑定 Printer 配置，ReceiptDocument/网页不能指定。若阶段 J 或后续独立 LAN 实机验证发现真实网络不符合，再对特定范围做审计例外。

不确认会影响：现有阶段 C LAN DTO 契约，以及阶段 J 或后续 LAN adapter 的 Android 二次校验；不阻塞当前 USB 硬件 smoke。

### 4.10 终端注册码与凭据轮换流程

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. 一次性绑定/轮换码 + 独立 Terminal secret | 可撤销、轮换、审计；不暴露员工 Token | 需 EnrollmentCode 状态与 Android Keystore |
| B. 长期复用 MerchantStaff JWT | 实现快 | 员工离职/密码变更/设备丢失难撤销，权限过大 |

**推荐：A。** code 验证只用 hash、短时有效、原子消费、限制尝试；同一创建请求的明文 code 仅用短 TTL 信封加密 escrow 支持响应重放，消费/过期即销毁。Android 在 Keystore 生成新 secret 并随 ENROLL/ROTATE code 经 TLS 提交，服务器只存 tokenHash；轮换时保留 terminalId，事务成功后递增 tokenVersion。即使响应丢失，设备仍持有新 secret。每次 claim/lease/report 读取 Terminal 当前 status/tokenVersion，不只信 JWT 声明。

不确认会影响：阶段 C Terminal 模型/API、阶段 E 安全实现。

## 5. 不应在本轮决定的事项

- 首个目标 USB 打印机的设备描述符、接口/端点、ESC/POS、raster、切纸和状态查询能力；阶段 D 以实际硬件验证，不预写固定标识。
- 目标 Android 终端是否具备稳定 USB Host、授权、插拔恢复、后台常驻和开机恢复能力；阶段 D/G 真机验证。
- 选择飞鹅、芯烨、GPrinter 中哪一家；阶段 I 前完成商务、设备和 API 调研。
- 后续 LAN 打印机的地址、端口、协议和网络条件，以及厂商内置 SDK 版本与权限；阶段 J 依据真实设备与官方资料。
- 厨房分类、档口、加菜/退菜票的最终规则；阶段 H 先做业务调研。

## 6. 决策更新规则

- 用户确认后，将条目从“后续需用户确认”移动到“已确认”，记录日期、选择和影响阶段。
- 已被后续决策取代的条目不得删除或无痕改写；应保留原内容、标明取代日期，并指向当前有效决策。
- 硬件结论必须引用阶段 D 的终端与打印机、连接方式、系统权限、接口/端点、命令、样张和脱敏日志证据。
- 决策变更不得改写已完成 PrintJob 的 receipt snapshot、templateVersion、ruleVersion 或 Attempt 历史。
- 若某一决策会改变阶段顺序，必须先说明不可绕过依赖和回滚影响，再获得明确批准。
