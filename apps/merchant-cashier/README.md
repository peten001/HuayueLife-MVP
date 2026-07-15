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
| `VITE_CASHIER_USE_FIXTURES` | `false` | `true` 时显示显式演示入口；只有进入演示会话后才读取 fixture，修改后需重启 Vite |
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

Fixture 开关即使显式开启，也不会截获正常账号登录；只有用户点击“进入演示”后，当前会话才切换到本地数据源。默认值、`.env.example` 和生产构建均不会开启该入口。

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

当前真实接口范围：

- `POST /merchant/auth/login`、`GET /merchant/me`、`GET /merchant/profile`
- `GET /merchant/tables`、`GET /merchant/table-sessions/open`
- `GET /merchant/table-sessions/:id`、`POST /merchant/table-sessions/:id/close`
- `GET /merchant/orders`、`GET /merchant/orders/:id`
- 现有订单 `accept`、`reject`、`start-preparing`、`ready`、`start-delivery`、`complete` 动作
- 打印任务中心状态、USB 打印机列表、订单/桌账人工 PrintJob 与带原因补打；网页只创建和查看任务，不能传 ESC/POS 字节或回报打印成功

真实桌台模型只有 `ACTIVE / DISABLED`，开放的 TableSession 统一显示为“用餐中”。“可关闭桌账”是 `unfinishedOrderCount === 0` 的操作条件，不是独立后端状态，因此收银台不提供虚构的“待结桌”筛选。

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

启动真实模式开发服务器后，可用完全脱敏的浏览器 API Mock 验证真实 Fetch、Bearer、响应 envelope 和 UI 状态；该命令不会使用真实账号或数据库：

```bash
corepack pnpm --filter @huayue-life/merchant-cashier test:ui:real-api
corepack pnpm --filter @huayue-life/merchant-cashier screenshots:real-api
```

生产构建输出到 `apps/merchant-cashier/dist/`。根目录的递归 `typecheck` 和 `build` 也会自动包含本应用。

## USB RC 打印安全 Gate

- 页面默认显示打印关闭；只有任务中心、全局执行、商家打印总开关和已启用 `LOCAL_USB_ESCPOS` Printer 同时满足时才开放按钮。
- 初次人工打印由 API 生成不可变 ReceiptSnapshot；网页不生成原始打印字节。
- 补打必须填写原因并生成新任务，不修改或重复执行原任务。
- 网络异常时打印写操作与订单写操作一样被禁用。
- 自动打印、任务领取和最终成功回报属于 API 与 Android Connector，不在浏览器中执行。
- Fixture 演示模式始终禁用真实打印 API。

## 部署边界

- 仓库提供 RC 部署准备和 Nginx 模板，但在 DNS、TLS、服务器目录和回滚路径确认前不修改生产站点。
- 正式部署应使用独立、经确认的 HTTPS Origin，并为 Vue Router 配置回退到 `index.html`。
- JS、CSS、图标和提示音优先随收银台同源发布；API 和媒体资源使用 `api.huayueyouxuan.com`。
- Android RC 通过集中 BuildConfig 加载同一 Web 收银台；正式包必须在独立收银台部署、HTTPS 和资源 Host 验证完成后写入精确 Origin。
- 本项目不依赖 PWA 或 Service Worker。

## 当前能力边界

阶段 B 的目标范围是商家登录、新订单与未完成订单、订单详情和状态操作、桌台总览、整桌账单、横屏布局以及前台新订单声音提醒。实际可用能力以代码、自动测试和真机验收结果为准。

当前明确不包含：

- 浏览器直接 USB/LAN、蓝牙、云打印或任意 ESC/POS 字节
- TCP 9100 或厂商打印 SDK
- JavaScript 打印 Bridge
- 完整现场点餐、会员、交班和复杂收银
- 未经备份 Gate 的生产 migration 或服务器配置修改

打印入口在任务中心、商家开关、打印机和执行器可用前保持禁用，不得伪造“打印成功”。
