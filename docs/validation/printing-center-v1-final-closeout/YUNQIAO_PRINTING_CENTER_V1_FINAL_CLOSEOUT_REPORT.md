# 云桥 Life｜打印中心 V1 最终技术收尾报告

- 执行日期：2026-07-28
- 最终技术 Gate：PASS
- 正式口径：打印中心 V1 生产发布与技术收尾完成
- RC6：正式提供下载，按需升级，现场设备验证待补充
- RC5：继续支持，不强制升级
- 飞鹅 / 易联云：代码完成，真实设备待验收
- LAN：保留正式架构，兼容设备测试中

## 1. Git 收口

- remote main 原 HEAD：`f6a81d81022d627ffc421c0a88cc35f198144d59`
- 生产发布分支：`release/printing-center-v1-production-rc1`
- 生产发布 HEAD：`b7d1d5785fc135778cfc0d2231e43db4e9c019bd`
- Closeout worktree：`/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-closeout`
- Closeout 分支：`release/printing-center-v1-closeout`
- Merge Commit：`1463397bb1658e00569bde1d35ff9ae060f0ed65`
- Closeout Commit：`2957d95ea4ff71eb89e7f86ef3ff5afb504e45d2`
- Closeout 分支与 main 均已普通 Push 到 GitHub。
- 推 main 前已二次确认 remote main 未发生并发变化。
- 未使用 Force Push、Rebase、ours/theirs 冲突覆盖或远程分支删除。

## 2. RC6 正式下载口径

下载页已从候选版口径调整为：

- 云桥商家终端 RC6
- 正式发布 · 按需升级
- 适用于新设备安装或需要中越双语小票的商家
- 现有 RC5 设备如运行稳定，可继续使用，无需强制升级
- RC6 按需升级，不强制更新
- 本版本已完成代码、签名、自动测试和生产发布

页面明确列出待补充验收：

- D2 / D10 现场安装与 USB 真实打印
- 飞鹅、易联云真实设备
- LAN 兼容打印机

保留并验证路由：

- `/printing-center/android-terminal`
- `/settings/android-terminal`，兼容重定向至 canonical 路由

中、英、越三语文案已同步；页面未声称 D2/D10、飞鹅、易联云或 LAN 已完成真实设备验收。

## 3. RC6 APK

- 包名：`com.yunqiao.life.merchantterminal`
- versionName：`1.0.0-rc6`
- versionCode：`13`
- 文件：`YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk`
- 生产路径：`/var/www/huayue-merchant-downloads/android/rc6/YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk`
- 下载 URL：`https://admin.huayueyouxuan.com/downloads/apk/YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk`
- HTTP：200
- Content-Length：2,051,509 bytes
- SHA-256：`8970fb3ef649fe0795f6313febf10a2355cfa56807011f524c11bb2691c8cb26`

本阶段未重新构建、签名、替换或安装 APK；RC5 APK 未覆盖。

## 4. 本地测试

在 Closeout Commit 对应源码上完成：

- `pnpm install --frozen-lockfile`：PASS
- Merchant Admin typecheck：PASS
- Merchant Admin test：PASS
  - order status log presentation：PASS
  - printing status：PASS
  - cloud execution status：PASS
  - receipt settings / i18n / route contract：PASS
- Merchant Admin production build：PASS
- 全仓 typecheck：PASS
- 全仓 build：PASS
- deployment runtime contract：PASS
- Impeccable detector：0 findings
- `git diff --check`：PASS
- 两个下载路由与集中配置一致性：PASS
- API 相对生产发布 HEAD：零差异
- Cashier / Miniapp 相对生产发布 HEAD：零差异
- Android source 相对生产发布 HEAD：零差异

全仓构建仅用于本地回归；未发布 Cashier 或 Miniapp，也未构建 Android APK。

## 5. Merchant Admin 唯一生产发布

新 release：

`/var/www/huayue-admin-releases/20260728-224032-printing-center-v1-closeout-2957d95`

最终 symlink：

- `/var/www/huayue-admin-current` → 新 release
- `/opt/HuayueLife-MVP/apps/merchant-admin/dist` → 新 release

上一 release 保留：

`/var/www/huayue-admin-releases/20260728-225013-printing-center-v1-8716194`

本地与服务器静态文件逐文件 SHA-256 一致。生产 index SHA-256：

`22839f463ac4e6c9946429e51674baf693538bbb23339159d39e7f432932bfd2`

本次仅新增 Merchant Admin release 并原子切换两个 Admin symlink；未执行 Nginx reload。

## 6. 生产页面验收

复用既有生产 owner 会话完成只读浏览器验收：

