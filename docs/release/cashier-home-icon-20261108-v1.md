# 收银手机桌面图标发布

- 日期：2026-11-08（越南时间）。
- 版本：`cashier-home-icon-20261108-v1`。
- 授权：用户明确要求“进行提交，上线”。
- 代码：[a4c3913](https://github.com/peten001/HuayueLife-MVP/commit/a4c391378bd66a6b49c4afcbbb7647469d62353a)，源码树 `6e1f9a5cbd27d64acfc5b763ee656daa60478b70`。
- 状态：已同步 GitHub main 并上线。

## 改动与验证

收银 Apple touch icon 和 Android PWA 图标改用满底绿色方形，保留白色 YQ、厨师帽及餐盘标识。提供 96／144／180／192／256／512 六种尺寸，新文件名更新缓存，根路径 Apple 图标同步更新。浏览器标签页图标同步换新。页面内 Logo、启动图、登录和收银界面保持。KDS 构建显式保留旧图标入口，独立 KDS 本次不发布。

收银 101 个测试文件、817 项测试，类型检查、lint 和生产构建通过。系统 Chrome 对六种尺寸逐像素检查，无透明像素或黑色像素；白色标识最远半径约为画布宽度 35.3%，位于 40% maskable 安全圆内。KDS 元数据转换隔离检查通过。

## 发布边界与结果

采用现有生产收银制品叠加图标的方式发布，只变更 9 个文件：HTML、manifest、根 Apple 图标和 6 个新尺寸图片。原生产全部程序资源与页面内图片逐文件保持，避免重新构建引入与此次图标无关的运行代码变化。原 903 个文件，新版共 909 个文件；服务器全部 SHA-256 校验通过，9 个变更文件服务器 HTTPS 校验通过，深链正常。独立 KDS 首页哈希、API、商家／平台后台、Nginx 和环境保持；无数据库迁移、生产业务写入或服务重启。API online，PID 3411961、restart 21、unstable 0 保持。

线上指针：`/var/www/huayue-cashier-releases/cashier-home-icon-20261108-v1`。完整旧包备份 8,097,714 bytes、903 文件逐项核对，SHA-256 `eba6631a28b8f6a229ae520f06f9d01b782aaec9fffa15851bac359936333bf7`，旧目录原样保留。

备份：`/opt/backups/yunqiao-cashier-home-icon-20261108-v1`，包含源码快照、制品清单、发布脚本、发布校验记录及旧包。回退：`sudo python3 /opt/backups/yunqiao-cashier-home-icon-20261108-v1/rollback.py`，仅恢复本次收银指针，拒绝覆盖后续版本。

网页刷新后使用新版标签页图标；已有手机桌面快捷方式需删除后重新添加。真实手机主屏幕裁切效果由用户验收。本次保留工作区原有小程序、共享坐标及相关文档修改，未提交或发布这些改动。

外网复核通过：9 个变更文件 SHA-256 与制品一致；390px 手机及 1366px 电脑入口均正常进入登录页，无页面脚本错误；线上 Apple 图标为 180×180，全像素不透明且无黑色像素。记录见 [外网检查](cashier-home-icon-20261108-public-pass.json)。
