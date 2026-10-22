# 打包自取恢复普通流程发布

- 日期：2026-10-22（越南时间）。
- 状态：代码已提交、推送 GitHub main，API 与收银已上线；小程序构建已完成并打开微信工具，等待用户手动上传体验版。
- 版本：`pickup-simple-20261022-v1`。
- 代码：[ccb73d9](https://github.com/peten001/HuayueLife-MVP/commit/ccb73d98c4a5e8b57012052df4b13fed70e4aaa5)，源码树 `7d43eea19f59eb51f9ddd4adf3c5cf626a9a5657`。

## 发布结果

恢复普通自取履约：商家待接单 → 接单直接制作中 → 待取餐 → 收款并确认取餐 → 已完成。删除待备餐／该备餐筛选、30 分钟提醒与自取改约步骤；历史预约自取保留原取餐时间，旧筛选链接进入制作队列。接单立即触发原打印与 KDS，同一接单日志用于旧订单补偿，不重复创建打印意图。用餐预约、配送、扫码堂食保持原流程。

小程序源码只保留“预约到店 → 打包自取”的入口，后续恢复原菜单、购物车与普通结算，不再提交预约时间或预约标记。旧链接与缓存购物车自动归一，原餐品保留。新小程序仍由用户手动上传体验版及正式发布；旧客户端请求继续兼容，商家端统一普通自取履约。

## 验证

沿用相同源码的 1365 项 API、722 项收银、32 项隔离 MySQL HTTP、5 项源码完整流程和 12 组中英越电脑／手机布局验收，全仓类型／构建及收银 lint 通过。发布前正式 API、收银和 canonical 微信包重新构建，小程序独立类型检查与 6 项质量守卫通过，生产 API 地址及原私有工具配置已核对。

服务器复用当前经过验证的 Linux 依赖与 Prisma Client，独立复制完整运行包，覆盖 kds-sync 与 merchant-orders.service 两组共 6 个编译文件（4 个哈希变化，2 个声明保持）。完整运行包、无外逃／断链依赖、Linux 原生模块及 Prisma 契约通过；关闭调度、推送和打印副作用的候选实例在 loopback 正常启动，健康 200，受保护路由未认证 401。没有数据库迁移、依赖升级或服务器源码仓库强制覆盖。

API online，PID `2657599`，重启计数 `18`，unstableRestarts=`0`，原 cwd／exec 路径保持；最终程序哈希与候选一致。服务器与外网分别核对全部 69 个收银文件 SHA-256；自取、预约、历史入口正常。390／1366 的手机与电脑登录入口没有横向溢出或页面异常。业务操作已在隔离本地数据走通，未使用生产账号创建测试订单、接单、制作、收款或发送消息。

KDS、商家后台正式入口及兼容入口、Nginx、API 环境、原上传图片和门店／厨房／打印设置前后保持。健康接口 200，未认证订单／预约／KDS 401；KDS 和后台首页哈希保持。详见 [验收目录](../pickup-simple-flow.md)。

## 版本目录和备份

- API：`/opt/huayue-api-releases/pickup-simple-20261022-v1/runtime`，canonical API dist 与 node_modules 两个指针已切换。
- 收银：`/var/www/huayue-cashier-releases/pickup-simple-20261022-v1`，保留 650 个旧哈希资源供已打开页面过渡。
- 备份：`/opt/backups/yunqiao-pickup-simple-20261022-v1`，API 与收银分别在 `api/`、`cashier/`，包含完整旧版本、源码、清单和回退脚本；原目标目录保持原样。
- 数据库：`api/database.sql.gz`，64,280,435 bytes，解压 800,393,049 bytes，gzip 完整性 PASS，SHA-256 `e2768af8e33ddd74ec95465de00476ab58ffc7f8d2f03e4722cd473740059278`。
- 旧 API 完整运行包（含 Linux 依赖）：89,141,977 bytes，逐文件校验 PASS，SHA-256 `30eb103c2a0c8a0083f4d9ad7bf04e8818efe46c71ef93c5fd97d347b34b841b`。
- 旧收银：6,161,950 bytes，逐文件校验 PASS，SHA-256 `8cbf2790a37e2a1d88f8ca7e53699560210ae44f3a609f95149174c9ed24936a`。

完整回退先执行 `sudo python3 /opt/backups/yunqiao-pickup-simple-20261022-v1/cashier/rollback.py`，再执行 `sudo python3 /opt/backups/yunqiao-pickup-simple-20261022-v1/api/deploy-api.py rollback`；均先核对当前版本，API 恢复旧指针并重启健康检查。回退不恢复旧数据库，不删除真实生产期间的新订单、厨房进度或消息。

## 小程序交付

canonical 目录 `apps/miniapp/dist/build/mp-weixin` 已先备份后重建，原 `project.private.config.json` 哈希保持。微信工具已打开该目录，未代用户上传。由用户手动上传体验版验证后按原流程发布；收银刷新或重开即可加载新版。
