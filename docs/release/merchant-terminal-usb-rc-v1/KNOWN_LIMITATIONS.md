# RC1 已知限制与现场验证项

## 到店前不能宣称通过

- 尚未在真实 Android 收银机上安装正式包。
- USB VID/PID、Printer Class、接口、BULK OUT 端点和 Android USB 权限持久性未知。
- 58/80mm 实际点宽、浓度阈值、纸张方向和切纸指令未知。
- 中、越、英位图、长单、二维码可扫性和打印速度尚未实物验证。
- USB bulk write 成功只证明 Android 完整提交字节，不能百分之百证明纸张完整输出。
- 打印成功但服务端回报丢失时，系统会优先标记结果不确定并要求人工确认，而不是盲目重打。

## 当前数据与模板边界

- 现有 `OrderItem` 没有商品规格快照字段；RC1 不能凭空打印真实规格。已有商品名称、数量、单价、小计和菜品备注可打印。
- TableSession 小票汇总关联订单商品与金额，但当前 ReceiptDocument 不汇总每笔订单的订单级备注。
- Android RC1 使用受控的 `ESCPOS_RASTER_V1` 固定版式渲染不可变 ReceiptDocument。PrintJob 会保存模板 ID/版本，但 Android 暂不解释自定义 ReceiptTemplate section/languageMode；到店首版应使用固定版式并以实物验收为准。
- Product 当前只有中文和越南语名称字段；没有真实英文商品名时，小票商品名按中文/越南语已有数据输出，不会伪造英文翻译。英文界面下的这一回退需在门店照片中明确验收。

## 运维边界

- 正式收银台候选域名尚未解析，生产 Web/API/admin 尚未部署本 RC。
- 生产数据库备份身份、目录、容量、恢复演练和 migration 状态未知，因此生产 migration 未执行。
- 正式签名 keystore 尚需制作至少两份加密离线备份后，才能把首次安装视为长期升级链。
- Android 12+ 对后台启动前台服务有限制；系统无法静默恢复时必须给出可见提示并由店员打开 APP。Boot、USB 插入、网络恢复、进程回收都必须现场逐项验证。
- 关闭商家/Printer/Terminal/autoPrint 会阻止后续执行，但无法撤回已经发送到 USB 硬件的字节。

以上限制是 RC 的真实 Gate，不是阶段 2 功能清单。任何一项实测失败都按 [ROLLBACK.md](ROLLBACK.md) 关闭打印，Web 订单业务继续使用。
