# 用餐预约筛选与刷新单行发布

- 日期：2026-10-25（越南时间）。
- 版本：`reservation-single-row-20261025-v1`。
- 授权：用户明确要求“进行提交上线”，包含提交、推送与生产发布。
- 状态：已提交、同步 GitHub main 并上线，服务器、外网与手机／电脑入口核对通过。
- 代码：[c9475e7](https://github.com/peten001/HuayueLife-MVP/commit/c9475e78fa52838688c3c055e5d499ffb1ad7e15)，源码树 `afc8105037fe96d48a74235db354c571d3580385`。

## 改动与验证

电脑用餐预约原五项状态在窄列表中分为两行。现保留待处理、待确认、已确认、已结束、全部和刷新，队列按完整工具栏内容确定最小宽度，收紧左右留白并保持 44px 点击高度、原字号与原筛选逻辑。五项状态及刷新完整同排，无横滑、截字或重叠。手机沿用现行单行五项、无刷新布局。

收银 101 个测试文件、817 项测试，类型检查、lint 与构建通过。隔离 API 5 项流程、9 组手机与 18 组电脑布局通过；电脑覆盖 900／1024／1280／1440／1920px 中英越，以及 900px 各语言显示待确认 1000 条，浏览器错误 0。大数量仅浏览器响应模拟，无生产业务写入。详见 [页面验证](../ui-review/reservation-single-row/README.md)。

## 发布边界与回退

只发布收银静态文件，正式构建关闭 fixtures，使用现行 API 地址。完整备份旧收银目录并逐文件核对后切换指针，保留旧哈希资源；服务器和外网分别核对全部发布文件。API、数据库、商家后台、KDS、Windows 安装包与小程序不变，无迁移或 API 重启；小程序无需重新上传。

备份目录：`/opt/backups/yunqiao-reservation-single-row-20261025-v1`。回退命令：`sudo python3 /opt/backups/yunqiao-reservation-single-row-20261025-v1/deploy-static.py rollback`，只恢复本次收银指针，拒绝覆盖后续发布。

## 发布结果

收银指针已切换至 `/var/www/huayue-cashier-releases/reservation-single-row-20261025-v1`。服务器和本机外网分别核对全部 68 个发布文件，SHA-256 全部一致；预约深链、健康 200，未认证订单／KDS 401，后台与独立 KDS 首页哈希保持。390／900／1366px 线上登录入口无页面异常、资源失败或横向溢出。受保护预约页的业务和单行布局由隔离 API 验证覆盖，无生产预约确认、聊天或打印操作。

旧收银完整归档 7,761,335 bytes，866 文件逐项校验，SHA-256 `8346ff5bf7cc026365d0c77745136833f779980127716dfa374ab9b061842123`；保留 835 个旧哈希资源及原目录。发布包 1,084,033 bytes，SHA-256 `575d6a1befa2ddf7ca606e93b74fce438c6091b3241896b91cb18477fe5af764`，源码快照与提交关联。

API 仍 online，PID `3728033`、restart `19`、unstable `0`；API 文件、运行与依赖指针、环境、Nginx、商家后台及 KDS 逐项保持，无数据库迁移或服务重启，小程序无需重传。线上终端刷新或重开收银页后生效。

`DEPLOYMENT_PASS.json`、`PUBLIC_PASS.json`、`BROWSER_PASS.json` 均 PASS，脱敏副本位于 [页面检查目录](../ui-review/reservation-single-row/README.md)。HTTPS Git 无本机写入凭据，改用已连接 GitHub 工具上传精确文件与树；远端源码树与本地逐项一致，本地任务分支已安全同步到相同提交。
