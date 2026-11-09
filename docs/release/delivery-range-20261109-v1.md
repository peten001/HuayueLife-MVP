# 配送超距禁止下单发布

- 2026-11-09 已提交、同步 GitHub main 并部署 API。
- 版本：`delivery-range-20261109-v1`。
- 代码：[072d7900](https://github.com/peten001/HuayueLife-MVP/commit/072d7900a06f5ce3b09d8b9231bc91c37941d659)。
- 小程序由用户手动发布，助手未上传或正式发布微信版本。

## 已上线行为

超出商家半径的配送预览及创建返回 HTTP 400；缺少有效收餐坐标不能跳过距离校验。范围边界包含、0 km 是零半径，范围内按原设置计费。创建时再读取当次商家配置，防止预览后半径已收紧仍下单；拒绝时保留购物车，不创建订单、推送或打印。堂食、自取及已生成订单履约保持。

小程序结算页超距时禁用提交按钮，显示重新选址提示；选回范围内恢复下单。配送预览失败不再忽略错误后转创建，中文／越南语／英语提示同步。源代码及待上传包只包含本次配送范围限制；首页、地图导航、此前地址回填等未提交改动仍保留在本地。

## 部署结果

API 从当前 `platform-admin-20261106-v1` 编译目录复制候选，只允许覆盖 `orders.service.js`、`.js.map`、`.d.ts`；实际 JS 与映射两项变化，其余 890 项保持。候选 `/opt/huayue-api-releases/delivery-range-20261109-v1/apps/api/dist`，仅切换 canonical API 的 `dist` 指针，依赖指针未变。

原 Linux 依赖与完整运行包备份逐项核对，12,070 项一致，没有安装或升级依赖、生成 Prisma Client 或运行迁移。环境、49 条有效迁移、18 项受保护配置、商家与总控记录、上传图片和各网页终端校验保持。总控仍为 `true`，原更新时间 `2026-11-06T08:26:39.285Z` 未改。

备份后预核对发现打印机记录变化。将原备份中的打印机和平台设置恢复到独立临时审计库，逐字段比较确认仅 `capabilities.connectorStatusUpdatedAt`、`capabilities.lastConnectedAt` 两个运行时间变化。校验只排除这两个时间，真实打印配置继续与备份比较；临时审计库已删除，没有修改生产配置。

候选以回环地址及诊断模式启动，停止候选后核对原服务／配置，再切换 API。原进程正常重启一次：PID `337520`、restart `22`、unstable `0`、online；工作目录、入口和原环境保持，PM2 已保存。未触发回退。

## 验证

- 实现阶段完整 API：123 套、1,419 项测试通过；完整本地工作区小程序 30 项检查、全仓类型及构建通过。
- 确切提交：小程序原有 14 项加本次 6 项共 20 项流程通过，包含真实提交按钮模板的禁用／恢复／点击；类型和微信构建通过。API 从同一内容树重建，16 项实际订单服务回归通过。
- 候选及切换后的 Linux 部署产物分别执行 16 项范围／缺坐标／费用／边界／预览后半径变化／堂食自取校验。使用模拟事务，断言拒绝时不产生订单、购物车结算、推送或打印；不等同于生产 HTTP 下单或真机验收。
- 服务器健康与公开配置 200，用户订单、商家订单及 KDS 未认证入口 401；本机外网再核对这 5 项和收银／KDS 网页，共 7 项通过。
- canonical `apps/miniapp/dist/build/mp-weixin` 从确切提交重建，226 个构建文件逐项核对，生产 API 地址正确；两份本机微信配置哈希保持。国际化和微信质量 6 项守卫通过。用户上传后真机验证超距禁用、范围内下单及改址恢复。

没有在生产创建测试订单、聊天、打印或收款；现有实库 e2e 断言已更新，本轮没有运行整套 MySQL e2e。工作区其他未提交改动未被覆盖或带入提交。

## 备份与追溯

服务器备份 `/opt/backups/yunqiao-delivery-range-20261109-v1`；本机只读验收凭证 `/Users/peter/Desktop/YunQiao-server-backups-20261109/delivery-range-20261109-v1`。

| 归档 | 大小 | SHA-256 |
| --- | ---: | --- |
| 完整数据库 | 87,190,843 bytes | `07559ded1ece6fb88550512ba41f1318b3065e362acc726d3fba1816ba1de1a2` |
| 原完整 Linux 运行包 | 90,070,380 bytes | `74b434f2174ef332420198ede6cdb157135e737994ec7b5791b76503a6f0d243` |
| 原 API 编译目录 | 909,418 bytes | `32113ce540208ef2d5332714e99518dda1fd9ddeb5d6355129efdc3daf2c467f` |

数据库解压 1,126,014,504 bytes，gzip 校验通过；原运行包 13,448 项、旧编译目录 892 项逐一核对。API 发布包 15,881 bytes，SHA-256 `7a38c9af78c87342fbe036b3d4e8470441d27b3bf0d46eb79068737170223cff`。

本机构建提交 `131109ba49c75abd754d26ceb26e87f4a63fb89f` 和 GitHub `072d7900a06f5ce3b09d8b9231bc91c37941d659` 的内容树同为 `49aef48d521d19dc9dcda2e5f7fdeb9dede54cc4`，已按确切 Git 对象核对。本机原 canonical 完整备份在 `/var/folders/p9/h0kqpj597cdbj8gjnx0r2ftw0000gn/T/yunqiao-delivery-range-release-20261109-2zt2jkey/miniapp-before-release.tgz`。

`BACKUP_PASS`、`PREPARE_PASS`、`SHADOW_PASS`、`LIVE_CONTRACT_PASS`、`DEPLOYMENT_PASS`、`PUBLIC_PASS`、`FINAL_PASS` 和 `MINIAPP_HANDOFF_PASS` 均保存。恢复脚本已放在服务器备份目录。

如需回退，仅执行备份目录的 `python3 /opt/backups/yunqiao-delivery-range-20261109-v1/yunqiao-delivery-range-deploy-20261109.py rollback`。脚本确认当前指针仍属于本版本后恢复旧编译指针并重启，不恢复营业数据库、不重置商家或平台设置；不会覆盖后续其他发布。该命令本次未执行。
