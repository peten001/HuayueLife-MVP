# 收银用餐预约文案与工具栏精简发布

- 日期：2026-10-21（越南时间）。
- 状态：已提交、推送 GitHub main 并上线。
- 版本：`reservation-toolbar-20261021-v1`。
- 代码：[348ee73](https://github.com/peten001/HuayueLife-MVP/commit/348ee733a3a12e16fa4009a39da677444d6b4c2e)，源码树 `581fa7d45753d1379fee5e3de2411d4a3313ea7e`。

商家端统一“用餐预约”，状态精简为待处理／待确认／已确认／已结束／全部，中英越同步。电脑和手机删除列表日期、电话筛选及越南时间提示；手机删除刷新按钮，五项筛选完整单行显示；电脑保留刷新、窄列表换行。顾客电话、预约实际时间与改约、确认、桌号安排、入座及聊天保持原流程。

## 验证与发布范围

沿用上一轮相同源码的 722 项收银测试、类型／构建／lint，以及隔离本地 API 5 流程、9 组手机与 9 组电脑三语布局验收。发布前用正式 API 地址、关闭演示数据重新构建，GitHub 源码树逐项核对一致。服务器与外网分别核对全部 68 个发布文件 SHA-256，预约及历史入口正常；390／1366 的手机与电脑登录入口无横向溢出或页面脚本错误。受保护页面内的操作由隔离本地 API 验证，未代用户操作生产预约或消息。详细凭证见 [验收目录](../ui-review/reservation-toolbar/README.md)。

仅切换收银静态页面。API online，PID 2041787，重启计数 17 保持，unstable=0；API 代码／依赖、商家后台正式入口及兼容入口、KDS、Nginx 和服务配置的前后快照一致。健康接口 200，未认证 KDS 401，后台与 KDS 首页哈希保持。无数据库迁移、生产业务写入或服务重启。小程序无需重新上传。

## 备份与回退

当前指针 `/var/www/huayue-cashier` 指向 `/var/www/huayue-cashier-releases/reservation-toolbar-20261021-v1`，旧目标 `/var/www/huayue-cashier-releases/current-merchant-shells-20261020-v2` 保持原样。新目录额外保留 611 个旧哈希资源，供已打开页面过渡。

备份目录 `/opt/backups/yunqiao-reservation-toolbar-20261021-v1`，含逐文件校验后的原收银归档、候选包、已提交源码快照及清单、检查凭证和回退脚本。原收银归档 5,845,208 bytes，SHA-256 `5ad603a61b22b966be887e7f2cb83a46d3768564af9e8bfb97e06199033e7582`。发布包 SHA-256 `5d9c254c25b6ddabeebc3dec9094ee86a83c946c10c3b23ce664a6dd0bf53e3d`。

回退命令：`sudo python3 /opt/backups/yunqiao-reservation-toolbar-20261021-v1/rollback.py`；脚本先核对当前版本，再原子恢复旧指针。发布失败会自动恢复旧版，本次发布与全部复核成功，未触发回退。用户刷新或重开收银页即可加载新版。
