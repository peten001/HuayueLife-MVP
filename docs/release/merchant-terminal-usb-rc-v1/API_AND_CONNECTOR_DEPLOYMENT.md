# API 与 Connector RC 部署准备

## 当前状态

代码和本地构建可以交付，但生产部署目前为 **BLOCKED**：仓库没有经确认的目标服务器、API 工作目录、进程名称、Secret 注入方式或原子回滚命令；生产数据库备份 Gate 也尚未通过。因此本文件是部署输入清单，不代表已经部署。

## 必需的生产配置

以下变量必须由生产 Secret/配置系统注入。示例值不能直接用于生产：

```text
NODE_ENV=production
CORS_ALLOWED_ORIGINS=https://admin.huayueyouxuan.com,https://cashier.huayueyouxuan.com
TERMINAL_AUTH_PEPPER=<至少 32 随机字节>
TERMINAL_TOKEN_TTL_DAYS=365
TERMINAL_JOB_POLL_SECONDS=5
TERMINAL_HEARTBEAT_SECONDS=20

LEGACY_PRINTING_ENABLED=false
PRINTING_TASK_CENTER_ENABLED=true
PRINTING_AUTO_CREATE_ENABLED=false
PRINTING_EXECUTION_ENABLED=false
```

`cashier.huayueyouxuan.com` 只有在 DNS、TLS 和公开 HTTPS 验证通过后才能加入 CORS 精确白名单。禁止通配 Origin、明文 HTTP、把 Pepper 写入仓库或在命令行开启 shell trace。

本机已在 macOS 登录钥匙串生成一份 RC Pepper 候选，仅用于后续受控部署：

```bash
security find-generic-password \
  -s 'com.yunqiao.life.api.terminal-auth-pepper' \
  -a 'printing-rc1' -w
```

命令会在终端显示 Secret；只能由获授权人员直接写入生产 Secret 管理系统，不得复制到文档、聊天、`.env`、CI 日志或截图。正式部署前还需确认该 Secret 的备份、轮换和访问控制。Pepper 丢失或被替换会使现有终端 Token 失效。

## 安全启动顺序

1. 完成 [PRODUCTION_MIGRATION_RUNBOOK.md](PRODUCTION_MIGRATION_RUNBOOK.md) 的备份与恢复演练。
2. 部署 API 构建，但保持执行和自动创建为 `false`，旧直打为 `false`。
3. 验证 API health、商家登录、订单、桌台和 TableSession。
4. 未认证访问商家打印接口必须返回 401/403，而不是 404。
5. 验证任意非白名单浏览器 Origin 被 CORS 拒绝；Android 原生请求不携带 Origin 时可访问。
6. 验证打印中心默认状态：商家总开关关闭、Printer disabled、Rule disabled/autoPrint false、Terminal unpaired。
7. 到店前不得创建真实任务、绑定真实终端或开启自动打印。

## Connector 接口边界

- `POST /api/v1/terminal/pair`：只接受一次性 pairingId + 8 位码；5–10 分钟过期、最多 5 次错误尝试。
- 其余 `/api/v1/terminal/**`：使用 `Authorization: Terminal <opaque-token>`，不复用商家 JWT。
- Token 服务端只保存 HMAC Hash，Android 使用 Keystore 加密保存。
- DISABLED 终端仅可 heartbeat/config，以便远程恢复；不能领取、开始、回报或修改打印机状态。
- REVOKED、过期、轮换后的旧 Token 立即失效。
- Claim 使用数据库租约；成功/失败回报带 Attempt、leaseVersion、内容 Hash 和写入字节数。
- 部分写入或无法判断出纸时必须进入 `PRINT_OUTCOME_UNKNOWN`，禁止自动重试。
- 终端上报的 USB `CONNECTED` 仅表示目标设备可见、权限存在且已保存配置可匹配；不表示有纸、未开盖、硬件健康或已经真实出纸。管理后台不得把它显示为“打印机正常”。

## 自动打印可靠性

订单状态事务内写入 `print_trigger_outbox`；PrintJob 创建失败或 API 在事务提交后退出时，Connector claim 会进行幂等补偿。数据库 outbox 和 PrintJob 是事实来源，Android/网页信号不能替代它们。

关闭自动打印会阻止新自动事件和自动任务领取，但不会删除历史 PrintJob/outbox。重新开启前必须在打印中心检查并取消不应继续执行的积压任务。

## 部署后验证

- 全局四个打印 Flag 与预期一致，且旧路径保持关闭。
- `GET /merchant/printing/feature-state` 返回真实 Flag 与商家开关。
- 跨商家 Printer、Terminal、Job 查询/写入被拒绝。
- 终端停用可恢复；撤销后旧 Token 永久失效。
- 执行关闭时 claim 被拒绝且不产生 Attempt。
- API 日志不含绑定码、Terminal Token、Cookie、客户电话或地址。

生产目标信息未明确前，不执行上传、进程重启、migration 或部署。
