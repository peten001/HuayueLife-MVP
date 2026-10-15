# KDS 发布说明

## 2026-10-15 可选传菜

版本 `kds-serving-toggle-20261015-v3`：门店级传菜开关默认开启，关闭后划菜即出餐，并隐藏传菜入口、统计和操作。关停前已做未传量自动出餐，重新开启不重复挂回；厨房数量及收银交付保护保留。

发布需先备份数据库和原 API／KDS／依赖指针，再以 Prisma 5.22.0 应用唯一新增迁移 `20261015040000_kds_optional_serving`。迁移只有默认 true 的新增列，默认不关闭任何门店。运行客户端同步增加该字段，使用独立的新依赖副本和 Linux 生成产物；旧依赖不覆盖。候选 API 除本次厨房及收银厨房门禁文案外不得更改其他运行代码。迁移、候选读取、健康和鉴权验证通过后切换 API，再切换 KDS；收银静态版仍保持原 v3。

备份及切换记录位于 `/opt/backups/yunqiao-kds-serving-toggle-20261015-v3`。失败恢复原 API、依赖及 KDS 指针，保留兼容旧版的新增列；不删除列、回放数据库备份或更改生产订单来回滚。线上只验证默认仍开启、页面资源和鉴权／健康；开关关闭及实际出餐流程仅在隔离数据库与本地样本验证，不代替用户操作真实门店。

本地 610 项前端、1310 项后端和 30 项隔离 MySQL 流程、全仓类型／构建、lint、KDS 独立构建通过。

## 2026-10-15 菜名三语修复

版本 `kds-dish-locale-20261015-v2`：菜名跟随中英越语言切换，覆盖标准／汇总／待传／进度／历史记录、搜索及辅助名称；缺译名回退原中文。名称变化不改变任务、分组键、已选数量或厨房操作。

发布方式沿用下述菜图版流程，仅替换 API `kds.service` 的三项编译产物，再更新 KDS 静态版本；无依赖或结构变更。API、KDS 及回退目录分别使用同名版本 `kds-dish-locale-20261015-v2`，备份位于 `/opt/backups/yunqiao-kds-dish-locale-20261015-v2`。保留既有压缩图规则和收银静态页面。除页面资源、鉴权及健康检查外，验证看板和记录译名与门店现有商品数据一致；不创建或划菜生产订单。

本地 607 项前端、14 项 KDS API、全仓类型／构建、lint、KDS 独立构建，以及越南语长菜名浏览器排版检查通过。

## 2026-10-15 菜图与紧凑详情

发布版本 `kds-thumbnails-20261015-v1`，包含当前门店任务的已有压缩菜图、48px 缩略图与紧凑明细、“划完／传完”在上而数量加减在下，以及右侧重复桌号／档口说明的移除。图片缺失或失败仅显示占位，绝不回退原图。

本次没有依赖、数据库结构或厨房写入流程变更。API 新目录复制当前线上编译产物，只替换本次构建的 `kds.service.js` 及其映射／声明文件；沿用现有运行依赖和生产配置。先备份原指针与校验值、检查候选代码，再切换 API 并重启原 PM2 服务，健康及受保护看板读取通过后切换 KDS 静态指针。保留旧静态资源和完整旧版目录；任一步失败恢复两个指针及原 API。收银静态版本不切换。

发布目录约定：

- API：`/opt/huayue-api-releases/kds-thumbnails-20261015-v1/apps/api/dist`
- KDS：`/var/www/huayue-kds-releases/kds-thumbnails-20261015-v1`
- 备份及实际发布记录：`/opt/backups/yunqiao-kds-thumbnails-20261015-v1`

提交、源码树及构建文件校验值写入 `SOURCE_REVISION.json`／`ARTIFACTS.json`；仅在公网页面／资源、API 健康、鉴权看板压缩图字段和收银版本均验证通过后生成 `DEPLOYMENT_PASS.json`。不运行数据库迁移、回填图片或生产测试订单。

本地验证：605 项前端、13 项 KDS API 单元测试、全仓类型与构建、前端 lint、KDS 独立构建，以及三语和桌面／小屏浏览器布局通过。

## 定稿基线 · 2026-10-14

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
