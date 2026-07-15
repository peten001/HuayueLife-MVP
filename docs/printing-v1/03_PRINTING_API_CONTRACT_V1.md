# 统一打印架构 V1：API Contract

> 文档性质：建议契约，不代表接口已实现。所有路径均带现有全局前缀 `/api/v1`。
> 当前真实打印 API 见 `00_CURRENT_STATE_AUDIT.md`，新契约不得与旧服务器直连 TCP 同时执行。
> 决策更新（2026-07-15）：首个本地执行通道改为 USB ESC/POS。本文既有 LAN DTO/响应示例因当前后端只实现了 LAN 配置校验且 LAN 仍是后续通道而保留；它们不代表 LAN 继续优先。正式 USB contract 必须等待门店设备证据后另行冻结，当前 Android 合成 smoke 不连接本 API、Terminal 或 PrintJob。

## 1. 沿用的 API 约定

当前 NestJS 约定：

- 全局前缀 `/api/v1`：`apps/api/src/main.ts:14-16`。
- 成功响应统一为 `{code,message,data,requestId,timestamp}`，BigInt 转字符串：`apps/api/src/common/interceptors/response.interceptor.ts:21-48`。
- 错误同样包含 `code/message/data/requestId/timestamp/path`：`apps/api/src/common/filters/all-exceptions.filter.ts:17-70`。
- 商家 API 使用 Bearer JWT、MerchantRoleGuard 和 JWT 中 merchantId：`apps/api/src/common/guards/jwt-auth.guard.ts:15-28`；`apps/api/src/common/decorators/merchant-id.decorator.ts:8-18`。

建议延续以上格式，不另造 GraphQL、RPC 或微服务协议。

