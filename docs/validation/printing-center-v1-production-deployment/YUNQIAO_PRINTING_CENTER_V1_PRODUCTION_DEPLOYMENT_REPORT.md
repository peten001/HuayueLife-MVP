# 云桥 Life｜打印中心 V1 生产部署报告

- 执行日期：2026-07-28
- 最终结论：PASS
- 设备出纸结论：NOT EXECUTED（按指令不安装 D2/D10，不执行真实飞鹅/易联云出纸）
- 生产备份：/opt/backups/printing-center-v1-20260728-222745

## 1. 发布基线与 Git

- 本地生产发布 worktree：/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-production-rc1
- 分支：release/printing-center-v1-production-rc1
- 部署代码 Commit：8716194298473b5274ec7af75dff8eb14f69e28c
- Commit 信息：chore(release): prepare printing center production rollout
- 部署前已普通 Push 至远程同名分支。
- 生产独立源码 checkout：/home/ubuntu/huayue-printing-center-v1-production-rc1
- 生产独立 checkout HEAD：8716194298473b5274ec7af75dff8eb14f69e28c
- 正式生产源码 checkout 仍保持 HEAD a8630760e10df7366d436ccd1a2725f9f4f2acb1；未执行 pull、reset、clean、merge 或 tag。
- 本报告提交完成后，分支最终 HEAD 以本文件所在部署记录 Commit 为准。

## 2. 实际部署范围

已部署：

- API 独立 release 与 canonical dist。
- 3 个打印中心 Migration。
- Merchant Admin 独立静态 release。
- PM2 canonical cwd 与 exec path。
- RC6 APK 新版本静态目录。
- RC6 下载页面、打印中心下载路由与兼容路由。
- Nginx Admin current symlink 与 RC6 精确下载别名。

明确未部署：

- Cashier。
- Miniapp。
- LAN executor。
- Windows 打印助手。
- Android USB Connector 核心变更。
- Cloud Worker 实际执行。
- D2/D10 安装。
- main Merge、Tag。

## 3. 部署前完整备份

备份目录：

/opt/backups/printing-center-v1-20260728-222745

最终目录大小约 164 MB；SHA256SUMS 覆盖 122 个备份与证据文件，SHA256SUMS.verify 全部通过。

### 数据库

- 文件：database-huayueyouxuan.sql.gz
- 压缩后大小：204,854 bytes
- SHA-256：f167be3bf775ea423200ef395045b3a6c617c9526798fab0dff53bbb8a7c2c97
- gzip 完整性：PASS
- 数据库：localhost:3306 / huayueyouxuan
- 未输出数据库密码、Hash、Token 或任何密钥。

### uploads

- 文件：uploads.tar.gz
- 原始大小：141,034,864 bytes
- 压缩后大小：140,889,005 bytes
- SHA-256：04e3db0efdfeb6e172de0696469655fef4b1b6996104b4f7181861147bba5df4
- 文件：330/330
- products 文件：315/315
- tar/gzip 完整性：PASS
- 部署过程中未移动、覆盖或清理 /opt/HuayueLife-MVP/apps/api/uploads。
- 切换前后 330 个文件逐文件 SHA-256：一致。

### PM2、当前 release 与配置

已备份：

- PM2 list、show、jlist、dump。
- 进程 cwd 与 cmdline。
- canonical API dist。
- 旧 Cashier RC5 API dist。
- Merchant Admin RC4。
- 当前 Android 下载目录。
- 当前 Cashier 静态 release。
- Nginx 配置。
- 生产源码 Git bundle、bundle verify、Git status 与 Git log。
- API .env 仅保存在权限 600 的生产备份中；报告不包含任何环境变量值或密钥。

## 4. 本地与服务器构建回归

在部署代码 Commit 8716194 上完成：

- pnpm frozen install：PASS。
- API Prisma generate：PASS。
- API typecheck：PASS。
- API build：PASS。
- API 全量 Jest：43/43 suites、423/423 tests PASS。
- 打印、结账与 rounding 定向回归：26/26 suites、277/277 tests PASS。
- 513,000 / 3,000 / 510,000：PASS。
- Merchant Admin typecheck：PASS。
- Merchant Admin test：4 个脚本全部 PASS。
- Merchant Admin production build：PASS。
- deploy runtime contract 与 shell syntax：PASS。
- Impeccable 静态检测：0 findings。
- git diff --check：PASS。
- 密钥扫描：PASS。
- 服务器独立 checkout 再次完成 API build、定向测试及 Merchant Admin typecheck/test/build：PASS。

