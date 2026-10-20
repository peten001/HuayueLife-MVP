# 配送地图整合发布 · delivery-coordinate-20261020-v1

- 日期：2026-10-20（越南时间）。
- 状态：已提交、推送 GitHub main，收银静态页已上线。
- 源码：[提交 adc439e](https://github.com/peten001/HuayueLife-MVP/commit/adc439ed555f5f2111cf85ff0ca3df01557eadb2)，源码树 `3f9f8baaf38839857cf1c619b768391c0c0a32a9`。

## 最终范围

用户因暂时无法获取 Google Key，取消尚未完成的小程序内嵌 Google 网页选址。删除试验工作区、web-view 和回填页面、共享桥接协议；未引入 Google SDK、密钥或微信业务域名依赖。

保留此前腾讯卫星选点、放大拖动提示、门牌补充、WGS84 转换和坐标行、缓存坐标系统标记与返回保留编辑。商家 Google 导航只用有效 GPS 后缀的经纬度搜索，不自动开始导航；复制只取地址文字。缺少有效坐标的旧订单显示文字并可复制，隐藏 Google 入口。

## 验证

707 项收银测试、9 项真实小程序选点脚本流程、收银 lint、全项目类型和构建通过。canonical 小程序单独类型、微信构建、国际化及 6 项质量守卫通过，定位说明 23 字，媒体 156750 bytes。原有朋友圈预览测试正则未包含基线 DINE_IN 的失败已在功能文档记录。

服务器与本机外网各核对 71 个发布文件。线上已登录收银的桌台页与配送页正常，手机 390×844 无横向溢出、无页面错误；配送为空状态，没有创建生产测试订单。实际搜索链接和复制行为由真实组件单测覆盖，Google Maps App 和地图精度需用户真机验收。

腾讯在北江公开工具点 21.281, 106.197 显示“此区域无卫星图”。保留普通地图切换，不将默认卫星开关描述为越南影像已验证。

## 部署和回退

- 当前目录：`/var/www/huayue-cashier-releases/delivery-coordinate-20261020-v1`。
- 原目录：`/var/www/huayue-cashier-releases/reservation-tables-20261019-v4`。
- 备份：`/opt/backups/yunqiao-delivery-coordinate-20261020-v1`。
- 原收银完整归档：4,586,830 bytes，SHA-256 `7b36e1a0e4c3b181e261dff6b9c4956c7424f1f3a7dc8ccf212578f3fca7ba9f`，逐文件验证通过。
- 保留 439 个旧哈希资源，采用原子静态指针切换。
- API / 依赖 / KDS / 商家后台 / 配置全量快照前后相同。API online，PID 1836682、重启计数 15 不变，unstable=0；健康 200，未认证 KDS 401。
- 没有服务重启、迁移或生产业务写入。小程序由用户手动上传。
- 回退：服务器 `sudo python3 /opt/backups/yunqiao-delivery-coordinate-20261020-v1/rollback.py`，只恢复收银静态目录指针。

本机凭证及截图：`/Users/peter/.codex/visualizations/2026/10/19/01a15222-b0b8-78a0-8c40-e0c0194a6774/outputs/delivery-coordinate-release`；`DEPLOYMENT_PASS.json`、`PUBLIC_PASS.json`、`BROWSER_PASS.json`、`LOCAL_VALIDATION.json` 均 PASS。
