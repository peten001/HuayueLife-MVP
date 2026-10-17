# KDS 发布说明

## 2026-10-17 未发送菜品删减不产生厨房退菜

用户已明确授权提交、推送和部署，候选版本 `kds-unsent-returns-20261017-v3`。修复整桌同菜跨原订单分配时误扣已发送份数的问题，全部来源的未发送数量优先扣减；只在实际减少已入厨房任务的数量时形成 KDS RETURN，收银修改审计及有效数量计费继续保留。通知失败会与厨房任务创建同事务回滚，不将失败的下发视为已发送。

发布仅复制当前 API 完整运行产物到新目录，替换 `merchant-orders/merchant-orders.service` 和 `table-sessions/dine-in-canonical-state.service` 的 JS／映射／声明共六个文件；其他运行代码与现有依赖不变。原有 1313 项 API 单测通过，补充后相关 44 项单测、39 项隔离 MySQL 全流程、全仓类型检查与构建通过。无数据库、配置、依赖或页面资源变更，不操作 uploads，不在生产创建样本或执行删菜／退菜／划菜。

候选目录 `/opt/huayue-api-releases/kds-unsent-returns-20261017-v3/apps/api/dist`，备份及发布凭证 `/opt/backups/yunqiao-kds-unsent-returns-20261017-v3`。先校验已推送提交、源码树及六个文件的校验值，备份旧 API 与私有配置；验证候选语法及模块加载后原子切换 API 编译目录，并重启原 PM2 服务。验证健康、鉴权、现有 KDS 与桌账只读接口，且收银／KDS 页面指针及资源校验值不变，再生成成功凭证。失败仅恢复兼容退菜数据的当前 API 指针并重启，不恢复营业数据库。

## 2026-10-17 退菜订单制作完成后退出看板

**已上线**：代码提交 `a38ade42fe51e73ad8a4c41db2cf3e3935fbdb12`，源码树 `7e03cc9c448e8e148296035fa4c4c8498c5b00f9`，版本 `kds-return-queue-20261017-v2`。服务器全部 28 个新文件校验通过，服务器和本机外网各验证 13 个入口／JS／CSS 文件；健康 200、未登录看板 401。API／依赖／收银仍指向 `kds-returns-20261017-v1`，API 配置及运行代码、收银首页校验值未变，API online、重启次数保持 8、unstable_restarts=0。没有迁移、API 重启或生产订单写入。旧 KDS 归档 1,904,599 bytes、SHA-256 `826337203003e8dfbad773e95647cb8a968942c9204b283662ce01be86cc13b6`，逐文件校验通过；保留 92 个旧哈希资源。服务器 `DEPLOYMENT_PASS.json` 与本机 `PUBLIC_PASS.json` 均为 PASS。

用户已明确授权提交、推送及部署。候选版本 `kds-return-queue-20261017-v2` 仅更新独立 KDS 静态页，修复有效待做为零的退菜订单仍驻留标准／汇总划菜的问题；制作中的退菜信息和只读进度／历史继续保留，传菜开关沿用原流程。API、数据库及收银静态页面不在本次切换范围，也不重启 API。

本地验证 640 项前端测试、类型、lint 及 KDS 生产构建通过。新增回归覆盖部分／全退后制作完成、传菜开启／关闭、另一桌相同菜品、档口范围、搜索、桌号复用，以及刷新后直接加载全部完成的退菜任务。

先关联已推送提交、源码树与构建校验值，备份旧 KDS 指针及静态资源，再切换 `/var/www/huayue-kds` 到 `/var/www/huayue-kds-releases/kds-return-queue-20261017-v2`。保留旧哈希资源和完整旧目录；任一步核对失败仅恢复原 KDS 指针。验证公网 index／JS／CSS、API 健康和未登录鉴权，并核对 API／收银指针、收银首页校验值与 API 重启次数不变。发布凭证存入 `/opt/backups/yunqiao-kds-return-queue-20261017-v2`；上线状态以实际 `DEPLOYMENT_PASS.json` 为准，不对生产订单做写操作。

