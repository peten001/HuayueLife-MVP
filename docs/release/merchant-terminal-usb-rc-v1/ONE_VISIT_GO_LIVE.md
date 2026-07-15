# 云桥 Merchant Terminal USB RC｜一次到店上线

> 本清单标题沿用现场设备称呼；设备型号、USB VID/PID、接口、端点和纸宽一律以 Android 实际读取结果为准。不得预填 PASS，不得把“USB 接口打开”当作“已成功出纸”。

## 到店前 Gate

- [ ] Web 收银台正式 HTTPS Origin 已部署并完成登录回归。
- [ ] 生产数据库已备份、校验并恢复演练。
- [ ] 打印 migration 与 API 已部署，健康检查通过。
- [ ] 已确认现场可联系的授权运维人员，以及步骤 17/24 开启和回退两个全局 Flag 的精确生产流程；不得到店后猜服务器命令。
- [ ] `LEGACY_PRINTING_ENABLED=false`。
- [ ] `PRINTING_TASK_CENTER_ENABLED=true`、`PRINTING_EXECUTION_ENABLED=false`、`PRINTING_AUTO_CREATE_ENABLED=false`。
- [ ] 商家打印、Printer、`PrintRule.enabled/autoPrint`、Terminal 均关闭/未配对。
- [ ] Android `connectorEnabled=false`、`automaticPrintingEnabled=false`。
- [ ] Release 与诊断 APK 的 SHA-256、签名证书 SHA-256 已核对。
- [ ] rollback APK 与 [ROLLBACK.md](ROLLBACK.md) 可用。
- [ ] 准备专用测试商家、测试桌台、测试订单；不使用真实顾客隐私或线上支付。

## 记录格式

每一步都填写：

```text
实际：
结果：PASS / FAIL / NOT TESTED
错误码：
截图/照片：
回滚动作：
备注：
```

## 1–6 安装、Web 与配对

### 1. 安装 Release APK

预期：签名、包名和版本正确；可覆盖同签名旧版本；APP 可启动。

### 2. 打开 Web 收银台

预期：加载精确 HTTPS Origin，无 SSL 绕过、白屏或任意外链顶层跳转。

### 3. 登录测试商家

预期：正常登录并保持会话；桌台和订单数据可读取。

### 4. 在打印中心创建未配对终端

预期：终端状态为 `UNPAIRED`/未在线；不自动启用打印。

### 5. 生成一次性绑定码

预期：显示一次 8 位码和明确过期时间；不出现在日志；过期/重复使用失败。

### 6. APP 绑定终端

预期：APP 输入码后获得独立 Terminal 凭据并保存到 Android Keystore；不复用网页登录 Token；后台显示真实设备/APP 版本。

失败回滚：撤销终端，保留 Web 收银业务，停止后续打印步骤。

## 7–16 USB 识别与合成测试

### 7. 插入现有 USB 打印机

预期：无需写死型号或 VID/PID 即可显示真实设备。

### 8. 授权 USB

预期：仅在人工点击后出现系统授权；拒绝时不崩溃、不循环弹窗。

### 9. 核对设备、接口和端点

预期：记录真实 VID/PID、interface index/id/alternate setting、BULK OUT 地址和 max packet size。

### 10. 选择纸宽

预期：先依据实物选择 58mm 或 80mm，可调整 384/576 或实际点宽。

### 11. 保持“不切纸”

预期：默认不发送切纸；任何时候都不发送开钱箱命令。

### 12. 测试连接

预期：只打开 USB 连接、执行 `UsbDeviceConnection.claimInterface` 后关闭；这是本地诊断，不领取服务器 PrintJob。界面明确提示仍需测试小票确认。

### 13. ASCII 测试

预期：人工点击一次只出一张，数字和英文清晰，无重复。

### 14. 中越英图片测试

预期：中文、越南语重音和英文通过 Bitmap Raster 完整打印。

### 15. 二维码测试

预期：`YUNQIAO-USB-TEST` 可扫描，图像不裁切。

### 16. 调整并保存 USB 配置

预期：阈值、点宽、纸宽、切纸和接口端点保存到本机；后台只显示脱敏摘要。

失败回滚：保持 Printer/商家打印/自动打印关闭，导出脱敏诊断后停止。

## 17–20 任务中心与人工打印

### 17. 启用目标 Printer