未构建或发布 Cashier、Miniapp。

## 5. Migration Gate

部署前：

- 已应用 Migration：19。
- failed Migration：0。
- pending：3。
- schema diff 仅包含新增 enum、字段、索引、外键和打印 outbox/cloud execution 结构。
- 未发现 DROP、TRUNCATE 或业务数据 UPDATE。
- 相关生产表数据量较小，满足发布窗口要求。

已执行并成功应用：

1. 20260728090000_add_yilian_cloud_channel
2. 20260728100000_add_table_session_settled_printing
3. 20260728110000_add_cloud_print_execution_state

部署后：

- Migration：22。
- prisma migrate status：Database schema is up to date。
- rollback/failure/log：无。
- Migration 未回滚；结构为 additive，API 回滚方案保留 forward-compatible 旧产物与数据库备份。

## 6. API 原子发布

旧 API artifact：

/opt/huayue-cashier-api-releases/20260725-164908-6ef3c1e/apps/api/dist

新 API release：

/opt/huayue-api-releases/20260728-223912-printing-center-v1-8716194

最终 canonical dist：

/opt/HuayueLife-MVP/apps/api/dist
→ /opt/huayue-api-releases/20260728-223912-printing-center-v1-8716194/apps/api/dist

新 release 仅包含 apps/api 与独立运行依赖，不包含 Cashier、Miniapp 或 Merchant Admin 源码目录。生产 .env 未复制进 release，运行时继续从 canonical API cwd 读取。

API Gate：

- local health：HTTP 200。
- public health：https://api.huayueyouxuan.com/api/v1/health，HTTP 200。
- 登录接口负向契约：不存在账号返回 HTTP 401 / Invalid credentials，PASS。
- 生产 owner 既有登录会话：PASS。
- 打印 feature-state、settings、printers、rules、templates、jobs：通过生产 owner UI 实际加载。
- 未认证打印接口统一 HTTP 401：PASS。
- TableSession checkout 与 rounding：自动测试及生产只读计算 PASS。
- 未创建真实生产订单或执行真实结账。

## 7. PM2 canonical 收口

最终：

- process：huayue-api
- status：online
- cwd：/opt/HuayueLife-MVP/apps/api
- exec：/opt/HuayueLife-MVP/apps/api/dist/src/main.js
- /proc/<pid>/cwd：/opt/HuayueLife-MVP/apps/api
- /proc/<pid>/cmdline：canonical main.js
- PM2 dump cwd：/opt/HuayueLife-MVP/apps/api
- PM2 dump exec：/opt/HuayueLife-MVP/apps/api/dist/src/main.js
- pm2 save：PASS
- runtime preflight：PASS

因此 API 不再从 Cashier release 目录执行。

## 8. Cloud Worker、飞鹅与易联云

最终运行状态：

- CLOUD_PRINT_WORKER_ENABLED：false/未开启。
- 飞鹅 enabled：false。
- 飞鹅 configured：false。
- 易联云 enabled：false。
- 易联云 configured：false。
- Cloud print jobs：0。
- FEIE/YILIAN cloud attempts：0。
- 未写入、输出或生成厂商密钥。
- 未调用真实厂商提交接口。
- 真实云设备出纸：NOT EXECUTED。

Merchant Admin 保留飞鹅、易联云配置入口；生产无凭据时不得显示测试成功，服务状态为“尚未配置”。

## 9. LAN 生产状态

- VITE_LAN_PRINTING_ENABLED=false。
- 新增打印机第一步明确显示“兼容设备测试中”。
- 新建 LAN 打印机默认 disabled。
- 历史 LAN 不可重新启用。
- LAN 不进入自动打印可选打印机。
- LAN 测试按钮不伪造成功。
- LAN executor 未部署。
- 生产结论：暂未正式开放 / 兼容设备测试中。

## 10. 菜品图片保护

保护集定义：

- merchantId=4
- productId <= 334
- imageUrl 非空

部署前：

- 保护 URL：97。
- 文件存在：97/97。
- HTTP 200：97/97。
- productId 71：HTTP 200。
- productId 331/332/333/334：imageUrl 为空。
- 当前全部非空图片：100/100 文件存在，100/100 HTTP 200。

API 切换后及最终联合 Gate：

- 保护 URL：97。
- 文件存在：97/97。
- HTTP 200：97/97。
- productId 71：HTTP 200。
- productId 331/332/333/334：imageUrl 为空。
- 当前全部非空图片：100/100 文件存在，100/100 HTTP 200。
- failures：0。
- uploads 330 个文件逐文件 SHA-256 与切换前一致。

