# HuayueLife-MVP

北宁/北江华人餐厅扫码点餐平台。

## Workspace

- `apps/api`：NestJS + Prisma API
- `apps/miniapp`：UniApp 微信小程序
- `apps/merchant-admin`：Vue 3 商家后台
- `packages/shared`：共享常量与类型

设计文档见：[docs/MVP-DESIGN.md](docs/MVP-DESIGN.md)。

## 本地启动

```bash
corepack pnpm install
docker compose up -d mysql redis
cp apps/api/.env.example apps/api/.env
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm dev:api
```

API 健康检查：`GET http://localhost:3001/api/v1/health`

其他前端：

```bash
corepack pnpm dev:miniapp
corepack pnpm dev:merchant-admin
```

开发 seed 商家账号：`owner / ChangeMe123!`。仅用于本地开发，部署前必须修改。
