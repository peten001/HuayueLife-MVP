# 收银打印设备状态图标发布

- 日期：2026-10-25（越南时间）。
- 版本：`cashier-printer-status-20261025-v1`。
- 用户授权：提交、推送、上线部署。
- 状态：已提交、同步 GitHub main 并上线，服务器、外网和页面加载复核通过。
- 代码：[692c117](https://github.com/peten001/HuayueLife-MVP/commit/692c117bc71ae9aceecb22cd5d11224a89889f10)，源码树 `9db114a2832ec1d5c21ad83b2fcdbafe9440d63c`。

## 范围与行为

商家 325 已有在线的 Wi-Fi 打印机，收银右上角仍显示设备离线。原因是状态图标沿用了仅检查 USB 的人工打印入口判断。现图标汇总全部已启用设备：USB、Wi-Fi／网口、飞鹅或易联任意一台满足服务端在线与 readiness 判断，即显示可用；全部离线仍显示离线。电脑和手机使用同一状态来源。

保留商家打印总开关、账号权限、平台执行开关及状态查询失败保护。人工打印任务入口继续使用原执行判断，不改变任务路由、设备配置、连接协议或物理打印。

## 验证与发布边界

803 项收银测试、类型检查、lint 和生产构建已通过；回归覆盖 USB 离线但网络／两种云打印在线，以及唯一网络设备断开或停用。正式发布重新构建生产制品并关联提交与源码树，服务器和本机外网逐文件核对 SHA-256。

仅发布 `/var/www/huayue-cashier` 指向的收银静态页。发布前完整备份当前目录并逐文件校验，候选保留历史哈希资源；切换后校验失败自动恢复原静态指针。API、数据库、KDS、商家后台、Nginx、服务配置和 Windows 安装包均不在本次范围，不进行生产订单或测试打印。

预核对旧收银为 `delivery-navigation-compat-20261025-v1`；API online，PID `3728033`、重启计数 `19`。备份计划：`/opt/backups/yunqiao-cashier-printer-status-20261025-v1`。实际切换前再次核对当前状态。

## 发布结果

收银当前指针为 `/var/www/huayue-cashier-releases/cashier-printer-status-20261025-v1`。服务器及本机外网分别核对全部 69 个发布文件，SHA-256 全部一致；收银深链 200、API 健康 200、未认证订单／KDS 接口 401，后台与独立 KDS 首页保持原哈希。线上浏览器现有登录会话正常进入桌台总览；该会话属于另一门店，不将其当作商家 325 终端的实机验收。

商家 325 只读核对：网络打印机 45 已启用、`ONLINE`、readiness 为 `READY`，停用的 USB 打印机不计入可用设备。该网络设备符合新版图标判断，门店终端刷新或重开页面后生效；未创建测试订单、触发打印或改变设备配置。

旧目录完整备份 7,122,865 bytes，793 个文件逐项校验通过，SHA-256 `f886ce8421a99d4d4b20f62710828ea12e90b953d277e514c57e8c345c28ccd6`。候选额外保留 760 个旧哈希资源，原版本目录保持；发布包 1,084,206 bytes，SHA-256 `4c1704bd81246515fc6d91839513b0a832ed7d9c185bda8b062c508adf0f8c1b`，并保存对应已提交源码快照。

API 仍为 PID `3728033`、重启计数 `19`、online，API 编译文件清单、依赖和运行指针、环境哈希、Nginx、KDS 与后台保持。没有数据库迁移、服务重启、安装包或小程序发布。

备份与凭证：`/opt/backups/yunqiao-cashier-printer-status-20261025-v1`，`DEPLOYMENT_PASS.json`、`PUBLIC_PASS.json` 和页面加载记录均 PASS。回退命令：`sudo python3 /opt/backups/yunqiao-cashier-printer-status-20261025-v1/deploy-static.py rollback`；先核对当前版本和旧目录完整性，再恢复原收银静态指针，不恢复数据库或重启 API。
