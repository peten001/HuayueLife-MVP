# 自取与到店用餐分通道发布

2026-10-19 已上线，版本 `pickup-channel-20261019-v3`，源码提交 `052e607c11c88baa13de47a14d8cc428f1084528` 已推送 GitHub main。

收银“到店预约”仅用于到店用餐；打包自取提交后统一由“到店自取”处理接单、改约、备餐与交付。普通自取流程保持；预约自取接单后进入待备餐，显式开始制作后再进入原厨房流程。备餐提醒进入自取队列，顾客未同意改约时禁用开始制作。

本次只发布收银静态文件，未更新 API、运行依赖、KDS、商家后台、配置或数据库。小程序源码及上传构建保持，由用户手动上传体验版。

验证：673 项单测、类型、lint、生产构建通过。真实隔离 API 和源码浏览器验证 5 项流程、13 组布局，包括小程序提交、自取通道接单、改约同意与明确开始制作、堂食确认入座以及断网重试。中英越、手机与电脑均检查日期时间可读性和页面溢出。

服务器及本机外网分别核对 69 个发布文件；线上手机、电脑两组登录页面无页面错误。API 健康 200，未认证 KDS 401；PM2 保持 online、restartCount=14、unstable_restarts=0。没有创建生产测试订单或执行收款。

旧收银归档 3,986,281 bytes，SHA-256 `b7254794b5e0724df100f5e9326b07e2546ace9f61ea6bf733bd45f602541596`，逐文件校验通过；新版本保留 361 个旧哈希资源。失败可仅恢复原收银目录指针，不操作 API、配置和营业数据。

发布目录：`/var/www/huayue-cashier-releases/pickup-channel-20261019-v3`。备份及服务器凭证：`/opt/backups/yunqiao-pickup-channel-20261019-v3`。`DEPLOYMENT_PASS.json`、`PUBLIC_PASS.json`、`BROWSER_PASS.json` 均 PASS。

[脱敏发布凭证](../ui-review/arrival-reservations/pickup-channel/production-validation.json) · [电脑预览](../ui-review/arrival-reservations/pickup-channel/desktop-zh.png) · [手机预览](../ui-review/arrival-reservations/pickup-channel/mobile-vi.png)
