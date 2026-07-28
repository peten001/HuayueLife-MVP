# 云桥 Life 打印中心 V1 RC3 Android D10 验收报告

生成日期：2026-07-28（Asia/Ho_Chi_Minh）

结论：signed RC APK 构建与自动化 Gate 通过；D10 未连接，真实设备项目未执行；`ANDROID RC GATE = READY_FOR_FIELD_VALIDATION`。

## 1. RC2 基线

- Worktree：`/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc5-forward-rc2`
- Branch：`release/printing-center-v1-rc5-forward-rc2`
- HEAD：`72f26a1dc9ca2ec992038db0f1cb799c37125f69`
- RC2 在创建 RC3 前为 clean，本轮未修改 RC2 worktree。

## 2. RC3 worktree 与分支

- Worktree：`/Users/peter/Desktop/HuayueLife-MVP-printing-center-v1-rc5-forward-rc3-android`
- Branch：`release/printing-center-v1-rc5-forward-rc3-android`
- 创建基线：精确 RC2 HEAD `72f26a1dc9ca2ec992038db0f1cb799c37125f69`

## 3. 包名

- Release applicationId：`com.yunqiao.life.merchantterminal`
- Launcher：`com.yunqiao.life.merchantterminal.MainActivity`
- Debug 包名保持既有 `.debug` 后缀，本轮未构建 Debug APK 作为候选。

## 4. 旧版本

- RC2 Android source：`1.0.0-rc5 / versionCode 12`
- 既有 signed RC5 APK：`1.0.0-rc5 / versionCode 12`
- 当前线上下载页：`1.0.0-rc4 / versionCode 11`，线上 APK HTTP 200，SHA-256 为 `8f213899bea5887e07e63a0a4d9a697b4fd8c48a489f8620a6afe2ba83a6f2c4`。
- D10 当前安装版本：未确认；设备未连接。

## 5. 新版本

- versionName：`1.0.0-rc6`
- versionCode：`13`

## 6. 版本选择依据

- 当前 source 与 signed RC5 均使用 versionCode 12。
- Git 历史、Tag、全部交付 APK 元数据和目标 RC6 目录中未发现 versionCode 大于 12 或既有 RC6。
- 线上下载页仍为 RC4，不存在更高线上版本。
- D10 未连接，因此设备版本只能标记未确认，不能据此声称现场已升级。
- 按连续未使用规则选择 `rc6 / 13`，未猜测或跳号。

## 7. 签名证书

- Signing Gate：PASS。
- 正式 JKS 位于 Git 外，文件权限为当前用户读写；密码只从本机 Keychain 临时注入。
- JKS、signed RC5 与新 RC6 的证书 SHA-256 一致：`50:84:18:F9:F5:0B:82:8A:FB:15:C6:1A:87:55:EB:44:04:3A:A7:61:1D:57:4B:85:27:D5:B5:6B:B1:7A:F4:E7`。
- RC6 `apksigner verify`：PASS；单一 signer，APK Signature Scheme v2 为 true。
- 未输出、提交或写入 store password、key password、私钥或 keystore 内容。

## 8. APK 路径

`/Users/peter/Desktop/云桥Life-发布与交付/01-Android-APK/03-发布候选/merchant-terminal-v1.0.0-rc6/YunQiao-Merchant-Terminal-v1.0.0-rc6-signed.apk`

APK 位于 Git 外，未覆盖 RC5，未复制到正式下载目录。

## 9. APK SHA-256

`8970fb3ef649fe0795f6313febf10a2355cfa56807011f524c11bb2691c8cb26`

同目录 `.sha256` 文件执行 `shasum -a 256 -c`：PASS。

## 10. APK 大小

`2,051,509 bytes`

## 11. APK 二进制属性

- package：`com.yunqiao.life.merchantterminal`
- versionName / versionCode：`1.0.0-rc6 / 13`
- minSdk / targetSdk / compileSdk：`26 / 35 / 35`
- debuggable：`false`
- `usesCleartextTraffic=false`
- zipalign：PASS
- Build Revision：`6e4a770e44e8c41dbca2a0fe87131d5111629935`
- WebView URL：沿用 `https://cashier.huayueyouxuan.com/`
- Connector API：沿用 `https://api.huayueyouxuan.com/api/v1`
- APK 字符串扫描未发现飞鹅/易联云密钥变量、GitHub Token、私钥或测试 API Key。

## 12. 自动测试

- Java：Temurin 17.0.19。
- Gradle Wrapper：8.9。
- Android SDK / Build Tools：35 / 35.0.0。
- `:app:testDebugUnitTest`：PASS，109 tests、0 failures、0 errors、1 skipped。
- `:app:testReleaseUnitTest`：PASS，109 tests、0 failures、0 errors、0 skipped。
- Receipt renderer、USB Connector、状态上报、权限、恢复、会话与发布契约均包含在全量 JVM 回归中。
- `:app:lint`：PASS，0 errors、21 warnings；未使用 `--continue`。
- signed `:app:assembleRelease`：PASS。
- `apksigner`、`aapt`、`apkanalyzer`、zipalign、SHA-256、权限与敏感字符串审计：PASS。
- 首次构建在 APK 产出前因 Build Revision 完整值复核被主动中断；随后使用精确 Git HEAD clean 重建，只有后者进入交付目录。

## 13. D10 连接状态

- `adb devices -l` 两次均无设备。
- `D10 DEVICE GATE = NOT CONNECTED`。
- 未尝试使用历史无线调试地址或假设端口 5555。

## 14. D10 安装前版本与签名