### 1.1 成功包装

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "requestId": "req_example",
  "timestamp": "2026-07-14T00:00:00.000Z"
}
```

创建异步 PrintJob 返回 HTTP 202；查询返回 200；配置创建返回 201。NestJS 的 POST 默认是 201，因此异步 controller 必须显式使用 `@HttpCode(HttpStatus.ACCEPTED)`；统一 interceptor 只包装 body，不改变 HTTP status：`apps/api/src/common/interceptors/response.interceptor.ts:21-29`。

### 1.2 建议身份类型

| 身份 | 认证 | 允许能力 |
|---|---|---|
| Merchant OWNER/MANAGER | 当前 MerchantStaff JWT | 配置 Printer/Rule/Template/Terminal，查看日志，测试和补打 |
| Merchant STAFF | 当前 MerchantStaff JWT | 测试、补打和只读查询；不得改密钥/规则/终端 |
| MerchantTerminal | 新 Terminal JWT | 心跳、领取、续租、开始、成功/失败回报、状态上报 |
| PlatformAdmin | 当前 Platform JWT | 跨商家脱敏诊断和平台审计；不获取云密钥明文 |
| Cloud Worker | 服务内部身份 | 领取云任务和更新 Attempt；不暴露为普通商家 API |

终端认证建议新增 `accountType=MERCHANT_TERMINAL`，不能使用 MerchantStaff Token。当前 `MerchantCapability` 是商家级 feature 开关，不是员工级权限：`apps/api/prisma/schema.prisma:312-359,407-425`。V1 不新增 staff permission 时，权限完全按上述角色矩阵实现。

### 1.3 通用要求

- 创建 Job/requestGroup、测试、注册码和其他可能造成重复外部效果的 POST 必须接受 `Idempotency-Key`；服务端用 `IdempotencyRecord` 按身份作用域原子保存 key、requestHash、状态和资源引用。相同 key+不同 body 返回 409；相同 key+同 body 重放原资源。配置 PATCH 优先使用 `expectedVersion`，不要求把每个普通更新都塞进幂等表。
- 所有资源查询必须同时使用认证身份的 merchantId，不能只按 path id 查询。
- 配置变更、测试、补打、重试、取消、终端绑定/撤销必须写审计日志。
- 普通商家错误响应不返回堆栈、完整 receipt、Token、云密钥或内部网络详情。
- Terminal 状态变更必须同时校验 terminalId、merchantId、jobId、leaseVersion 和当前状态。
- 终端回报接口不得接受调用方自报 merchantId；merchantId 从 Terminal JWT 获取。
- 全局 ValidationPipe 已启用 transform、whitelist 和 forbidNonWhitelisted：`apps/api/src/main.ts:30-35`。新增 DTO 必须有长度、枚举、数组数量和数值范围约束；BigInt path/body ID 都用十进制字符串传输并通过 `IsNumberString` 类规则验证。
- ReceiptDocument 的 `contentHash` 对 canonical UTF-8 bytes 计算 SHA-256（64 位小写 hex）；阶段 C 明确采用 RFC 8785/JCS 或直接下发服务端 canonical bytes，Android 不对普通对象序列化结果自行猜测。

## 2. merchant-admin / Web 收银台接口

下表的“隔离”均表示服务查询带认证 merchantId，并校验关联 Order/Printer/Rule/Terminal 同属该 Merchant。

### 2.1 Printer

| 方法与路径 | 调用方/权限 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|---|
| `GET /merchant/printers` | OWNER/MANAGER/STAFF；商家级 printer feature 开启 | query: `channelType,status,enabled` 可选 | 脱敏 Printer[]；云 credential 永不返回 | `PRINT_FEATURE_DISABLED` | GET 天然幂等 | merchantId 过滤；读取可记录安全访问日志 |
| `POST /merchant/printers` | OWNER/MANAGER | PrinterCreateInput | 201 Printer | `INVALID_CHANNEL_CONFIG`、`TERMINAL_NOT_FOUND`、`PRINT_CHANNEL_NOT_SUPPORTED` | 必须 `Idempotency-Key` | 校验 Terminal 同商家；记录创建人和配置摘要 |
| `PATCH /merchant/printers/:id` | OWNER/MANAGER | 允许更新 name、binding、config、enabled、capability + `expectedConfigVersion`；不接受 credential 明文回显 | 更新后的 Printer | `PRINTER_NOT_FOUND`、`PRINTER_IN_USE`、`INVALID_CHANNEL_CONFIG`、`CONFIG_VERSION_CONFLICT` | 乐观锁；成功后 configVersion+1 | `{id,merchantId}`；记录 before/after 脱敏差异 |
| `POST /merchant/printers/:id/disable` | OWNER/MANAGER | `{reason,expectedConfigVersion}` | Printer(enabled=false)；连接 status 不充当启停状态 | `PRINTER_NOT_FOUND`、`REASON_REQUIRED`、`CONFIG_VERSION_CONFLICT` | 状态幂等；重复 disable 返回当前状态，不要求 key | 不物理删除；记录首次状态变化，重复请求不重复审计副作用 |
| `POST /merchant/printers/:id/test` | OWNER/MANAGER/STAFF | `{receiptLanguage?}`，不允许传任意 ESC/POS 字节 | 202 `{job}` | `PRINTER_DISABLED`、`TERMINAL_NOT_ACTIVE`、`CHANNEL_NOT_READY` | 每次有意识测试用新 key；同 HTTP 重试返回同 Job | 创建 source=TEST 的 PrintJob 和审计日志 |

`POST /merchant/printers/:id/test` 复用当前路由名称，但语义从“API 服务器即时 Socket”改为“创建统一 PrintJob”。旧行为证据：`apps/api/src/modules/printers/printers.controller.ts:54-57`；`apps/api/src/modules/printers/printers.service.ts:205-214`。

以下是为后续 LAN adapter 保留的示例创建请求（示例地址和端口不代表任何真实硬件已经验证，也不是当前 USB-first 配置）：

```json
{
  "name": "前台测试打印机",
  "channelType": "LOCAL_LAN_ESCPOS",
  "terminalId": "101",
  "usageType": "FRONT_DESK",
  "paperWidth": "WIDTH_80",
  "enabled": false,
  "connectionConfig": {
    "schemaVersion": 1,
    "host": "192.168.10.25",
    "port": 12345,
    "connectTimeoutMs": 5000,
    "renderProfile": "ESCPOS_RASTER_V1"
  }
}
```

本地 config 只能由绑定终端读取。V1 只接受受控 schema：literal IPv4、端口 1..65535、超时上下限、renderProfile；拒绝 URL/scheme、任意命令，以及 loopback/link-local/multicast/unspecified/broadcast/公网地址。Android 再次校验绑定关系和地址。服务器只保存，不主动连接 host/port。

Printer PATCH 更换 terminalId 时必须在单一事务内：锁定 Printer/旧终端；若存在 `CLAIMED/PRINTING` Job 则返回 `PRINTER_IN_USE`；仅把**没有 Attempt**且处于 `PENDING/RETRY_WAIT` 的任务原子 retarget 到新 ACTIVE Terminal；更新绑定并返回 `retargetedJobCount`。所有受影响 jobNo、旧/新 terminalId 和操作者进入审计，不能迁移结果不确定的任务。

云 Printer 的 credential 写接口在阶段 I、选定真实厂商后单独定义；阶段 C 只有数据边界和内部 service contract，不提供悬空的普通商家 credential API。最终响应只能返回 `configured: true` 和 displayHint，永不回显密钥。

### 2.2 PrintRule

| 方法与路径 | 调用方/权限 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|---|
| `GET /merchant/print-rules` | OWNER/MANAGER/STAFF 只读 | query: `enabled,orderType,triggerEvent` | PrintRule[] | `PRINT_FEATURE_DISABLED` | GET | merchantId 过滤 |
| `POST /merchant/print-rules` | OWNER/MANAGER | RuleCreateInput | 201 PrintRule(version=1) | `PRINTER_NOT_FOUND`、`TEMPLATE_VERSION_NOT_PUBLISHED`、`RULE_CONFLICT` | 必须 key | 校验 Printer/Template 同商家或为系统模板；审计创建 |
| `PATCH /merchant/print-rules/:id` | OWNER/MANAGER | 字段 + `expectedVersion` | PrintRule(version+1) | `RULE_NOT_FOUND`、`RULE_VERSION_CONFLICT` | 乐观锁，不要求 Idempotency-Key | merchantId 过滤；记录前后版本，不改变旧 Job |

V1 RuleCreateInput：

```json
{
  "name": "自取接单后打印前台单",
  "orderType": "PICKUP",
  "triggerEvent": "ORDER_ACCEPTED",
  "receiptType": "ORDER_RECEIPT",
  "printerId": "201",
  "templateVersionId": "301",
  "copies": 1,
  "autoPrint": true,
  "enabled": false,
  "priority": 100
}
```

规则首次创建建议默认 disabled，必须完成模板、终端和硬件校验后人工启用。

### 2.3 ReceiptTemplate

| 方法与路径 | 调用方/权限 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|---|
| `GET /merchant/receipt-templates` | OWNER/MANAGER/STAFF 只读 | `receiptType,paperWidth,language` | 系统模板 + 当前商家模板摘要 | `PRINT_FEATURE_DISABLED` | GET | 只返回系统公共和本 merchant 模板 |
| `GET /merchant/receipt-templates/:id` | OWNER/MANAGER/STAFF 只读 | 无 | Template metadata + 版本摘要 | `TEMPLATE_NOT_FOUND` | GET | 系统公共或本 merchant |
| `GET /merchant/receipt-templates/:id/versions/:versionId` | OWNER/MANAGER/STAFF 只读 | 无 | 单版本 definition/状态/hash | `TEMPLATE_VERSION_NOT_FOUND` | GET | 已发布版本只读；草稿只属本 merchant |
| `POST /merchant/receipt-templates` | OWNER/MANAGER | 模板 metadata + draft definition | 201 Template + Version(DRAFT) | `INVALID_TEMPLATE_DEFINITION` | 必须 key | merchantId 固定；保存创建审计 |
| `POST /merchant/receipt-templates/:id/versions` | OWNER/MANAGER | 基于已有版本创建新 draft | 新 Version(DRAFT) | `TEMPLATE_NOT_FOUND`、`INVALID_TEMPLATE_DEFINITION` | 必须 key | 不原地改已发布版本；审计来源版本 |
| `PATCH /merchant/receipt-templates/:id/versions/:versionId` | OWNER/MANAGER | draft definition + `expectedContentHash` | 更新后的 DRAFT/hash | `TEMPLATE_VERSION_NOT_DRAFT`、`HASH_MISMATCH` | 乐观锁 | 不允许更新 PUBLISHED；审计差异 |
| `POST /merchant/receipt-templates/:id/versions/:versionId/publish` | OWNER/MANAGER | `{expectedContentHash}` | Published Version | `HASH_MISMATCH`、`VERSION_ALREADY_PUBLISHED` | 同 hash 幂等 | 发布事务替换当前 PUBLISHED；记录发布人 |

definition 只接受受控 ReceiptDocument 模板节点，不接受 JS、HTML、任意命令或未白名单远程 URL。

### 2.4 首次人工打印、人工补打与任务查询

| 方法与路径 | 调用方/权限 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|---|
| `POST /merchant/orders/:id/prints` | OWNER/MANAGER/STAFF；商家级 orders/printer feature 开启 | `{printerIds,reason?}` | 202 `{requestGroupId,jobs[]}`，source=MANUAL_PRINT | `ORDER_NOT_FOUND`、`PRINTER_NOT_FOUND` | 必须 key；同 key 返回同组 | 从当前订单+已发布模板生成新快照；记录 staffId |
| `POST /merchant/orders/:id/reprints` | OWNER/MANAGER/STAFF；商家级 orders/printer feature 开启 | `{printerIds,reason,mode,sourceJobNo}` | 202 `{requestGroupId,jobs[]}`，source=MANUAL_REPRINT | `ORDER_NOT_FOUND`、`REASON_REQUIRED`、`SOURCE_JOB_NOT_FOUND`、`PRINTER_NOT_FOUND` | 必须 key；同 key 返回同组；再次有意补打使用新 key | 校验订单、源 Job 和打印机同商家；记录 staffId、原因、原 Job |
| `GET /merchant/print-jobs` | OWNER/MANAGER/STAFF | query: status/source/orderId/printerId/dateFrom/dateTo/cursor/limit | 分页 Job 摘要 | `INVALID_CURSOR` | GET | merchantId；PII 脱敏；查询审计按策略 |
| `GET /merchant/print-jobs/:jobNo` | OWNER/MANAGER/STAFF | 无 | Job 详情 + 脱敏 receipt 摘要 | `PRINT_JOB_NOT_FOUND` | GET | `{jobNo,merchantId}`；STAFF 不看内部诊断 |
| `GET /merchant/print-jobs/:jobNo/attempts` | OWNER/MANAGER/STAFF | cursor/limit | Attempt[] 脱敏视图 | `PRINT_JOB_NOT_FOUND` | GET | Job merchantId；平台与商家视图不同 |
| `GET /merchant/print-logs` | OWNER/MANAGER/STAFF | orderNo/jobNo/status/errorCode/printerId/dateFrom/dateTo/cursor | Job+Attempt 日志投影 | `INVALID_FILTER` | GET | merchantId；旧 PrintLog 由查询层投影 `legacy=true` |
| `POST /merchant/print-jobs/:jobNo/retry` | OWNER/MANAGER/STAFF | `{reason,expectedStatus}` | 202 更新后的同一 Job | `RETRY_NOT_ALLOWED`、`OUTCOME_UNKNOWN_REQUIRES_REPRINT`、`MAX_ATTEMPTS_REACHED` | 必须 key | 只对明确未出纸、retryBlocked=false 的 FAILED；记录操作者 |
| `POST /merchant/print-jobs/:jobNo/cancel` | OWNER/MANAGER | `{reason,expectedStatus}` | Job(CANCELLED) | `CANCEL_NOT_ALLOWED`、`JOB_STATE_CONFLICT` | 状态幂等；已取消返回当前状态，不要求 key | V1 只允许 PENDING/RETRY_WAIT；首次变化审计原因 |

人工补打 `mode`：

- `ORIGINAL_SNAPSHOT`：从 sourceJobNo 复制不可变 receiptSnapshot，推荐默认；必须提供 sourceJobNo，并校验目标纸宽/renderProfile 兼容。
- `CURRENT_ORDER`：以 source Job 证明这是补打，但重新读取当前订单并生成新快照；UI 必须明确标注内容可能变化。

两种补打模式都必须校验 `sourceJob.orderId == path orderId`，并验证 source Job、Order、目标 Printer 同属认证 merchant；不能跨订单复制 receiptSnapshot。

人工补打不受首次自动打印 dedupeKey 阻止。每次人工操作生成新任务；只有同一次 HTTP 重试由 `Idempotency-Key` 合并。

订单首次人工打印走 `/prints` 且 source=`MANUAL_PRINT`；补打必须有 sourceJobNo，走 `/reprints` 且 source=`MANUAL_REPRINT`，UI 必须显示“补打”。两者都创建新 Job，不能把人工重试混入 source。

示例：

```json
{
  "printerIds": ["201"],
  "reason": "顾客要求补打一份",
  "mode": "ORIGINAL_SNAPSHOT",
  "sourceJobNo": "01JEXAMPLE0000000000000000"
}
```

## 3. MerchantTerminal 管理与认证

### 3.1 商家管理接口

| 方法与路径 | 调用方/权限 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|---|
| `GET /merchant/terminals` | OWNER/MANAGER | status/cursor | Terminal 摘要与 lastSeen | `PRINT_FEATURE_DISABLED` | GET | merchantId；不返回 tokenHash |
| `POST /merchant/terminals/enrollment-codes` | OWNER/MANAGER | `{terminalName,expiresInSeconds}` | 一次性 code + expiresAt | `ENROLLMENT_RATE_LIMITED` | 必须 key；同 key 由短 TTL 加密 escrow 重放原 code | code 明文不进日志；codeHash 用于验证，escrow 在消费/过期后销毁 |
| `POST /merchant/terminals/:id/revoke` | OWNER/MANAGER | `{reason,expectedTokenVersion}` | Terminal(REVOKED, tokenVersion+1) | `TERMINAL_NOT_FOUND`、`TOKEN_VERSION_CONFLICT` | 状态幂等；已撤销返回当前状态，不要求 key | merchantId；首次撤销终止后续领取并审计 |
| `POST /merchant/terminals/:id/rotate` | OWNER/MANAGER | `{reason}` | 新一次性 `purpose=ROTATE` 码，不返回现有 secret | `TERMINAL_NOT_FOUND`、`TERMINAL_REVOKED` | 必须 key | merchantId；生成码时旧 secret 仍有效，设备成功消费后才原子 tokenVersion+1 |

### 3.2 终端注册和 Token

| 方法与路径 | 调用方/权限 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|---|
| `POST /terminal/enroll` | 未认证设备 + 一次性 ENROLL/ROTATE code | code、enrollmentRequestId、`terminalSecret`（设备在 Keystore 生成）、deviceIdentifierHash、app/build、capabilities | terminalId、tokenVersion、merchant 摘要；不返回 secret | `ENROLLMENT_CODE_INVALID/EXPIRED/USED`、`DEVICE_ALREADY_BOUND` | IdempotencyRecord + code 原子消费 | merchantId/terminalId/name/purpose 来自 code；保存 secret hash；ROTATE 保留 terminalId并原子替换 tokenHash/tokenVersion；不记录 secret |
| `POST /terminal/auth/token` | terminalId + terminalSecret | `{terminalId,secret,deviceIdentifierHash}` | 短期 Terminal JWT + expiresIn | `TERMINAL_CREDENTIAL_INVALID`、`TERMINAL_REVOKED`、`DEVICE_MISMATCH` | 同请求可重复换 Token | 校验 tokenHash、tokenVersion、status 和设备 hash；记录认证事件 |

建议 Terminal JWT 有效期 15–60 分钟；每次关键请求仍检查终端 ACTIVE/tokenVersion，避免只依赖长期 JWT。

EnrollmentCode 保存 codeHash、受控 terminalName、purpose、expiresAt、usedAt 和尝试次数；仅为了同一 Idempotency-Key 的创建响应重放，短时保存信封加密 code escrow，并在消费/过期后销毁。Android 先在 Keystore 生成 terminalSecret，所以 enroll/rotate 提交后即使响应丢失也不会丢失新凭据；服务器永远只长期保存 tokenHash。ROTATE 时设备把新 secret 写入 Keystore 的 pending 槽，继续保留旧 secret；收到成功响应或用新 secret 成功换取 Terminal JWT 后才晋升并删除旧值。超时先尝试新凭据，失败再回退旧凭据并用同一 enrollmentRequestId 重试，避免服务端事务失败与客户端覆盖旧 secret 造成自锁。消费接口按 IP/code/terminal 限流，错误不得区分“终端不存在”和“secret 错误”，secret 只经 TLS 传输。deviceIdentifierHash 是风险信号和绑定提示，不是不可伪造的设备证明。

## 4. Android 本地连接器接口

所有接口仅接受 Terminal JWT；不能接受 MerchantStaff JWT，也不允许请求体传 merchantId。

### 4.1 心跳、配置和打印机状态

| 方法与路径 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|
| `POST /terminal/heartbeat` | heartbeatSeq、app/build、network、capabilities、activeJobNos、printer summaries | serverTime、nextHeartbeatSeconds、configVersion | `TERMINAL_REVOKED`、`APP_VERSION_UNSUPPORTED` | Terminal 保存最大 heartbeatSeq；旧/重复序号不重复写诊断 | terminalId/merchantId 来自 JWT；撤销直接 401/403，不同时返回 revoked flag；不保存敏感网络原文 |
| `GET /terminal/config` | `If-None-Match: configVersion` | 绑定 Printer 非敏感 config、render policy、poll policy；或 304 空 body | `TERMINAL_NOT_ACTIVE` | GET | configVersion 为 Terminal policy + 绑定 Printer configVersion 的稳定 hash/ETag；304 是统一包装的显式例外，无响应 body；无云 credential |
| `PUT /terminal/printers/:id/status` | statusReportId、connectionState、checkedAt、latencyMs、capabilities、errorCode | 更新后的状态摘要 | `PRINTER_NOT_BOUND`、`STALE_STATUS_REPORT` | statusReportId 用短 TTL IdempotencyRecord 去重 | 校验 Printer.terminalId；记录诊断，不把一次失败当永久禁用 |

`heartbeatSeq` 的最大已接受值保存在 MerchantTerminal；`statusReportId` 用短 TTL IdempotencyRecord 或等价诊断事件唯一键去重。Terminal configVersion 是策略与绑定 Printer configVersion 的稳定聚合 hash，而不是客户端自增值。

### 4.2 领取和执行

| 方法与路径 | 请求 | 响应 | 主要错误 | 幂等 | 隔离与审计 |
|---|---|---|---|---|---|
| `POST /terminal/print-jobs/claim` | `{claimRequestId,waitSeconds,maxJobs}` | `{jobs[],serverTime,nextPollAfterMs}`；每个 Job 带 leaseVersion/expiresAt | `TERMINAL_NOT_ACTIVE`、`CAPABILITY_MISMATCH` | 先返回当前终端已有活动租约；claimRequestId 用短 TTL IdempotencyRecord；V1 maxJobs=1 | 单一 claim loop；原子递增 claimCount；只领取匹配任务；每终端最多一个活动 Job；连续领取未 start 超时达到阈值则 FAILED/告警 |
| `GET /terminal/print-jobs/active` | 无 | 当前终端的 CLAIMED/PRINTING Job、Attempt 和允许动作 | `TERMINAL_NOT_ACTIVE` | GET | 重启/响应丢失时对账，不领取新任务 |
| `POST /terminal/print-jobs/reconcile` | `{localExecutions:[{jobNo,attemptId?,leaseVersion,outcome,contentHash}]}` | 每项服务器状态和 `REPORT_RESULT/RECORDED_LATE_EVIDENCE/DISCARD_LOCAL/WAIT_OPERATOR`，必要时含短期 recoveryNonce | `RECONCILE_PAYLOAD_INVALID` | 同摘要可重复 | 限制条数和长度；不能借此重开/重打 Job |
| `POST /terminal/print-jobs/:jobNo/start` | `{leaseVersion,adapter,adapterVersion,contentHash,printerConfigVersion,renderProfile,rendererVersion?,fontAssetVersion?}` | `{attemptId,attemptNo,leaseExpiresAt}` | `LEASE_CONFLICT`、`CONTENT_HASH_MISMATCH`、`JOB_STATE_CONFLICT`、`CONFIG_VERSION_CONFLICT` | 同 leaseVersion 重复返回同 Attempt | 任何设备连接前调用；原子 CLAIMED→PRINTING、创建 Attempt并递增计数；配置版本冲突时先刷新，不开始设备 I/O |
| `POST /terminal/print-jobs/:jobNo/lease` | `{leaseVersion,extendSeconds}` | 新 leaseExpiresAt | `LEASE_CONFLICT`、`LEASE_EXPIRED`、`JOB_TERMINAL_MISMATCH` | 重复请求不缩短租约 | 仅当前 owner，限制最大延长时间；记录异常续租 |
| `POST /terminal/print-jobs/:jobNo/succeed` | `{leaseVersion,attemptId,recoveryNonce?,deviceFinishedAt?,bytesWritten,contentHash,printerResponse?}` | Job(SUCCEEDED) | `LEASE_CONFLICT`、`ATTEMPT_MISMATCH`、`CONTENT_HASH_MISMATCH` | 对同 attempt 重复回报幂等；已成功仍返回成功 | 服务器时间为审计权威；nonce 仅用于无后继 Attempt 的短 grace 恢复；普通网页不能调用 |
| `POST /terminal/print-jobs/:jobNo/fail` | `{leaseVersion,attemptId,recoveryNonce?,deviceFinishedAt?,errorCode,errorMessage,bytesWritten,outcome}` | FAILED/RETRY_WAIT 和 nextAvailableAt | `LEASE_CONFLICT`、`ATTEMPT_MISMATCH`、`INVALID_ERROR_CODE` | 同 attempt 重复回报幂等 | API 根据错误、阶段、bytes/outcome 决定；终端不能任意指定最终状态 |

领取响应示例沿用后续 LAN channel 说明通用租约结构；USB 正式字段待实机验证后冻结，当前 smoke 不领取该响应：

```json
{
  "jobs": [
    {
      "jobNo": "01JEXAMPLE0000000000000000",
      "printerId": "201",
      "channelType": "LOCAL_LAN_ESCPOS",
      "status": "CLAIMED",
      "leaseVersion": 3,
      "leaseExpiresAt": "2026-07-14T00:01:00.000Z",
      "contentHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "printerConfigVersion": 4,
      "renderProfile": "ESCPOS_RASTER_V1",
      "receiptSnapshot": {
        "schemaVersion": 1,
        "receiptType": "ORDER_RECEIPT",
        "paperWidth": "WIDTH_80",
        "language": "zh",
        "blocks": []
      }
    }
  ],
  "serverTime": "2026-07-14T00:00:00.000Z",
  "nextPollAfterMs": 0
}
```

`succeed` 表示连接器确认其执行步骤完成，不是软件对纸张的绝对证明。若写入后进程崩溃、结果不明，必须用 Attempt `outcome=OUTCOME_UNKNOWN` 报告或等待对账；服务端把 Job 置为 `FAILED + PRINT_OUTCOME_UNKNOWN + retryBlocked=true`，不得伪报成功或盲目重打。

终端输入全部视为不可信：`deviceFinishedAt/checkedAt` 只作设备时间，服务器另存接收时间；errorMessage、printerResponse、networkInfo 有固定长度/字节上限、控制字符清洗和 PII/secret 脱敏。若回报稍晚于 lease expiry，但 owner、leaseVersion、attempt 仍匹配，Job 尚无后继 Attempt，可在短 grace window 接受终态；一旦产生后继 Attempt，旧回报只记冲突审计，不覆盖当前状态。`PRINTING` 任务本身不得被重新领取。

reconcile 动作矩阵：

- Job 仍为 PRINTING 且 lease 有效：`REPORT_RESULT`，使用原 leaseVersion 正常回报。
- lease 刚过期、Job 尚未推进、无后继 Attempt：可返回短期单次 `recoveryNonce + REPORT_RESULT`；nonce 绑定 jobNo/attemptId/terminalId/outcome。
- Job 已是 `FAILED/PRINT_OUTCOME_UNKNOWN`：reconcile 只把本地结果作为 `RECORDED_LATE_EVIDENCE` 写入 Attempt/审计，不自动改回 SUCCEEDED，返回 `WAIT_OPERATOR`。
- 已有后继 Attempt、其他 owner 或 hash 不匹配：`DISCARD_LOCAL` 或 `WAIT_OPERATOR`，旧证据不能覆盖当前状态。

## 5. 平台后台诊断接口

沿用当前 `/platform/...` controller 风格：`apps/api/src/modules/platform/platform-orders.controller.ts:7`。阶段 C 的最小只读诊断：

| 方法与路径 | 调用方/权限 | 请求 | 响应 | 隔离与审计 |
|---|---|---|---|---|
| `GET /platform/printing/jobs` | PlatformAdmin + printing diagnostics 权限 | merchantId/status/errorCode/dateFrom/dateTo/cursor/limit | 跨商家 Job 脱敏摘要 | 必须记录筛选条件与管理员；默认不返回 receipt PII |
| `GET /platform/printing/jobs/:jobNo/attempts` | PlatformAdmin + printing diagnostics 权限 | cursor/limit | Attempt、adapter、requestId、截断诊断 | credential/token 永不返回；查看敏感详情需更高权限和二次审计 |
| `GET /platform/printing/terminals` | PlatformAdmin + printing diagnostics 权限 | merchantId/status/lastSeenBefore/cursor | Terminal/Printer 健康摘要 | 设备标识脱敏；不返回 tokenHash、内网 endpoint 或完整 networkInfo |

平台接口只诊断，不得代替商家创建补打、伪造成功或读取云 credential。平台权限若尚无可复用细粒度机制，阶段 C 先限于既有最高平台角色并记录审计，不能仅靠前端隐藏。

## 6. 云打印适配器

云 adapter 不通过普通商家公开 API 读取 credential。建议：

1. NestJS 内部 `PrintDispatcherService` 或同仓库独立 worker 使用数据库 repository 原子领取 cloud channel Job。
2. `PrinterCredentialService` 在服务端按权限解密，并只把 credential 传给具体 adapter 的内存调用。
3. adapter 创建 PrintAttempt，保存厂商 jobId、脱敏响应、adapterVersion。
4. 若厂商支持 idempotency key，使用 PrintJob.jobNo；若支持状态查询，在超时后先查询再决定重试。
5. 对外 Job/Attempt DTO 永不含 encryptedValue、明文 credential 或完整厂商请求。

云通道在阶段 I 才实现。阶段 C 可定义接口和枚举，但不得注册“假成功”的 adapter。

## 7. 测试打印决策

**建议正式产品中的测试打印也必须创建 PrintJob。**

原因：

- 只有这样才能验证配置→任务→领取→渲染→连接→回报整条链路。
- 测试也需要失败日志、权限、终端离线等待和审计。
- 独立即时接口会再次形成第二事实源和绕过租约的执行路径。

允许另设不出纸的本地连接诊断，例如 USB open/claim 或后续 LAN connect；它只能生成 `PrinterConnectionDiagnostic` 或状态上报，不能发送 ESC/POS，也不能标记 PrintJob 成功。

阶段 D 为确认未知 USB 硬件能力而提供的前台合成 smoke 是受控例外：内容不来自订单，不连接生产 API，不创建或领取 PrintJob，且只允许用户手动单次发送。该例外在门店验证后不得直接演变为正式订单打印旁路。

## 8. 人工补打与人工重试的区别

| 操作 | 适用情况 | Job 行为 | 幂等 |
|---|---|---|---|
| 人工补打 | 已成功、结果不确定或顾客额外要一份 | 必须创建新 Job，标 `MANUAL_REPRINT` | 新用户动作新 key；同 HTTP 重试同 Job |
| 人工重试 | 明确未出纸且原 Job 失败、错误可重试 | retry 请求只把原 Job 审计式转入 RETRY_WAIT；下一次领取后的 start 才创建新 Attempt | 同 key 幂等；受 maxAttempts 控制 |

人工补打必须记录操作者和原因，UI 显示“补打”标识，不受首次自动任务 dedupeKey 阻止。

## 9. 分页、DTO 与输入边界

### 9.1 分页

打印日志为持续增长数据，建议有意采用稳定 cursor，而不是把当前不统一的列表分页直接照搬：

- 排序固定为 `(createdAt DESC,id DESC)`；cursor 是包含这两个值的 opaque、签名/编码字符串。
- `limit` 默认 20，最大 100；响应为 `{items,nextCursor,hasMore}`。
- 时间统一 ISO 8601 UTC，query 使用 `dateFrom/dateTo`；BigInt ID 在 JSON 中均为十进制字符串。

### 9.2 主要 DTO 约束

| DTO | 必填字段 | 关键约束 |
|---|---|---|
| `PrinterCreateInput` | name、channelType、usageType、paperWidth、enabled、connectionConfig | name 1..80；LOCAL LAN 必须 terminalId；literal IPv4/端口/超时/profile allowlist；未知字段拒绝 |
| `RuleCreateInput` | name、orderType、triggerEvent、receiptType、printerId、templateVersionId、copies、enabled | copies 建议 1..5；priority 0..1000；只能引用同 merchant/系统模板的 PUBLISHED version |
| `ManualPrintInput` | printerIds | printerIds 去重后 1..5；reason 可选且最长255；事务全成全败 |
| `ReprintInput` | printerIds、reason、mode、sourceJobNo | printerIds 去重后 1..5；reason 1..255；源 Job 必须同订单/商家；事务全成全败 |
| `HeartbeatInput` | heartbeatSeq、appVersion、buildRevision | 数组/summary 有上限；服务端不信设备时间/能力声明 |
| `ClaimInput` | claimRequestId、waitSeconds、maxJobs | UUID/ULID；wait 0..25；V1 maxJobs 必须为 1；同终端不能并发 claim |
| `AttemptResultInput` | leaseVersion、attemptId、contentHash、bytesWritten/outcome | error/response 有长度与字节上限；outcome 受控枚举；server time 权威 |

连接配置、ReceiptDocument 和 Template definition 使用按 schemaVersion 的 discriminated DTO/validator，不能仅用 `Json` 后直接透传。所有图片资产必须是内嵌受限内容或受控不可变 asset ID，拒绝任意远程 URL。

### 9.3 IdempotencyRecord 语义

- 作用域至少包含 endpoint purpose、认证 merchantId 与 actor/terminalId；key 长度建议 16..128，TTL 24 小时（注册码/claim 可使用更短专用 TTL）。
- 原子插入 `PROCESSING`；相同 key+不同 requestHash 返回 409；处理中返回 409/425 和 Retry-After；完成后重放相同 HTTP status 与 resourceRef。
- 批量补打在同一 DB 事务中去重 printerIds、展开每 printer/copy 一个 Job 并保存 requestGroup；不得部分创建后返回成功。
- `claimRequestId` 丢失响应时，服务端首先返回当前终端已有未过期活动租约，因此不会领取第二个 Job。

## 10. 建议错误码与 HTTP 映射

| HTTP | 范围 | 错误码示例 |
|---:|---|---|
| 400 | DTO/内容 | `INVALID_CHANNEL_CONFIG`、`INVALID_RECEIPT_DOCUMENT`、`CONTENT_HASH_MISMATCH`、`UNSUPPORTED_PAPER_WIDTH` |
| 401 | 认证 | `AUTH_REQUIRED`、`TERMINAL_AUTH_REQUIRED`、`TERMINAL_CREDENTIAL_INVALID` |
| 403 | 权限/撤销 | `TERMINAL_REVOKED`、`MERCHANT_SCOPE_MISMATCH`、`PRINT_FEATURE_DISABLED` |
| 404 | 资源 | `PRINT_JOB_NOT_FOUND`、`PRINTER_NOT_FOUND`、`TEMPLATE_VERSION_NOT_FOUND` |
| 409 | 状态/幂等 | `JOB_STATE_CONFLICT`、`LEASE_CONFLICT`、`CONFIG_VERSION_CONFLICT`、`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY` |
| 422 | 业务不允许 | `TEMPLATE_VERSION_NOT_PUBLISHED`、`RETRY_NOT_ALLOWED`、`CANCEL_NOT_ALLOWED`、`OUTCOME_UNKNOWN_REQUIRES_REPRINT` |
| 425 | 幂等处理中 | `IDEMPOTENCY_REQUEST_IN_PROGRESS` |
| 426 | 客户端版本 | `APP_VERSION_UNSUPPORTED` |
| 429 | 限流 | `ENROLLMENT_RATE_LIMITED`、`CLOUD_VENDOR_RATE_LIMITED` |
| 503 | 服务暂时不可用 | `CHANNEL_NOT_READY`、`CLOUD_VENDOR_UNAVAILABLE` |

`TERMINAL_NOT_ACTIVE`/`TERMINAL_REVOKED` 用 403；`LEASE_EXPIRED`、`STALE_STATUS_REPORT`、`ENROLLMENT_CODE_USED` 用 409；`ENROLLMENT_CODE_EXPIRED` 用 410。执行错误使用单一 registry：`NETWORK_TIMEOUT`、`CONNECTION_REFUSED`、`NO_ROUTE_TO_HOST`、`SOCKET_CLOSED_BEFORE_WRITE`、`SOCKET_CLOSED_AFTER_WRITE`、`PRINTER_OFFLINE`、`PAPER_OUT_CONFIRMED`、`COVER_OPEN_CONFIRMED`、`CLOUD_VENDOR_TIMEOUT`、`CLOUD_VENDOR_RATE_LIMITED`、`CLOUD_VENDOR_UNAVAILABLE`、`LEASE_EXPIRED_BEFORE_START`、`EXECUTOR_UNSTABLE`、`PRINT_OUTCOME_UNKNOWN`、`INVALID_CHANNEL_CONFIG`、`INVALID_RECEIPT_DOCUMENT`、`CONTENT_HASH_MISMATCH`、`CAPABILITY_MISMATCH`、`UNSUPPORTED_PAPER_WIDTH`、`TERMINAL_REVOKED`、`PRINTER_NOT_BOUND`、`MERCHANT_SCOPE_MISMATCH`。adapter 内部异常必须映射到此 registry 后才能通过 fail API 上报。

内部异常仍映射到现有统一错误包装并携 requestId。新增实现应抛出带 `{code,message}` 的 Nest HttpException（例如 ConflictException），否则当前 filter 会退化为 `HTTP_xxx`：`apps/api/src/common/filters/all-exceptions.filter.ts:21-28,53-70`。错误 message 可本地化，code 必须稳定供 Web/Android 处理。

## 11. 自动触发的事务边界

- 阶段 C 只实现和测试 Job 创建、幂等与事务原语，不接生产订单事件。
- 阶段 G 接入自动打印时，订单业务提交不能等待 TCP、云厂商或 Android；外部 I/O 永远在事务后由 executor 完成。
- Job 必须与可靠 trigger/outbox 在业务事务内持久化。模板/规则生成异常不能回滚顾客订单；应持久化可诊断的 trigger failure/FAILED Job，或让 outbox 在修复后重放，不能静默丢弃。
- 重放使用不可变 triggerEventKey 和事件发生时冻结的规则选择，不用当前新规则重新计算旧事件。

## 12. 兼容与下线

- 当前 `POST /merchant/orders/:id/print` 同步打印接口应标记 deprecated；过渡期旧路径仅创建 source=`MANUAL_PRINT` 的新 Job，绝不能继续服务器 Socket。新 UI 的首次人工打印使用 `/prints`，明确补打才使用 `/reprints`。
- 当前 `GET/POST/PATCH/DELETE /merchant/printers` 可保留路径，但 DTO/响应升级到 canonical Printer；物理 DELETE 改为 disable。
- 当前 PrintLog 通过订单嵌入返回；新 UI 改查 PrintJob/Attempt。兼容投影可标 `legacy=true`。
- 切换必须由单一 feature flag 控制，旧即时自动打印与新 PrintJob 触发不能同时启用。
