# 收银与商家后台现行外壳清理发布

- 日期：2026-10-20（越南时间）。
- 状态：已提交、推送 GitHub main，并上线。
- 版本：`current-merchant-shells-20261020-v2`。
- 代码：[b9315d6](https://github.com/peten001/HuayueLife-MVP/commit/b9315d60c11ba7b8e2aabf99206b8128d4e0ab74)，源码树 `d6f188a5a601276b8723930fd71665ccf8d0637c`。

## 发布结果

收银和商家后台保留现行电脑与手机外壳，删除 10 个旧界面文件、旧布局分支及专属样式。收银新页面默认继承现行手机外壳，历史书签在鉴权后、挂载前解析目标。后台旧设置／打印等入口只跳转现行页面，无权限内容同样留在现行 MerchantLayout。功能和本地验证见 [清理记录](../current-merchant-shells.md)。

只更新静态页面。服务器和外网分别核对收银 68、商家后台 15 个发布文件的 SHA-256；预约／历史订单入口、后台首页／打印／无权限深链通过。正式后台和 IP 入口的同源 API 代理返回正常鉴权 401；API 健康 200，未认证 KDS 401，KDS 首页哈希保持。手机 390 和电脑 1366 的收银、正式后台、后台 IP 入口共 6 组登录页检查通过，无横向溢出或页面脚本错误。

722 项收银测试、后台全套 package 测试及 lint、全项目类型与构建通过；另有 86 组外壳入口、后台 136 组页面宽度／64 组语言／54 组导航及 19 组交互、预约隔离真实 API 5 流程／7 手机／3 电脑验证。登录后的功能在隔离本地数据上测试，未创建生产测试订单、消息或支付。WebKit 浏览器包缺失，真实 iPhone 主屏幕仍待用户验收；外部地图瓦片在回归中隔离，不代表影像验收。

## 实际入口、备份和回退

| 入口 | 当前指针 | 原目标 | 完整归档 bytes |
| --- | --- | --- | --- |
| 收银 | `/var/www/huayue-cashier` | `reservation-mobile-v2-20261020-v1` | 5,500,298 |
| 后台正式域名 | `/var/www/huayue-admin-current` | `arrival-reservations-20261019-v1` | 3,486,697 |
| 后台历史别名 | `/var/www/huayue-admin` | `20260803-143818-merchant-admin-6bfa253` | 2,612,275 |
| 后台 IP 入口 | `/opt/HuayueLife-MVP/apps/merchant-admin/dist` | `20260922-135556-order-chat-location-53e2d78/dist` | 2,744,482 |

收银当前目标为 `/var/www/huayue-cashier-releases/current-merchant-shells-20261020-v2`。三个后台指针均指向 `/var/www/huayue-admin-releases/current-merchant-shells-20261020-v2`。后台使用原有同源 `/api/v1` 代理，正式域名和 IP 入口均可工作，无需修改 Nginx。

备份 `/opt/backups/yunqiao-current-merchant-shells-20261020-v2`，含全部旧入口逐文件验证后的完整归档、候选、源码快照、SHA-256 清单及回退脚本。归档 SHA-256：

- 收银：`36de40991ccdf89fb2d66c6bf28c93c8bf0d3a59deedecda5010b748036d85f1`。
- 正式后台：`a38618104add0177312d793ce4a6e84604b051fe06c6799dcf509b44cf3dda68`。
- 历史别名：`0e2373218542f5789b66a4d1db9c3ff8254087ee7ea1f55abdd413cdeaf584e7`。
- IP 入口：`84271e25dae691f20fbb679d0d7264c3ceb74c1e256e91d8724db747eeff044a`。

收银保留 572 个、后台合并保留 21 个旧哈希资源供已打开页面过渡，现行入口不再提供旧布局回退；所有原版本目录保持。回退命令为 `sudo python3 /opt/backups/yunqiao-current-merchant-shells-20261020-v2/rollback.py`，先验证四个当前指针，再恢复各自原目标。

API 运行代码／依赖、KDS、Nginx 与服务配置快照前后相同。API online，PID 2041787，重启计数 17 不变，unstable=0。没有服务重启、数据库迁移或生产业务写入。小程序原上传目录保持，本次无需重传。

首轮 v1 核错历史后台别名，切换后的资源检查返回 404，程序自动恢复两站原指针。v2 已按实际 Nginx root 确定正式指针，并在任何切换前核对域名首页与目录首页哈希；同时完整备份、对齐后台兼容入口后发布成功。首次失败凭证保留于对应 v1 备份目录。

三项发布凭证均 PASS，见 [验收目录](../ui-review/current-shell-cleanup/DEPLOYMENT_PASS.json)。用户刷新或重开收银、商家后台即可加载新版本。
