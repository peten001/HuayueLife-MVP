# Web 收银台生产部署准备

## 当前结论

独立 Web 收银台源码和生产构建流程可用，但截至本次审计，候选地址
`https://cashier.huayueyouxuan.com/` 没有可验证的 DNS 解析和 HTTPS 站点，仓库内也没有真实服务器目录、Nginx 站点或发布身份。因此本文件是可执行的上线清单，不代表已部署。

在 DNS、TLS、目标服务器和回滚目录全部确认前，不得把 Android 正式包描述为已能加载线上收银台。

## 构建输入

Vite 变量会写入公开浏览器资源，只允许公开地址，禁止写入密码、Token、Cookie 或 API Key：

```bash
VITE_API_BASE_URL='https://api.huayueyouxuan.com/api/v1' \
VITE_CASHIER_USE_FIXTURES='false' \
VITE_MERCHANT_ADMIN_URL='https://admin.huayueyouxuan.com/' \
corepack pnpm --filter @huayue-life/merchant-cashier build
```

构建产物：`apps/merchant-cashier/dist/`。

发布前记录：

```bash
find apps/merchant-cashier/dist -type f -print0 | sort -z | xargs -0 shasum -a 256
```

## DNS 与 TLS Gate

- [ ] 用户确认正式 Origin 是否为 `cashier.huayueyouxuan.com`。
- [ ] A/AAAA/CNAME 指向目标站点。
- [ ] TLS 证书覆盖精确主机名且完整证书链有效。
- [ ] HTTP 永久跳转 HTTPS。
- [ ] 不允许使用无效证书或在 Android 中绕过 SSL。

## 静态站点要求

- Vue Router 未命中路径回退 `/index.html`。
- `index.html` 禁止长期缓存；带内容哈希的 JS/CSS 可使用长期 immutable 缓存。
- 禁止目录列表和任意文件上传。
- 健康检查必须直接检查公开 HTTPS 首页，而不是只检查本地文件。
- 发布使用版本目录加原子软链接切换，保留上一版本用于回滚。

可复用模板：[cashier.nginx.conf.example](deployment/cashier.nginx.conf.example)。模板中的占位符必须由运维确认，不能直接部署。

## CSP 与 CORS

建议 Web 收银台 CSP：

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`（当前 Vue 样式需要；后续可进一步收紧）
- `img-src 'self' data: blob: https://api.huayueyouxuan.com`
- `connect-src 'self' https://api.huayueyouxuan.com`
- `object-src 'none'`
- `base-uri 'self'`
- `frame-ancestors 'none'`
- `form-action 'self'`

API CORS 必须从反射任意 Origin 改为精确白名单，至少分别核对：

```text
https://admin.huayueyouxuan.com
https://cashier.huayueyouxuan.com   # 仅在该域名最终确认后
```

不允许 `*` 与 credentials 同时使用，不允许把任意请求 Origin 原样返回。

## 发布验证

1. 登录和登录保持。
2. 桌台、订单、TableSession 与三语言。
3. 接单、制作、完成、拒单、关桌（仅专用测试数据）。
4. `GET /merchant/printing/feature-state` 返回 200。
5. 打印开关默认关闭，网页不能把任务标记为成功。
6. 1280×800 横屏无横向溢出。
7. Android WebView 精确 Origin、API/媒体资源 Host 和 HTTPS 正常。

## Web 回滚

将站点原子切回上一版本目录并重新检查首页与登录。Web 回滚不得恢复旧服务器 TCP/LAN 直打，也不得改变数据库 migration 状态。