- 登录态：正常
- 打印机：正常进入
- 自动打印：正常进入
- 小票设置：正常进入
- 打印记录：正常进入
- 下载页：显示“正式发布 · 按需升级”
- RC5 继续支持、不强制升级：页面可见
- D2 / D10、飞鹅 / 易联云、LAN 待补验：页面可见
- canonical 下载路由：PASS
- 兼容路由重定向：PASS
- 下载 URL、版本、大小、SHA：与集中配置一致
- 应用自身控制台错误：0

新增打印机页面显示：

- LAN：兼容设备测试中
- 飞鹅云打印入口：存在
- 易联云打印入口：存在
- 未填写云设备配置时不允许继续，不伪造成功

未保存打印机、未修改自动打印规则、未触发测试打印或真实出纸。

## 7. API、图片与既有业务面

- API health：`https://api.huayueyouxuan.com/api/v1/health` HTTP 200
- merchantId 4 公共菜单：HTTP 200 / code OK
- 分类：12
- 商品：101
- 当前非空图片：100
- 当前图片 HTTP 200：100/100
- 保护集图片 HTTP 200：97/97
- productId 71：HTTP 200
- 生产数据库只读确认 productId 331/332/333/334 的 `imageUrl` 均为空
- Cashier：HTTP 200；current release 未变化
- Cashier current：`/var/www/huayue-cashier-releases/20260728-rc5-ios-standalone-header-f6a81d8`
- Miniapp：未发布；公共菜单 API 正常

本阶段未修改 uploads、API runtime、数据库数据或生产源码 checkout。

## 8. Cloud 与 LAN 生产状态

- `CLOUD_PRINT_WORKER_ENABLED`：未设置，代码默认关闭
- `FEIE_ENABLED`：未设置，关闭
- `YILIAN_ENABLED`：未设置，关闭
- 飞鹅凭据配置完整性：false
- 易联云凭据配置完整性：false
- 真实云设备出纸：NOT EXECUTED
- LAN executor：未部署
- LAN：默认未开放，不进入自动打印，不伪造测试成功

## 9. 正式 Tags

已创建并普通 Push annotated Tags：

- `printing-center-v1.0.0` → `2957d95ea4ff71eb89e7f86ef3ff5afb504e45d2`
- `merchant-terminal-v1.0.0-rc6` → `02dc42fd3cd362cce572cfe4ec1a12208fcee819`

创建前已确认远程不存在同名 Tag；未覆盖或强推 Tag。

## 10. Worktree 精准清理审计

已再次确认 clean 且同名远程分支 HEAD 完全一致，并完成移除：

- `/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc5-forward-rc1`
- `/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc5-forward-rc2`
- `/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc5-forward-rc3-android`
- `/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-production-rc1`

本报告 Commit 与 Push 完成后最后移除：

- `/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-closeout`

上述五个 worktree 的审计占用合计 2,794,236 KiB，约 2.66 GiB；最终移除后复核路径均不存在。

必须保留：

- `/Users/peter/Desktop/HuayueLife-MVP-forward-canonical-base`：clean，但同名远端分支不存在，未满足 Push 证明
- `/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc1`：含未跟踪 `docs/validation/`，不 clean
- `/Users/peter/Desktop/HuayueLife-MVP-d2-mobile-responsive`
- `/Users/peter/Desktop/HuayueLife-MVP-pickup-rounding`
- `/Users/peter/Desktop/HuayueLife-MVP-dinein-auto-accept`
- `/private/tmp/huayue-rc4-rebuild*`
- `/private/tmp/huayue-admin-rc4-deploy`

未删除任何本地分支或远程分支。

## 11. 后续设备验收

发布后补充：

- D2 覆盖安装、启动、登录、WebView、USB 检测与真实打印
- D10 覆盖安装、启动、登录、WebView、USB 检测与真实打印
- USB 测试小票、真实订单小票、拔插恢复和 App 重启恢复
- 真实堂食结账小票与 513,000 / 3,000 / 510,000 现场核对
- 飞鹅真实设备提交、查询、UNKNOWN、幂等与防重复出纸
- 易联云真实设备提交、查询、UNKNOWN、幂等与防重复出纸
- LAN executor 完成后的兼容设备测试

如设备验收发现问题，从正式 main 创建 Android Hotfix，发布 RC7 或后续修复版本，不回滚整个打印中心平台。

## 12. 禁止项确认

本阶段未执行：

- API 部署
- Migration
- PM2 重启、reload、save 或其他 PM2 操作
- Cashier 发布
- Miniapp 发布
- APK 构建、签名或替换
- D2 / D10 安装
- 真实 USB、飞鹅、易联云或 LAN 出纸
- Force Push
- Rebase
- 远程分支删除
- 生产数据库写操作
- uploads 修改

## 13. 最终结论

打印中心 V1：生产发布与技术收尾完成。

RC6 作为正式下载的按需升级版本；RC5 继续支持且不强制升级。云打印代码闭环保留，但真实飞鹅 / 易联云设备待验收；LAN 保留正式架构并继续兼容设备测试。最终技术 Gate：PASS。
