# KDS 改用收银同款叮咚提示音

- 日期：2026-10-27（越南时间）。
- 版本：`kds-doorbell-20261027-v1`。
- 状态：已提交并同步 GitHub main，KDS 已上线。
- 代码：[5317908](https://github.com/peten001/HuayueLife-MVP/commit/5317908274757843c8f84b72a3363c0a2a619a89)，源码树 `a92eda1011500e639019a104a4e7139fae92ef4b`。

## 修改

按用户要求，电脑 KDS 的两声 1047 Hz 高音改为收银同款的 784 → 622 Hz 柔和下降叮咚声。两个终端复用同一个音效数组，音高、时序与持续时间一致；KDS 仍播报“请制作”，收银仍为“请查看”，各端开关、音量、语种、模式和去重逻辑保持独立。同步中英越设置提示及本地 KDS 试听页。

只发布 KDS 静态页面。线上收银保持 `reservation-single-row-20261025-v1`，手机使用的 legacy-sound 实现不改；无 API、数据库、依赖、商家设置或安装包变更。

## 验证与发布保护

817 项收银测试、类型、lint 及独立 KDS 正式构建通过。声音回归实际调用两端播放路径，验证收银原频率及节奏不变、KDS 输出与收银相同、两端播报内容仍分别为“请查看／请制作”；原手机偏好及声音隔离回归通过。本地浏览器检查实际 KDS 试听与设置文案。

切换前完整归档并逐文件验证原 KDS 静态目录，候选保留旧哈希资源；切换失败仅回退 KDS 指针。收银全目录哈希、API 编译产物／依赖指针、PID／重启次数、环境和 Nginx、后台入口保持。生产只检查页面资源和健康／鉴权，不创建订单或触发厨房操作。

发布前：KDS 当前 `desktop-order-audio-20261022-v1`；API online、PID `3728033`、restart=`19`。备份计划 `/opt/backups/yunqiao-kds-doorbell-20261027-v1`。

## 发布结果

KDS 指针已切换至 `/var/www/huayue-kds-releases/kds-doorbell-20261027-v1`。服务器与本机外网各核对全部 28 个新文件，SHA-256 均匹配；健康 200、未认证厨房及订单接口 401。直接读取线上当前入口脚本 `/assets/index-BHU9EoLa.js`，确认两端引用相同音效数组，且活动入口不再包含 1047 Hz 旧 KDS 高音。页面加载无脚本错误，本地浏览器实际试听完成。

旧 KDS 完整归档 2,623,322 bytes、160 文件逐项验证，SHA-256 `353f6926ead9dcca4ef9530cfac1898ed4ec12178a42074c8ee12b043a588033`；新版保留 140 个旧哈希资源。备份 `/opt/backups/yunqiao-kds-doorbell-20261027-v1`，`DEPLOYMENT_PASS.json`、`PUBLIC_PASS.json`、`TONE_PASS.json` 均 PASS。

收银指针及全部文件哈希保持，API 仍为 PID `3728033`、restart=`19`、online，API 代码／依赖指针、环境、Nginx 和后台入口均保持。没有运行数据库迁移、重启服务、创建生产订单、厨房操作或修改门店和生产设备声音偏好。KDS 登录后的真实订单提醒由用户验收，本轮没有生产新单模拟。

需要回退时执行 `sudo python3 /opt/backups/yunqiao-kds-doorbell-20261027-v1/deploy-static.py rollback`，只恢复 KDS 静态指针，不改收银或生产新增数据。
