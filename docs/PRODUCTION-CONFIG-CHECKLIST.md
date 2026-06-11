# 生产环境配置检查清单

## 1. API 运行环境

- [ ] 从 `apps/api/.env.production.example` 创建生产环境配置。
- [ ] `NODE_ENV` 严格设置为 `production`。
- [ ] `PORT` 与反向代理 upstream 端口一致。
- [ ] 生产 `.env` 未加入 Git，文件权限仅允许部署账号读取。
- [ ] 进程管理器启动目录和 API 读取 `.env` 的目录一致。
- [ ] 服务器时区设置为 `Asia/Ho_Chi_Minh`。

## 2. MySQL

- [ ] `DATABASE_URL` 指向 MySQL 8 生产实例。
- [ ] 使用独立应用账号，不使用 `root`。
- [ ] 数据库密码中的特殊字符已进行 URL 编码。
- [ ] 数据库账号只拥有目标数据库所需权限。
- [ ] MySQL 不对公网开放。
- [ ] 数据库字符集为 `utf8mb4`。
- [ ] 已执行 `prisma migrate deploy`。
- [ ] 迁移前已完成备份。
- [ ] 已在非生产数据库验证恢复流程。

## 3. JWT

- [ ] `JWT_SECRET` 使用密码学安全随机值，至少 32 字节。
- [ ] 未使用示例值、开发值或测试值。
- [ ] `JWT_SECRET` 未出现在日志、前端构建产物和 Git 历史新增内容中。
- [ ] `JWT_EXPIRES_IN` 已确认，V1 建议为 `7d`。
- [ ] 已记录密钥轮换和强制用户重新登录方案。

生成示例：

```bash
openssl rand -base64 48
```

## 4. 微信登录

- [ ] `WECHAT_APP_ID` 与微信公众平台和小程序 `manifest.json` 一致。
- [ ] `WECHAT_APP_SECRET` 来自对应 AppID。
- [ ] AppSecret 只配置在 API 服务端。
- [ ] AppSecret 未写入 `VITE_` 变量、前端源码或 CI 构建日志。
- [ ] 生产环境使用真实 `code2Session`，mock code 会被拒绝。
- [ ] 使用体验版真机完成首次登录和重复登录测试。
- [ ] 已验证无效或过期 code 返回明确错误。
- [ ] API 日志不包含 code、AppSecret 或 `session_key`。

## 5. 二维码入口

- [ ] `MINIAPP_QR_ENTRY_URL` 使用正式 HTTPS 地址。
- [ ] 域名和路径能够进入小程序扫码解析流程。
- [ ] 每张桌码包含随机 `qr_token`，不暴露数据库 ID。
- [ ] Seed 示例桌码已在后台逐桌换码。
- [ ] 换码后旧二维码已验证失效。

## 6. 小程序构建变量

构建前设置：

```bash
VITE_API_BASE_URL="https://api.example.com/api/v1" \
  corepack pnpm --filter @huayue-life/miniapp build
```

- [ ] API 地址使用 HTTPS。
- [ ] 地址包含 `/api/v1`。
- [ ] 地址不是 localhost、IP 地址或测试域名。
- [ ] 构建产物中包含正确 API 地址。
- [ ] 微信公众平台 request 合法域名配置为 `https://api.example.com`，不包含路径。
- [ ] 微信开发者工具未依赖“关闭合法域名校验”运行。

验证示例：

```bash
rg "https://api.example.com/api/v1" \
  apps/miniapp/dist/build/mp-weixin/api/http.js
```

## 7. 商家后台构建变量

构建前设置：

```bash
VITE_API_BASE_URL="https://api.example.com/api/v1" \
  corepack pnpm --filter @huayue-life/merchant-admin build
```

- [ ] 商家后台和小程序连接同一生产 API。
- [ ] 构建产物中不存在 AppSecret、数据库密码或 JWT 密钥。
- [ ] 商家后台域名已配置 HTTPS。
- [ ] Nginx 已配置 Vue Router 路由回退到 `index.html`。

## 8. HTTPS 和反向代理

- [ ] API 域名 DNS 已指向生产入口。
- [ ] TLS 证书有效且证书链完整。
- [ ] HTTP 自动跳转 HTTPS。
- [ ] Nginx 仅将 `/api/v1` 转发到 API 内部端口。
- [ ] 上传大小、连接超时和代理超时已设置合理值。
- [ ] 公网无法直接访问 NestJS、MySQL 和 Redis 内部端口。
- [ ] `GET https://api.example.com/api/v1/health` 返回成功。

## 9. Seed 和试点账号

- [ ] 仅在全新试点环境执行 seed。
- [ ] 执行 seed 前设置一次性强密码：

```bash
DATABASE_URL="生产数据库连接串" \
SEED_MERCHANT_PASSWORD="一次性强密码" \
  corepack pnpm db:seed
```

- [ ] Seed 执行完成后从运行环境删除 `SEED_MERCHANT_PASSWORD`。
- [ ] 未对已有真实业务数据的生产库重复执行 seed。
- [ ] 默认账号密码已通过安全渠道交付试点商家。
- [ ] 所有示例商家资料、菜单、价格和桌号已替换或确认。

## 10. 启动前最终检查

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm build
DATABASE_URL="生产数据库连接串" \
  corepack pnpm --filter @huayue-life/api prisma:deploy
corepack pnpm --filter @huayue-life/api start:prod
```

- [ ] 全仓类型检查通过。
- [ ] API、商家后台和小程序生产构建通过。
- [ ] 数据库迁移成功且无待处理迁移。
- [ ] API 健康检查通过。
- [ ] 真实微信登录通过。
- [ ] 真机扫码堂食、自取和商家配送流程通过。
- [ ] 数据库备份、日志和故障联系人已准备。

