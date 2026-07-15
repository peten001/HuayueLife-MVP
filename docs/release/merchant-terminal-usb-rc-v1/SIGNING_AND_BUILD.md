# Android RC 签名与构建

## 发布证书

正式 keystore 位于 Git 仓库外，权限为当前用户只读写：

```text
$HOME/.yunqiao/signing/merchant-terminal-release.jks
alias: yunqiao-merchant-terminal-release
certificate SHA-256:
50:84:18:F9:F5:0B:82:8A:FB:15:C6:1A:87:55:EB:44:04:3A:A7:61:1D:57:4B:85:27:D5:B5:6B:B1:7A:F4:E7
```

随机 Store/Key 密码只保存于当前 Mac 登录钥匙串。服务名和备份说明见仓库外 `$HOME/.yunqiao/signing/README.md`；本文不包含密码。

生产发布前必须把 keystore 制作至少两份加密离线备份。丢失证书将导致正式包无法正常覆盖升级。

## Release 构建输入

以下配置可用于生成待发布候选包；候选地址来自 RC 指令，但截至审计尚未部署。在 DNS/TLS 和 HTTPS 健康检查通过前，APK 只能作为部署包保存，不得安装上线或描述为可用生产包：

```bash
export YUNQIAO_RELEASE_STORE_FILE="$HOME/.yunqiao/signing/merchant-terminal-release.jks"
export YUNQIAO_RELEASE_KEY_ALIAS='yunqiao-merchant-terminal-release'
export YUNQIAO_RELEASE_STORE_PASSWORD="$(security find-generic-password \
  -s 'com.yunqiao.life.merchantterminal.release.store' \
  -a 'merchant-terminal-release' -w)"
export YUNQIAO_RELEASE_KEY_PASSWORD="$(security find-generic-password \
  -s 'com.yunqiao.life.merchantterminal.release.key' \
  -a 'yunqiao-merchant-terminal-release' -w)"

export CASHIER_WEB_URL_RELEASE='https://cashier.huayueyouxuan.com/'
export TRUSTED_PAGE_ORIGIN_RELEASE='https://cashier.huayueyouxuan.com'
export TRUSTED_RESOURCE_HOSTS_RELEASE='api.huayueyouxuan.com'
export CONNECTOR_API_BASE_URL_RELEASE='https://api.huayueyouxuan.com/api/v1'

./gradlew --no-daemon :app:clean :app:assembleRelease

unset YUNQIAO_RELEASE_STORE_PASSWORD YUNQIAO_RELEASE_KEY_PASSWORD
```

`TRUSTED_RESOURCE_HOSTS_RELEASE` 的示例只包含当前代码可确认的 API/上传媒体 Host。正式签名前必须以已部署 cashier 的真实 Network 与源码再次核对图片/CDN/静态资源 Host；缺失 Host 会导致资源不可用，通配 Host 则不允许。

不要使用 shell tracing（`set -x`），不要把环境变量写入 `.env`、`local.properties` 或 Gradle 源码。

## 诊断 Debug APK

诊断包使用 Android debug 签名和 `.debug` 包名，只供受控现场诊断，不作为生产升级链。Debug 包允许 WebView 远程调试；它不能替代 Release、不能长期留在营业终端，验收结束后必须卸载：

```bash
./gradlew --no-daemon :app:assembleDebug

adb uninstall com.yunqiao.life.merchantterminal.debug
```

## 回滚 APK

回滚包必须：

- 与 Release 使用同一证书和正式包名；
- 使用高于 RC 的 versionCode，以允许普通覆盖安装；
- 代码回退到不领取 PrintJob 的稳定 WebView/USB 诊断外壳；
- 安装前先在服务端停用 Terminal、Printer、商家打印和 autoPrint。

rollback 会消耗更高的 versionCode，之后所有正式升级必须继续递增。产物清单必须记录其来源 Commit、versionCode、证书和“不 claim PrintJob”的能力边界；不得使用同 versionCode 的模糊覆盖说明。

## 校验

```bash
aapt dump badging '__APK__'
apksigner verify --verbose --print-certs '__APK__'
shasum -a 256 '__APK__'
```

同时检查 Manifest 权限、`usesCleartextTraffic=false`、精确 Origin、Build Commit、无 JavaScript 打印 Bridge、无明文 Token/密码和无旧 LAN/TCP 执行代码。
