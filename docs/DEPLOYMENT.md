# V1.0 Alpha 生产部署准备

## 1. API 环境变量

以 `apps/api/.env.example` 为模板：

| 变量 | 必填 | 说明 |
|---|---|---|
| `NODE_ENV` | 是 | 生产环境设为 `production` |
| `PORT` | 是 | API 监听端口，默认 `3001` |
| `DATABASE_URL` | 是 | MySQL 8 连接串 |
| `JWT_SECRET` | 是 | 至少 32 字节的随机密钥 |
| `JWT_EXPIRES_IN` | 是 | JWT 有效期，例如 `7d` |
| `WECHAT_APP_ID` | 正式版是 | 微信小程序 AppID |
| `WECHAT_APP_SECRET` | 正式版是 | 微信小程序密钥，只保存在服务端 |
| `MINIAPP_QR_ENTRY_URL` | 是 | 桌台二维码入口 HTTPS 地址 |
| `SEED_MERCHANT_PASSWORD` | 仅 seed | 试点店主初始密码，执行 seed 前设置 |

前端构建变量：

```text
apps/miniapp/.env.example
apps/merchant-admin/.env.example
```

两端均使用：

```text
VITE_API_BASE_URL=https://api.example.com/api/v1
```

不要把数据库密码、JWT 密钥或微信密钥提交到 Git。

## 2. 推荐拓扑

```text
微信小程序 ─┐
            ├─ HTTPS / api.example.com ─ Nginx ─ NestJS API
商家后台 ───┘                                  │
                                               ├─ MySQL 8
                                               └─ Redis 7（V1 预留）
```

- API 和商家后台使用有效 HTTPS 证书。
- Nginx 将 `/api/v1` 反向代理到 `127.0.0.1:3001`。
- MySQL 不直接暴露公网，只允许 API 所在网络访问。
- Redis 当前不在核心请求链路中，可以部署但不能假设其承担订单可靠性。
- 服务器时区建议统一为 `Asia/Ho_Chi_Minh`，数据库时间存储保持一致。

## 3. 安装和构建

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm build
```

应用数据库迁移：

```bash
DATABASE_URL="mysql://USER:PASSWORD@MYSQL_HOST:3306/huayue_life_mvp" \
  corepack pnpm --filter @huayue-life/api prisma:deploy
```

试点环境可执行 seed；已有真实数据的生产库不要反复执行：

```bash
DATABASE_URL="mysql://USER:PASSWORD@MYSQL_HOST:3306/huayue_life_mvp" \
SEED_MERCHANT_PASSWORD="使用独立强密码" \
  corepack pnpm db:seed
```

## 4. 生产启动

在项目根目录准备 `apps/api/.env` 后执行：

```bash
corepack pnpm --filter @huayue-life/api start:prod
```

建议使用 systemd、Docker 或其他进程管理器，配置：

- 异常自动重启。
- 标准输出日志采集。
- 启动前执行 `prisma migrate deploy`。
- 健康检查 `GET /api/v1/health`。

商家后台构建产物位于：

```text
apps/merchant-admin/dist
```

使用 Nginx 静态托管，并将 Vue Router 未命中的路径回退到 `index.html`。

## 5. MySQL

- 使用 MySQL 8 和 `utf8mb4`。
- 为应用创建独立账号，仅授权目标数据库。
- 开启自动备份和二进制日志。
- 上线前执行一次迁移演练和恢复演练。
- 不允许直接修改生产表结构，统一使用 Prisma migration。

示例备份：

```bash
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  -h MYSQL_HOST -u BACKUP_USER -p \
  huayue_life_mvp > huayue_life_mvp_$(date +%F_%H%M).sql
```

示例恢复到新数据库：

```bash
mysql -h MYSQL_HOST -u RESTORE_USER -p huayue_life_mvp_restore \
  < huayue_life_mvp_YYYY-MM-DD_HHMM.sql
```

建议保留：

- 每日完整备份 7 份。
- 每周完整备份 4 份。
- 上线和执行迁移前的独立备份。

## 6. 上线阻断项

V1.0 alpha 可以用于本地和受控试点联调。正式微信审核及公网生产上线前，必须完成：

- 使用真实 AppID 在体验版验证服务端 `code2Session` 登录。
- 真实 AppID、合法域名和隐私保护指引。
- HTTPS 证书和公网健康检查。
- 生产密钥替换。
- 数据库备份恢复演练。
- 真实手机完成三种订单类型全流程。