预期：只启用现场确认的 `LOCAL_USB_ESCPOS` Printer，其他商家不受影响。授权运维同时确认全局 `PRINTING_EXECUTION_ENABLED=true`、`LEGACY_PRINTING_ENABLED=false`；若全局执行仍为 false，停止并由已确认的生产流程安全变更，不能在门店猜测服务器命令。

### 18. 开启商家打印总开关并创建合成测试任务

预期：开启商家打印总开关、启用 Terminal，并在 Android 人工开启本地 `connectorEnabled`；`automaticPrintingEnabled` 与所有自动规则仍保持关闭。随后创建不含顾客数据的合成任务；APP 领取、打印并回报 Attempt，网页不能回报成功。

### 19. 手动打印专用测试订单

预期：Web 点击后服务器生成不可变 `ORDER_CUSTOMER` 快照和 PrintJob；APP 只渲染快照；任务最终 `SUCCEEDED`。

### 20. 人工补打

预期：必须填写原因，创建新的 `MANUAL_REPRINT` 任务并记录操作者，不复用原自动幂等键。

失败回滚：关闭商家打印、停用 Printer 和 Terminal；订单业务继续可用。

## 21–23 本地恢复

### 21. USB 拔插恢复

预期：拔出时得到明确错误；不确定是否出纸的任务标记 `UNCERTAIN`，不自动重打；重新授权/连接后新任务可打印。

### 22. APP 进程重启恢复

预期：Room 中已成功 serverJobId 不重复打印；未回报结果按安全状态恢复。

### 23. 收银机重启恢复

预期：绑定有效、本地 Connector 已开启、`automaticPrintingEnabled` 仍关闭且 USB 授权仍有效时，系统广播可恢复 `connectedDevice` 前台服务，并只恢复手动/测试任务执行与待回报状态；未绑定/已停用时不执行。WorkManager 只补报/健康检查，不在后台执行 USB。Android 13 通知权限和收银机厂商自启动限制都必须单独记录，不能据模拟器结果判定通过。

## 24–28 自动打印和网络恢复

### 24. 开启商家自动打印

预期：仅启用已核对的订单类型、触发状态、打印机和模板对应的 `PrintRule.enabled/autoPrint`，再开启 Android 本地自动领取；最后由授权运维确认 `PRINTING_AUTO_CREATE_ENABLED=true`。旧直打始终为 false，任何一步失败立即把规则和本地自动领取关闭。

### 25. 创建一笔专用测试订单并自动打印

预期：指定事件只生成一组幂等任务；每份有独立 copy index。

### 26. 网络断开和恢复

预期：任务保留在数据库；回报失败由 WorkManager 补偿；打印结果未知时不自动重打。

### 27. 确认无重复

预期：同一事件、规则版本、打印机和 copy index 只有一个自动任务；Room、服务端 Attempt 与实物一致，不因断网、APP/设备重启重复出纸。

### 28. 正式启用

预期：数据库 PrintJob、PrintAttempt、Room 记录和实物小票一致；确认没有双路径、重复或客户隐私日志后，才保持目标商家、Printer、Terminal、Rule 和自动打印开关开启。

## 现场收尾

- 卸载 `com.yunqiao.life.merchantterminal.debug` 诊断包；该包允许 WebView 远程调试，不能长期留在营业终端。
- 只保留正式签名 Release APK；再次核对版本、证书 SHA-256 和最终开关状态。
- 后台 USB `CONNECTED` 只表示设备可见、权限和本地配置匹配，不代表有纸、开盖正常或真实出纸成功。

## 远程安全验证

- 停用 Terminal 后凭据仍可用于 `heartbeat/config` 远程诊断；领取、开始和结果回报必须返回 `409 TERMINAL_DISABLED`，服务停止执行。只有撤销或凭据失效才返回 401。
- 撤销凭据后旧 Token 永久失效。
- 关闭商家打印总开关后不能创建/领取新任务。
- 停用 Printer 后不能创建目标任务。
- 关闭 autoPrint 后手动任务仍按权限和总开关控制。
- 远程重置 USB 配置只清除本地设备选择，不执行打印。

## 最终签字

```text
门店：
实测 Android 厂商/型号：
Android 版本：
APP 版本 / Git Commit：
USB VID/PID：
接口/端点：
纸宽/点宽/阈值/切纸：
测试订单号（不得含客户隐私）：
上线人：
日期时间（Asia/Ho_Chi_Minh）：
最终结果：PASS / FAIL
```