- versionName / versionCode：NOT EXECUTED / 未读取。
- 当前 APK path：NOT EXECUTED / 未读取。
- 当前 UID 与签名：NOT EXECUTED / 未读取。
- 当前 base APK pull：NOT EXECUTED。
- 当前登录、商家与 USB Binding：NOT EXECUTED / 未读取。

## 15. 覆盖安装与数据保留

- `adb install -r`：NOT EXECUTED。
- 是否覆盖安装成功：NOT EXECUTED。
- 登录态、商家绑定和 App 数据是否保留：NOT EXECUTED。
- 未执行卸载、`pm clear`、`-d` 降级或恢复出厂。

## 16. App、登录、WebView 与打印中心

- App 启动：NOT EXECUTED。
- Crash / ANR / 蓝屏 / 白屏：NOT EXECUTED。
- 登录态：NOT EXECUTED。
- WebView 收银台：NOT EXECUTED。
- 打印中心：NOT EXECUTED。
- 截图、window dump、设备 logcat：未采集，因为没有连接设备。

## 17. USB 检测与状态

- 目标打印机 VID/PID、Interface、Endpoint：NOT EXECUTED。
- 云桥 App UID 的 USB Permission：NOT EXECUTED。
- `openDevice` / `claimInterface` / `bulkTransfer`：NOT EXECUTED。
- “已连接”或“在线”未被伪造。

## 18. 测试小票

- 中越双语测试小票：NOT EXECUTED。
- 中文、越南语重音、打印机名称、方式、时间、切纸和真实出纸：均 NOT EXECUTED。
- 自动化成功不作为真实纸张输出证明。

## 19. 拔插恢复

NOT EXECUTED。未拔插 USB，未请求授权，未产生测试 PrintAttempt。

## 20. App 重启恢复

NOT EXECUTED。未强制停止或重启 D10 App，未读取现场登录态和 USB Binding。

## 21. 用户手工验证清单

交付文件：`RC6_D10_FIELD_VALIDATION_CHECKLIST.md`。

用户需在受控现场手工完成：

- 覆盖安装、登录态与 USB Binding 保留；
- App 启动、WebView、打印中心；
- USB 识别、App UID 权限、接口和 Endpoint；
- 中越双语测试小票；
- USB 拔插恢复与 App 重启恢复；
- 堂食顾客小票、厨房单、自取单、配送单和手动补打；
- 整桌结账小票：513,000 VND 原金额、3,000 VND 抹零、510,000 VND 实收；
- 打印开关关闭不打印、开启后只处理新触发任务。

Codex 不创建生产订单，不点击生产结账，只可在用户手工触发时观察脱敏日志和状态。

## 22. 回滚

- 是否执行回滚：否；RC6 未安装。
- 已生成 `RC6_ROLLBACK_AND_PREINSTALL.md`。
- 现有 signed RC5 为 versionCode 12，低于 RC6 的 13，安装 RC6 后不能用普通 `adb install -r` 直接降级，也不得使用禁止的 `-d`。
- 现场安装前必须另行准备同证书、versionCode 大于 13 的稳定回滚 APK，或先完成受控回滚构建窗口。本阶段未擅自消耗新 versionCode 生成回滚包。

## 23. 正式下载页

- 未修改 `/printing-center/android-terminal` 或 `/settings/android-terminal`。
- 未修改集中 APK 配置、正式 APK 文件或 Nginx 下载目录。
- 当前线上仍展示 RC4；其 bundle 配置文件大小与 HTTP Content-Length 存在既有差异，但线上 SHA-256 与页面记录一致。本阶段只审计、不修复。
- RC3/RC6 仅保存在 Git 外发布候选目录。

## 24. Android RC Gate

`READY_FOR_FIELD_VALIDATION`

原因：源码、自动测试、正式签名、二进制和交付完整性通过；D10 未连接，覆盖安装、数据保留和真实 USB 出纸尚未执行，因此不能标记 `FIELD_VALIDATION_PASS`。

## 25. Commit 列表

- `6e4a770e44e8c41dbca2a0fe87131d5111629935` — `build(android): prepare printing center RC APK`
- `76114af28b4c1d2032706bfde1b5fc1958a3ce84` — `docs(android): add D10 printing RC validation`
- Push 结果回填 Commit 即包含本文件的最终报告同步 Commit；为避免文件自引用，其精确 Hash 以远程分支 HEAD、交付目录报告和最终回复为准。

## 26. Push 结果

- 结果：PASS。
- 目标仓库：`git@github-peter001:peten001/HuayueLife-MVP.git`
- 目标分支：`release/printing-center-v1-rc5-forward-rc3-android`
- 首次普通 Push：成功，远程已接收 `76114af28b4c1d2032706bfde1b5fc1958a3ce84`。
- 本结果回填随报告同步 Commit 使用普通 fast-forward Push 送达同一 RC3 分支；最终远程 HEAD 在 Push 后通过 `git ls-remote` 验证。
- 未修改 origin，未 Push main，未 Force Push。

## 27. LAN 边界

未开发 LAN executor，未开发 Windows 打印助手，未把 LAN 描述为本阶段可执行能力。

## 28. 未修改模块

相对 RC2：

- `apps/api`：零差异；
- `apps/merchant-admin`：零差异；
- `apps/merchant-cashier` / `apps/cashier`：零差异；
- `apps/miniapp`：零差异；
- Android `app/src/main/java`：零差异；
- Cloud Worker、飞鹅、易联云、USB Connector 核心、USB 发现/授权/拔插恢复/状态上报：均未修改。

## 29. 禁止操作确认

未创建生产订单，未执行生产结账，未连接或修改生产数据库，未执行 migration、部署、Merge、Rebase、Tag、Force Push、正式下载页更新、App 卸载或数据清理。