## 2026-10-17 退菜保留与跨页面同步

**已上线**：代码提交 `dc220fd73b22d10dc5076c6061b3b1260b601a64`，源码树 `f49d58591643a4b6c6075f2d0eea739fa0d1768b`。API／依赖、收银与独立 KDS 均指向下述候选版本目录，服务器 `DEPLOYMENT_PASS.json` 与本机 `PUBLIC_PASS.json` 均为 PASS。数据库备份 58,014,994 bytes，SHA-256 `583bb5b97b5e91ba11e5d7ed4762e2e66caee587e714cf783c7854d700ca694d`，gzip 校验通过；迁移完成并核对三列的默认零和非空属性。服务器及本机外网分别校验收银 43 个、KDS 13 个文件，健康 200、无凭据看板 401。受保护看板的退菜字段、压缩菜图、翻译及 364 条操作明细核对通过，现有桌账包含只读 returnedItems；没有执行生产订单写操作。API 一次重启、online、unstable_restarts=0，原配置未变化，uploads 保留。此次重新验证 631 项前端、1313 项 API、33 项隔离 MySQL 流程及全项目类型／构建、lint 和正式域名两套静态构建。

用户完成本地验收后授权提交、推送及上线。候选版本 `kds-returns-20261017-v1` 同步发布 API、收银静态页及独立 KDS，支持部分退菜数量、全退删除线、完整订单保留退菜记录、有效金额结账，以及汇总／标准／收银一致展示。

数据库迁移 `20261016090000_retain_returned_dishes` 仅新增默认零的 `order_items.returned_quantity`、`kds_tasks.returned_made_quantity` 和 `returned_served_quantity`。先验证旧迁移校验值及完整备份，再应用该唯一迁移。采用新的 API 依赖副本更新 Prisma Client，旧依赖与版本保留；运行产物仅替换本次涉及的厨房同步、订单、结算、桌账及打印快照模块，不覆盖其他运行代码或 uploads。

发布目录与备份：`/opt/huayue-api-releases/kds-returns-20261017-v1`、`/var/www/huayue-cashier-releases/kds-returns-20261017-v1`、`/var/www/huayue-kds-releases/kds-returns-20261017-v1`、`/opt/backups/yunqiao-kds-returns-20261017-v1`。构建及归档关联已推送的提交、源码树和文件校验值；静态目录保留旧哈希资源，API 健康及受保护只读接口通过后再切换页面。

新退菜记录产生后不得自动回退到硬删除原菜品的旧业务实现；保留新增列，不做逆向迁移或恢复数据库覆盖营业数据。发布失败优先保留兼容退菜数据的新 API，修复或重试页面切换；故障期间只允许在确认没有新退菜记录后回退旧 API。线上仅做健康、鉴权、现有订单及资源的只读核对，不创建测试订单、执行退菜或划菜，不导入本地验收样本。

本地已通过 631 项前端与 33 项隔离 MySQL 流程；API 全量、工作区类型与构建、正式域名的两套静态构建在本次发布时再次核对。实际部署结果以服务器 DEPLOYMENT_PASS.json 为准。

## 2026-10-15 三语遗漏补齐

版本 `kds-locale-audit-20261015-v4`：补齐预置档口、分类、标准单位、系统原因和错误的三语显示。仅替换 API `kds.service` 的编译产物以读取分类既有译名，然后更新 KDS 静态版本；无依赖或数据库变更。候选版本复制当前线上 API，只覆盖该服务三项文件，保留其他运行代码；收银静态版本保持 v3。原 API／依赖／KDS 指针、源提交和文件校验值保存在 `/opt/backups/yunqiao-kds-locale-audit-20261015-v4`。健康、受保护看板分类译名／菜图／菜名及公网资源核对后确认成功；失败恢复原 API 与 KDS，不操作生产订单或门店设置。

本地 618 项前端、16 项 KDS API 单元、全仓类型／构建、lint、KDS 独立构建和浏览器三语检查通过。

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
