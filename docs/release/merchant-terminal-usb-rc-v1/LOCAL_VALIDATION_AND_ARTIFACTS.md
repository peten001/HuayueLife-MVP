# Merchant Terminal USB RC1 本地验证与制品索引

> 更新于 2026-07-15。本文只记录本地构建事实。所有制品均为候选包，状态仍是
> `NOT DEPLOYED / NOT INSTALLED / REAL USB NOT TESTED`。

## 1. 来源与边界

- 分支：`feature/merchant-terminal-usb-rc-v1`
- RC 代码与 APK Build Revision：`0f7abfeb97d2b25097272448f710f88c93be1f9a`
- rollback 源码基线：`9c7b947efda814da857ccb81067f4e79457b89a9`
- 外部交付目录：`$HOME/Desktop/yunqiao-merchant-terminal-rc-v1/`（不进入 Git）
- 生产数据库未连接，生产备份和 migration 未执行，Web/API 未部署，Git 未 push。
- 到店前任务执行、商家、Printer、Rule、Terminal、Android connector 与自动打印开关均关闭。

候选 Web URL `https://cashier.huayueyouxuan.com/` 尚未通过 DNS、TLS 与公开健康检查，
生产 API 也尚未部署本 RC 路由。因此 Release APK 在生产 Gate 通过前不能作为营业包安装。

## 2. APK

| 文件 | 大小（bytes） | package | versionCode / versionName | SHA-256 |
|---|---:|---|---|---|
| `apk/yunqiao-merchant-terminal-v1.0.0-rc1-release.apk` | 2,036,643 | `com.yunqiao.life.merchantterminal` | `4` / `1.0.0-rc1` | `dfc30ad8124405e91fb74cecee17fdfad6874a45b2af36a7a7a992fdf295561d` |
| `apk/yunqiao-merchant-terminal-v1.0.0-rc1-diagnostic-debug.apk` | 7,998,205 | `com.yunqiao.life.merchantterminal.debug` | `4` / `1.0.0-rc1-debug` | `27ae4aaaded6c0d0e4464ef78e1ebff9fc9f2bf0fe10bfef3620b27f878a46d9` |
| `apk/yunqiao-merchant-terminal-v1.0.0-rc1-rollback-release.apk` | 1,808,825 | `com.yunqiao.life.merchantterminal` | `5` / `1.0.0-rc1-rollback` | `f6b70287c5953542a6605757380e03f71faf48d465810cfa755d9625cbf26b6b` |

Release 与 rollback 使用同一 RSA-4096 正式证书，并通过 APK Signature Scheme v2 验证。
证书 SHA-256：

```text
50:84:18:F9:F5:0B:82:8A:FB:15:C6:1A:87:55:EB:44:04:3A:A7:61:1D:57:4B:85:27:D5:B5:6B:B1:7A:F4:E7
```

正式 keystore 位于 Git 外且密码只保存在本机 Keychain；在完成至少两份加密离线备份和
可读性校验前，首次门店安装 Gate 仍为 `BLOCKED`。rollback 的 versionCode 为 `5`，后续
正式升级包必须使用大于 `5` 的 versionCode。

RC 合并权限为：`INTERNET`、`ACCESS_NETWORK_STATE`、`CHANGE_NETWORK_STATE`、
`POST_NOTIFICATIONS`、`RECEIVE_BOOT_COMPLETED`、`FOREGROUND_SERVICE`、
`FOREGROUND_SERVICE_CONNECTED_DEVICE`、`WAKE_LOCK`，以及 AndroidX 动态接收器签名权限。
没有存储、相机、定位、蓝牙、悬浮窗、无障碍或安装应用权限。

内置候选配置：

```text
CASHIER_WEB_URL=https://cashier.huayueyouxuan.com/
TRUSTED_PAGE_ORIGIN=https://cashier.huayueyouxuan.com
TRUSTED_RESOURCE_HOSTS=api.huayueyouxuan.com
CONNECTOR_API_BASE_URL=https://api.huayueyouxuan.com/api/v1
```

Release 使用 `usesCleartextTraffic=false`，没有 JavaScript Bridge 或 LAN/TCP 9100 执行路径；
rollback 不包含终端 claim 能力。诊断包使用 Android debug 证书且允许 WebView 调试，只能
受控现场使用，验证结束后必须卸载。

## 3. Web、API、migration 与文档包

| 文件 | 大小（bytes） | SHA-256 |
|---|---:|---|
| `web/yunqiao-merchant-cashier-v0.1.0-rc1-dist.tar.gz` | 111,259 | `bde4db63a451d985c733ccf0981df8db7894743a51f694eebdf95bfe0996fbab` |
| `web/yunqiao-merchant-admin-v1.0.0-printing-rc1-dist.tar.gz` | 2,571,158 | `f081bdc1f6ef4d9ad847825126faaa2d36451367e09332b3598b08c7c8b26581` |
| `api/yunqiao-api-printing-rc1-deployment.tar.gz` | 303,083 | `78ac067c856c036aa3b82bbfe1f8f48d8987ba60366cf320c2bdd1c6db80997d` |
| `api/20260715120000_add_terminal_connector_rc_v1.sql` | 5,223 | `5f793a646b82fd64da68be7cac682a43081913c7ef209007c15471e36ad47b23` |

文档包在本文件进入最终文档提交后重新生成，其最终大小与 SHA-256 以外部
`RELEASE_MANIFEST.md` 和 `SHA256SUMS` 为准，避免压缩包记录自身校验值造成循环依赖。

API 包只包含运行所需编译 JavaScript、Prisma schema/migrations、依赖锁文件和安全配置模板；
已排除 seed/demo 数据写入脚本、source map、类型声明、构建缓存和本机绝对路径信息。

## 4. 本地验证结果

| 范围 | 结果 | 证据摘要 |
|---|---|---|
| API | PASS | Prisma validate、typecheck、28 suites / 269 tests、build |
| merchant-admin | PASS | typecheck、生产 build；既有大 chunk warning 不阻断 |
| merchant-cashier | PASS | typecheck、lint、16 files / 81 tests、七种 viewport 三语言 UI、Fixture=false build |
| Android | PASS | clean、67 tests、lint 0 error / 22 warning、完整 build |
| APK | PASS | `aapt` badging/permissions、`apksigner --verbose --print-certs`、SHA-256 |
| 隔离 migration | PASS | MySQL 8.4 空库执行 16 个 migration、二次 deploy、约束检查与容器清理 |

这些结果证明代码、构建和隔离 migration 候选可复核，不代表生产部署或真实 USB 出纸通过。
真实打印机 VID/PID、USB 接口/端点、纸宽、中文/越南语、QR、切纸、缺纸、拔插、设备重启
和 OEM 行为必须在门店逐项人工确认。

## 5. 校验方法

在外部交付目录执行：

```bash
shasum -a 256 -c SHA256SUMS
```

安装前还需将 Release APK 的 `apksigner --print-certs` 结果与本文证书 SHA-256 人工比对。
完整生产 Gate、备份/migration、部署、一次到店顺序与回滚步骤见同目录其他文档。
