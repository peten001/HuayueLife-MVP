# Yunqiao｜独立 Web 收银台

`@huayue-life/merchant-cashier` 是面向餐厅前台和 Android 商家终端的独立 Web 收银台。它与现有 `merchant-admin` 分开维护：收银台聚焦订单、桌台和现场操作，完整商家配置仍从商家后台进入。

当前项目属于统一打印架构计划的阶段 B。它不会直接连接打印机，也不会把完整订单业务重新实现到 Android 原生层。

## 技术栈

- Vue 3、TypeScript、Vite 6
- Pinia、Vue Router、浏览器 Fetch API
- Lucide Vue 图标
- ESLint（Vue + TypeScript）
- Vitest、jsdom、Vue Test Utils

仓库使用 pnpm workspace。推荐 Node.js 20 LTS 或更高版本，并使用根 `package.json` 固定的 pnpm 9.15.0。

## 安装

在仓库根目录安装所有 workspace 依赖：

```bash
corepack enable
corepack pnpm install
```

不要在本目录单独生成另一份 lockfile。

## 环境变量

复制示例到本地覆盖文件：

```bash
cp apps/merchant-cashier/.env.example apps/merchant-cashier/.env.local
```

| 变量 | 默认/示例值 | 用途 |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.huayueyouxuan.com/api/v1` | 云桥 API 根地址，必须包含 `/api/v1` |
| `VITE_CASHIER_USE_FIXTURES` | `false` | `true` 时仅使用前端 fixture；修改后需重启 Vite |
| `VITE_MERCHANT_ADMIN_URL` | `https://admin.huayueyouxuan.com/` | 跳转到完整商家后台的公开地址 |

所有 `VITE_` 变量都会写入浏览器构建产物，只能保存公开配置。禁止写入商家账号、密码、Token、Cookie、API Key、数据库连接串或任何服务端密钥。

仓库尚未确认独立收银台的正式页面 Origin，因此本项目不猜测、不硬编码 cashier 生产域名。正式页面 URL 由后续 DNS、TLS 和静态站点部署决定。

## 启动

从仓库根目录启动，默认端口为 `5176`，端口占用时会直接失败而不会静默换端口：

```bash
corepack pnpm dev:merchant-cashier
```

也可以使用 workspace filter：

```bash
corepack pnpm --filter @huayue-life/merchant-cashier dev
```

打开 `http://localhost:5176/`。

## Fixture 模式

Fixture 模式用于无后端依赖的布局、交互和 1280×800 横屏验证：

```bash
VITE_CASHIER_USE_FIXTURES=true \
  corepack pnpm --filter @huayue-life/merchant-cashier dev
```

Fixture 数据不是生产事实，不会验证真实权限、并发订单、Token 过期或服务器状态迁移。验收真实业务前必须关闭 fixture 并重新启动开发服务器或重新构建。

## 连接真实 API

开发模式未传环境变量时默认连接 `http://localhost:3001/api/v1`；生产构建默认使用公开生产 API。连接真实环境前，确认当前操作不会影响真实订单；账号和密码只在登录页面手动输入，不得写入环境文件或测试代码。

```bash
VITE_CASHIER_USE_FIXTURES=false \
VITE_API_BASE_URL=https://api.huayueyouxuan.com/api/v1 \
  corepack pnpm --filter @huayue-life/merchant-cashier dev
```

本地 API 开发可显式覆盖：

```bash
VITE_CASHIER_USE_FIXTURES=false \
VITE_API_BASE_URL=http://localhost:3001/api/v1 \
  corepack pnpm --filter @huayue-life/merchant-cashier dev
```

真实模式复用现有商家员工登录和 Bearer Token 认证。收银台是独立页面 Origin，不应通过 URL、`postMessage` 或 Android Bridge 从 merchant-admin 搬运 Token；首次进入独立 Origin 时需要正常登录。

## 质量检查

```bash
corepack pnpm --filter @huayue-life/merchant-cashier typecheck
corepack pnpm --filter @huayue-life/merchant-cashier lint
corepack pnpm --filter @huayue-life/merchant-cashier test
corepack pnpm --filter @huayue-life/merchant-cashier build
```

启动 Fixture 开发服务器后，可以另开终端运行 Chrome 冒烟与响应式检查：

```bash
corepack pnpm --filter @huayue-life/merchant-cashier test:ui
```

生产构建输出到 `apps/merchant-cashier/dist/`。根目录的递归 `typecheck` 和 `build` 也会自动包含本应用。

## 部署边界

- 本阶段只创建和验证独立 SPA，不修改生产 Nginx、DNS、TLS、API 或数据库。
- 正式部署应使用独立、经确认的 HTTPS Origin，并为 Vue Router 配置回退到 `index.html`。
- JS、CSS、图标和提示音优先随收银台同源发布；API 和媒体资源使用 `api.huayueyouxuan.com`。
- 当前 Android 外壳仍加载 merchant-admin。只有独立收银台部署、HTTPS 和资源 Host 验证完成后，才能在后续阶段切换 Android WebView 的精确 Origin 白名单。
- 本项目不依赖 PWA 或 Service Worker。

## 当前能力边界

阶段 B 的目标范围是商家登录、新订单与未完成订单、订单详情和状态操作、桌台总览、整桌账单、横屏布局以及前台新订单声音提醒。实际可用能力以代码、自动测试和真机验收结果为准。

当前明确不包含：

- LAN、USB、蓝牙或云打印
- ESC/POS、TCP 9100 或厂商打印 SDK
- PrintJob、PrintAttempt、打印规则、模板和自动打印
- Android JavaScript 打印 Bridge、后台服务、开机启动或 WorkManager
- 完整现场点餐、会员、交班和复杂收银
- 生产部署、数据库 migration 或服务器配置修改

打印入口在任务中心和执行器可用前只能是禁用占位或只读状态，不得伪造“打印成功”。