浏览器侧：

- Merchant Admin 菜品页正常加载，已加载图片无失败，未进入视口的图片保持 lazy pending。
- Cashier 点菜面板显示 101 个商品，DOM 中保留对应 uploads URL。
- Miniapp 公共菜单 API：OK，12 个分类、101 个商品、100 个 imageUrl。

## 11. Merchant Admin 原子发布

新 release：

/var/www/huayue-admin-releases/20260728-225013-printing-center-v1-8716194

current：

/var/www/huayue-admin-current
→ /var/www/huayue-admin-releases/20260728-225013-printing-center-v1-8716194

canonical：

/opt/HuayueLife-MVP/apps/merchant-admin/dist
→ /var/www/huayue-admin-releases/20260728-225013-printing-center-v1-8716194

Nginx：

- admin root 固定到 /var/www/huayue-admin-current。
- nginx -t：PASS。
- Nginx active：PASS。
- 新旧 worker 切换后 origin/public index 均为新 release 哈希。

生产 owner 浏览器验收：

- 登录：PASS。
- 平台打印权限门控：打印服务已开通。
- 打印机：PASS。
- 自动打印：PASS；堂食、自取、配送、结账小票均能选择已启用打印机。
- 小票设置：PASS；商家信息、订单信息、商品与金额、小票底部分组及中越双语预览正常。
- 打印记录：PASS；真实状态、失败原因、安全重试/补打文案正常。
- 帮助与诊断：PASS。
- 新增打印机：USB、LAN、Cloud 入口正常；飞鹅与易联云选项存在。
- 下载入口：页面右上角唯一入口正常。
- 中文页面：浏览器验证 PASS。
- 英文、越南语：构建期 i18n 测试 PASS；未修改生产 owner 的浏览器语言偏好。

## 12. RC6 APK 与下载页

本地候选产物：

/Users/peter/Desktop/云桥Life-发布与交付/01-Android-APK/03-发布候选/merchant-terminal-v1.0.0-rc6/YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk

生产路径：

/var/www/huayue-merchant-downloads/android/rc6/YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk

下载 URL：

https://admin.huayueyouxuan.com/downloads/apk/YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk

验证：

- 文件大小：2,051,509 bytes。
- SHA-256：8970fb3ef649fe0795f6313febf10a2355cfa56807011f524c11bb2691c8cb26。
- HTTP：200。
- Content-Length：2,051,509。
- MIME：application/vnd.android.package-archive。
- X-Yunqiao-Release：1.0.0-rc6-device-review-pending。
- 完整 HTTP 下载后二次 SHA-256：一致。
- RC4/RC5 下载：仍为 HTTP 200，未覆盖。

下载页显示：

- 1.0.0-rc6。
- versionCode 13。
- Release Candidate。
- 尚待 D2/D10 现场安装验证。
- 正确文件名、大小和 SHA-256。

路由：

- /printing-center/android-terminal：PASS。
- /settings/android-terminal：兼容重定向至 canonical 页面，PASS。

## 13. Cashier 与 Miniapp 烟雾测试

Cashier：

- 未重新构建、未发布。
- current release 仍为 /var/www/huayue-cashier-releases/20260728-rc5-ios-standalone-header-f6a81d8。
- index.html 当前 SHA-256 与部署前备份一致：e847da2229c291c782a681400ff5ee5b255aff2e3ee47bc1bcea5c694658eb76。
- HTTP 页面打开：PASS。
- 既有登录会话：PASS。
- 桌台总览：PASS。
- A06 结账页面：PASS；只读检查，未点击抹零或结账。
- 点菜面板：101 个商品正常；未增加数量、未提交订单。
- 菜品图片 URL 与 API 100/100 HTTP Gate：PASS。

Miniapp：

- 未重新构建、未发布。
- 公共菜单 API /api/v1/merchants/4/menu：HTTP 200 / code OK。
- 12 个分类、101 个商品、100 个图片 URL。
- 图片文件与 HTTP Gate：100/100 PASS。

## 14. 安全回滚事件

本次发生过自动安全回滚，但最终发布已成功稳定：

### API

两次预切换验证脚本问题触发自动回滚：

1. PM2 JSON 审计命令 stdin 管道冲突产生 EPIPE。
2. 图片只读审计脚本误假设 dotenv 为 API 直接依赖。

每次均原子切回旧 API dist、恢复健康检查后才继续。问题均属于部署审计脚本，不是 API build、Migration、health、图片或业务代码失败。修正审计方式后最终 API Gate 全部通过。

