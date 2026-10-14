# KDS 定稿基线 · 2026-10-14

本次定稿包含 KDS 厨房服务、两项数据库迁移、独立登录与构建、标准／汇总划菜、独立待传菜、只读订单进度、退菜及操作记录、中英越设置，以及用户最终确认的三栏分类标题和收银风格的紧凑详情。分类使用蓝／橙／绿底色和加粗文字；不采用此前未获确认的网格或横向清单设计。

- KDS：https://kds.huayueyouxuan.com/
- 收银：https://cashier.huayueyouxuan.com/tables
- API：https://api.huayueyouxuan.com/api/v1

收银导航不增加厨房入口。两个系统沿用同一商家员工账号，使用各自登录与设备设置。厨房操作保留原订单／同次用餐归属、档口范围、版本和幂等保护；制作／传菜直接生效，失败或不确定结果按现有恢复流程处理。所有档口均制作并传出后，非堂食订单才进入待取餐／待配送。

## 构建与验证

在仓库根目录使用已安装的 Node.js 22 和 pnpm 9.15.0：

```sh
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --filter @huayue-life/merchant-cashier lint
corepack pnpm --filter @huayue-life/merchant-cashier test
corepack pnpm --filter @huayue-life/api test
```

KDS 独立生产构建：

```sh
VITE_TERMINAL_MODE=kds \
VITE_API_BASE_URL=https://api.huayueyouxuan.com/api/v1 \
VITE_CASHIER_USE_FIXTURES=false \
VITE_CASHIER_URL=https://cashier.huayueyouxuan.com \
corepack pnpm --filter @huayue-life/merchant-cashier exec vite build --outDir dist-kds
```

数据库流程测试须使用全新的隔离 MySQL 库，通过环境注入测试库的 `DATABASE_URL` 和测试 `JWT_SECRET`，先执行 `prisma:deploy`，再运行：

```sh
corepack pnpm --filter @huayue-life/api exec jest \
  --config test/jest-e2e.config.js --runInBand test/kds.e2e-spec.ts
```

定稿检查：全项目类型／构建、前端 lint、602 项前端测试、1306 项 API 单元测试、21 项真实 MySQL 厨房流程测试通过。两项 KDS 迁移从空库应用成功。先前验收数据未重置。

## 发布与回退

发布包关联已推送的 Git 提交及文件校验值，部署记录保存到服务器备份目录。使用新静态目录、验证内容后原子切换 `/var/www/huayue-kds`；保留旧哈希资源，供已有页面继续加载。公网入口、新版 KDS JS／CSS 及 API 健康检查通过才确认发布成功；失败恢复前一个 KDS 指针。

定稿前已只读核对线上 9 个 KDS 相关 API 编译文件，均与本次完整构建一致；两项迁移的完成状态及校验值与仓库一致。因此此次只发布 KDS 静态页面并记录后端与提交的对应关系，继续使用现有 API v5 和收银 v3，不重启 API、不重复迁移、不执行生产测试订单或导入本地示例数据。

完整功能与既有发布记录见 [KDS_V1.md](KDS_V1.md)。
