# 平台后台连续切页空白修复

2026-11-06 已提交、同步 GitHub main 并上线。代码：[`9bb5c00d`](https://github.com/peten001/HuayueLife-MVP/commit/9bb5c00d73a13f9a7f5d5896d42b13ccc2aa9a43)，版本 `platform-navigation-20261106-v1`。

## 原因与修复

原版可稳定复现：进入订单管理，再点击平台设置，地址正常改变，但正文只剩注释占位，随后继续点击其他导航仍为空白；刷新后恢复。“行业与能力”也存在同样触发条件。

平台布局直接把页面组件放入 `Transition mode="out-in"`。订单和行业页面有多个根节点，Vue 提示 `Component inside <Transition> renders non-element root node that cannot be animated`；退出动画无法完成，切页容器一直等待。原先逐页验收使用完整导航，每次重新加载文档，未覆盖这条连续切页路径。

现改为公共布局提供一个按路由路径标识的真实 DOM 容器，页面内容在其中渲染；动效只作用于这个固定单根容器，保留原有节奏。查询参数变化不额外重建页面，页面之间仍正常重新挂载。没有更改业务页面的操作、颜色、权限或资料。

实际依赖为 Vue 3.5.35、Vue Router 4.6.4，未升级依赖。根节点约束参照 [Vue 官方 Transition 文档](https://vuejs.org/guide/built-ins/transition)。

## 验证

- 新增真实浏览器连续导航回归，修复前在订单→设置处失败并出现空白及 Vue 警告，修复后通过。
- 后台类型／生产构建、原有后台测试通过；使用确切提交的干净源码再次构建。
- `test:platform` 完整通过：原有 22 个视图、15 条业务流程、42 组英越文布局，以及新增正常动效／减少动态效果两种模式下的导航回归。
- 每种模式检查 45 次页面到达状态、52 次快速点击、浏览器前进后退；共 90 个状态、104 次快速点击。每个模式只有初次进入时的一次文档请求，之后没有刷新页面。
- 正式域名采用拦截非 GET／HEAD 业务请求的独立浏览器，同样 90 个状态和 104 次快速点击全部通过，无空白、切页警告或页面运行异常。临时验证凭证和会话已清理。
- 外网 16 个发布文件、3 个平台入口及 3 个原商家入口共 22 项状态／哈希通过；健康接口 200、未登录平台设置接口 401。

导航回归已接入 `corepack pnpm --filter @huayue-life/merchant-admin test:platform`，不再只检查逐页刷新后的结果。摘要见 [验收记录](../ui-review/platform-admin-redesign/navigation-fix-20261106.json)。

## 发布与保护

只发布平台网页至 `/var/www/huayue-admin-releases/platform-navigation-20261106-v1`，Nginx 仅替换原平台静态目录的六处引用。原商家入口保持旧 HTML，29 个旧哈希资源保留；收银、KDS、小程序和 API 均未发布或重启。

切换前后 18 项配置表、8,365 个受保护文件、API／商家／收银／KDS 指针及环境保持。打印连接心跳中的两个时间戳按运行信息处理，不修改设备配置。经营总控继续为用户当前设置的 `true`，更新时间 `2026-11-06T08:26:39.285Z` 逐字保持；没有切换生产开关来验收。API PID `3411961`、重启计数 `21`、online 保持。

源码构建提交 `e3b8a1345885bd2b0e8056d44d9b3b0dd1fc5221` 与 GitHub `9bb5c00d` 的内容树同为 `b9b19393a400e1505d8c90b2663ba8f0cee52eb5`。网页包 2,905,752 bytes，SHA-256 `fd6d5a46b22e644876c083729a421625bc2d96007655b5ac86624bd67b064e14`。

旧平台网页完整备份 5,407,864 bytes，43 项逐一校验，SHA-256 `6089dc12cf938fb34aea349eba06d94134c8fe71a8c232b4ec7e04e5571cc1c9`。备份、原 Nginx、原指针、配置哈希和验收凭证保存在 `/opt/backups/yunqiao-platform-navigation-20261106-v1`，真实业务截图不进入公开仓库。

需要回退时在服务器执行 `python3 /opt/backups/yunqiao-platform-navigation-20261106-v1/deploy.py rollback`：只恢复本补丁修改的 Nginx 路由，不回退数据库、经营开关或其他后续版本。该命令本次未执行。

已打开旧版的浏览器需要刷新一次加载修复版，之后正常切页无需再刷新。