### Merchant Admin / APK

四次静态发布验证脚本问题触发自动回滚：

1. symlink 切换后旧 Nginx worker 首次返回旧 index。
2. origin 首请求命中正在退出的旧 worker。
3. Content-Length 正则未正确处理 CRLF。
4. HTTP/2 状态行尾空格导致过严锚定失败。

每次均恢复 RC4 Admin 指针和旧 Nginx 配置并完成 nginx -t/reload。RC6 文件未覆盖任何旧版本。改为稳定轮询及标准化响应头后，最终 Admin/APK Gate 全部通过。

未发生：

- 数据库备份失败。
- Migration 失败或回滚。
- uploads 恢复或覆盖。
- 图片 404。
- Cashier/Miniapp 回滚。
- 业务数据回滚。

## 15. 回滚资料与方案

API：

- 旧 dist：/opt/huayue-cashier-api-releases/20260725-164908-6ef3c1e/apps/api/dist
- 回滚 symlink：/opt/HuayueLife-MVP/apps/api/dist-rollback-printing-center-v1-20260728-223912-8716194
- 切回旧 target 后继续使用 canonical PM2 cwd/exec，并重新验证 health、PM2 dump 与 97/97 图片。
- Migration 为 additive；不得盲目 down migration。优先 forward-fix，灾难场景使用数据库备份恢复。

Merchant Admin：

- 旧 release：/var/www/huayue-admin-releases/20260727-rc4-android
- 回滚 symlink：/opt/HuayueLife-MVP/apps/merchant-admin/dist-rollback-printing-center-v1-20260728-225013-8716194
- 将 /var/www/huayue-admin-current 与 canonical dist 切回旧 release，并恢复已备份 Nginx 配置。

APK：

- 恢复旧下载 snippet 或旧 Admin 页面配置。
- 保留 RC6 文件，不覆盖 RC4/RC5。

uploads：

- 仅在确认文件实际损坏时恢复 uploads.tar.gz。
- 恢复后必须重新执行保护集 97/97 与全部当前图片 HTTP Gate。

## 16. 生产 Git 状态保护

生产源码 HEAD 未改变：a8630760e10df7366d436ccd1a2725f9f4f2acb1。

最终未跟踪项仅为：

- apps/api/dist
- apps/api/dist-rollback-20260725-164908-a863076/
- apps/api/dist-rollback-printing-center-v1-20260728-223912-8716194
- apps/merchant-admin/dist
- apps/merchant-admin/dist-rollback-printing-center-v1-20260728-225013-8716194

其中前 3 个历史项中的 dist、旧 rollback 和 merchant-admin dist 已在部署前记录；本次新增两个明确 rollback symlink。无意外业务源码改动，未清理任何历史文件。

## 17. 最终生产 Gate

- 备份：PASS。
- Migration：PASS。
- API build/test：PASS。
- API health：PASS。
- PM2 canonical cwd/exec/dump：PASS。
- Cloud Worker disabled：PASS。
- 飞鹅/易联云未配置：PASS。
- 保护图片 97/97：PASS。
- 当前全部图片 100/100：PASS。
- Merchant Admin：PASS。
- RC6 下载页：PASS。
- RC6 HTTP/大小/SHA：PASS。
- LAN 默认不可执行：PASS。
- Cashier 未发布且烟雾测试：PASS。
- Miniapp 未发布且公共菜单烟雾测试：PASS。
- Nginx：PASS。
- 最终生产 Gate：PASS。

## 18. 仍需设备与联合验收

以下项目明确保持待验收：

- D2 覆盖安装、启动、登录、WebView 与 USB 检测。
- D10 覆盖安装、启动、登录、WebView 与 USB 检测。
- USB 测试小票、真实订单小票、拔插恢复、App 重启恢复。
- 真实堂食结账小票出纸及 513,000 / 3,000 / 510,000 现场核对。
- 飞鹅真实设备配置、提交、状态查询、UNKNOWN 与防重复出纸。
- 易联云真实设备配置、提交、状态查询、UNKNOWN 与防重复出纸。
- LAN executor 完成后的兼容设备测试。

本次不将 RC6 标记为稳定版；下载页继续显示 Release Candidate 与设备验证待完成。

## 19. 禁止项确认

- 未 Merge main。
- 未 Tag。
- 未安装 D2/D10。
- 未重新发布 Cashier。
- 未重新发布 Miniapp。
- 未启用 Cloud Worker。
- 未执行真实云打印。
- 未 Force Push。
- 未清理生产 Git 脏状态。
