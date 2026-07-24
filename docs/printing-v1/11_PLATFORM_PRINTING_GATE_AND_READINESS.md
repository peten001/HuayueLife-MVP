# 云桥 Life 打印平台 Gate 与设备 READY 规则（正式 V1）

校正日期：2026-07-24

适用范围：统一打印任务中心 V1、电脑/手机商家后台、Web 收银台和 Android USB 本地连接器

当前正式通道：`LOCAL_USB_ESCPOS`

本文固定 V1 正式产品边界：打印总能力只能由平台控制；打印机与自动打印规则由商家 OWNER/MANAGER 配置；Android 收银终端只读并自动恢复；设备 READY 只能由明确、当前且完整的正向证据产生。本文描述本地工作区代码事实，不代表本轮改动已经部署或 Android APK 已经发布。

## 1. 唯一权威总开关

唯一权威字段是：

```text
Merchant.printingEnabled
```

既有平台 capability key `printerEnabled` 仅是平台后台商家能力编辑界面的输入表示，不是第二个运行时真相来源：

```text
平台管理员修改既有 printerEnabled capability
→ apps/api 现有 updateCapabilities 流程
→ 同一数据库事务单向同步 Merchant.printingEnabled
→ 平台列表和详情以 Merchant.printingEnabled 回显
```

证据：

- `apps/api/src/modules/platform/platform-merchants.service.ts`
- `apps/api/src/modules/platform/platform-merchants.service.spec.ts`
- `apps/merchant-admin/src/pages/PlatformMerchantDetailPage.vue`

历史 `MerchantCapability` 行即使与权威字段发生漂移，也不能覆盖 `Merchant.printingEnabled`。平台关闭后不会删除 `Printer`、`PrintRule`、`ReceiptTemplate`、`PrintJob` 或 `PrintAttempt`，重新开启后原配置和历史仍可读取。

## 2. 平台入口与商家只读边界

### 2.1 平台后台

平台继续复用现有商家能力更新接口，不新增打印专用平台 API。平台管理员可以独立于平台经营开关修改 `printerEnabled`；保存成功后重新读取服务器状态，失败时恢复服务器快照，不能靠乐观 UI 假装成功。

### 2.2 电脑与手机商家后台

电脑与手机共用 `apps/merchant-admin`，因此同一边界同时生效：

- 商家只能读取平台是否开通打印；
- 页面不再提供修改平台总能力的开关；
- 平台未开通时，打印中心及直接 URL 显示“打印功能未开通，请联系平台管理员。”；
- 平台未开通时不挂载打印机、模板、规则或任务 mutation 页面；
- 平台已开通后，`OWNER/MANAGER` 才能在现有权限范围内配置打印机、模板、规则和自动打印；
- 普通 `STAFF`/收银员不能通过页面或直接 API 修改上述配置；
- 历史和已有配置保留。

服务端不依赖前端隐藏：`PATCH /merchant/printing/settings` 即使由 `OWNER`、`MANAGER` 或手工请求提交 `printingEnabled=true`，也返回现有权限错误且不更新数据库。

证据：

- `apps/api/src/modules/printing/services/printing-settings.service.ts`
- `apps/api/src/modules/printing/services/printing-settings.service.spec.ts`
- `apps/merchant-admin/src/api/printing.ts`
- `apps/merchant-admin/src/components/printing/PrintingCenterShell.vue`
- `apps/merchant-admin/src/i18n/printing.ts`

## 3. 服务器统一 Gate

中央 Gate 为 `PrintingSettingsService.assertMerchantPrintingEnabled(merchantId)`。商家不存在、商家非 ACTIVE 或 `Merchant.printingEnabled=false` 时，统一 fail-closed：

```json
{
  "code": "PRINTING_NOT_ENABLED",
  "message": "打印功能未开通，请联系平台管理员。"
}
```

下列入口在服务器端调用该 Gate：

| 类别 | 受保护操作 |
|---|---|
| 配置 mutation | 新增、更新、停用打印机；新增、更新、复制模板；新增、更新、启用、停用规则 |
| 创建任务 | 测试任务、手动订单打印、桌账打印、人工补打、自动任务及自动触发 Outbox 处理 |
| 任务恢复 | 失败任务人工重试 |
| Connector 读取/领取 | 获取执行配置、读取活动任务、领取任务、获取已领取任务 payload |
| 执行 | 标记开始打印、延长租约、执行前打印机 READY 校验 |
| 设备状态 | Android 上报 USB/APP 可执行证据 |

安全取消待处理任务和已执行尝试的成功/失败事实回报不会被错误抹掉：取消不导致出纸；若平台恰在写入后关闭，连接器仍需回报真实结果，避免把已经发生的物理写入伪装成未执行。平台关闭后，Android 在下一次执行前 Gate 不会再写入 USB。

证据：

- `apps/api/src/modules/printing/services/printing-settings.service.ts`
- `apps/api/src/modules/printing/services/printing-printers.service.ts`
- `apps/api/src/modules/printing/services/receipt-templates.service.ts`
- `apps/api/src/modules/printing/services/print-rules.service.ts`
- `apps/api/src/modules/printing/services/print-jobs.service.ts`
- `apps/api/src/modules/printing/services/print-attempts.service.ts`

## 4. 正式状态模型

对外展示必须拆分，禁止用“已启用”表示“在线”：

| 维度 | 状态 | 权威 |
|---|---|---|
| 能力 | 已开通 / 未开通 | `Merchant.printingEnabled` |
| 配置 | 已配置 / 未配置 / 已停用 | Printer 是否存在、`enabled`、通道与配置合法性 |
| 连接 | 已连接 / 离线 / 正在重连 / 等待授权 / 未检测到设备 / 状态未知 | Android USB 实况、Printer status 和新鲜 connector evidence |

执行 READY 仍是以上状态之上的 fail-closed 正向白名单。状态查询失败、证据缺失或过期会清除旧 READY，不允许用缓存的“可以打印”继续创建或领取任务；但连接离线不得反向写成能力关闭或配置停用。

## 5. READY 正向白名单

V1 当前唯一已实现的本地通道是 `LOCAL_USB_ESCPOS`。Printer 级 READY 必须同时满足：

1. `Printer.enabled=true`；
2. 通道严格等于 `LOCAL_USB_ESCPOS`；
3. `connectionConfig` 是允许字段组成的有效对象；
4. Prisma 现有状态严格等于 `ONLINE`；
5. Android 明确上报以下五项均为 `true`：
   - `usbDeviceRecognized`；
   - `usbPermissionGranted`；
   - `usbInterfaceValid`；
   - `usbEndpointValid`；
   - `appExecutionReady`；
6. 上述证据时间戳存在，且在服务器判定时不超过 120 秒。

因此：

- `UNKNOWN` → `DEVICE_OFFLINE`；
- `UNVERIFIED` → `DEVICE_OFFLINE`；
- `OFFLINE` → `DEVICE_OFFLINE`；
- `ERROR` → `DEVICE_OFFLINE`；
- 当前 Prisma `PrintingPrinterStatus` 没有 `DISABLED` 枚举值；停用由 `enabled=false` 表达并归为 `NOT_CONFIGURED`，前端与 Android 对防御性收到的字符串 `DISABLED` 仍一律阻断；
- 未实现通道即使状态写成 `ONLINE` → `DEVICE_OFFLINE`；
- USB 配置不合法 → `NOT_CONFIGURED`；
- 五项证据任一缺失、为 false 或超过 120 秒 → `DEVICE_OFFLINE`。

120 秒仅是打印机连接与 APP 可执行状态的证据有效期，不是 Terminal Heartbeat；V1 没有恢复终端账号、Terminal Token、配对码或 Heartbeat API。

证据：

- `apps/api/src/modules/printing/utils/printer-readiness.ts`
- `apps/api/src/modules/printing/utils/printer-readiness.spec.ts`
- `apps/api/prisma/schema.prisma`

## 6. Web 收银台

`apps/merchant-cashier` 使用服务器返回的 Printer `readiness` 与平台 feature state 组合四态：

- 只有 `READY` 才启用手动打印和补打；
- 平台未开通、未配置或设备离线均不创建 PrintJob；
- `UNKNOWN`、`UNVERIFIED` 及所有非 `ONLINE` 状态不能进入 READY；
- 未实现通道不能进入 READY；
- 当前会话失效、角色不在现有 `OWNER/MANAGER/STAFF` 范围或状态刷新失败时 fail-closed；
- 自动打印除 READY 外仍需既有商家规则和 Feature Flag 开启。

中、越、英和 1280×800/手机布局使用同一逻辑。

证据：

- `apps/merchant-cashier/src/stores/printing.ts`
- `apps/merchant-cashier/src/components/printing/PrintJobActions.vue`
- `apps/merchant-cashier/src/components/shell/CashierHeader.vue`
- `apps/merchant-cashier/src/i18n/messages.ts`

## 7. Android USB 执行前 Gate

Android 继续使用 WebView 中同一商家主账号或员工账号会话。连接器不使用 Terminal Token。领取前、标记开始前及物理 USB I/O 前均 fail-closed 校验：

- 商家 JWT 存在且未因 `401/403` 失效；
- 平台 `merchantPrintingEnabled=true`；
- 任务中心与执行 Feature Flag 已开启；
- config 与 job 的 `merchantId` 等于当前本地商家作用域；
- job 属于当前 printer，状态为 `CLAIMED` 且尚未成功/取消；
- printer 已启用，通道为 `LOCAL_USB_ESCPOS`，配置有效；
- 服务端返回的 printer readiness 为 `READY`；
- 本机 USB 设备、权限、Interface、Endpoint 与保存绑定完全匹配。

任一条件失败时不发送 ESC/POS、不把任务标记成功，也不改变订单状态。平台关闭、会话失效或员工被停用时停止领取/执行；本地历史和待回报事实保留。

终端不再提供“启用本地打印连接器”或“允许自动打印任务”的收银员开关。启动、App/设备重启和 USB 重插时，连接器依据服务器能力与商家配置恢复最后成功的 USB Binding；USB 暂时离线只报告离线/重连，不清除 Printer ID、VID/PID、Device Name、纸宽、用途或自动打印规则。USB Permission Token、登录 Token、Cookie、订单正文和敏感商家数据不得写入本地打印配置。

状态遥测只报告实际 USB/APP 可执行证据、最近上报与最近成功连接，不注册终端、不建立独立设备身份。旧服务器 LAN/TCP 直打继续停用；未来通道通过 `PrinterAdapter` 扩展。

V1 的每个 Android APP 实例只保留一个当前 USB Binding；商家后台可以保留多条打印机记录，但同一实例的物理执行必须收敛到一个有效的 `LOCAL_USB_ESCPOS` Printer。多终端、多物理打印机的稳定 Terminal↔Printer 路由属于后续多打印机阶段，本轮不得宣称已经支持。标准 USB Printer Class 7 可由 attach receiver 唤醒；厂商自定义 BULK OUT 设备的重插恢复必须在 P10/D10、SUNMI D2 真机 Gate 中验证，不能用全 USB 通配符换取表面兼容。

证据：

- `apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/connector/ConnectorPrintExecutionPolicy.kt`
- `apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/connector/PrinterConnectorService.kt`
- `apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/connector/UsbPrintJobExecutor.kt`
- `apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/diagnostics/UsbPrinterDiagnosticsActivity.kt`

## 8. 回归结果

RC2 合入前必须通过以下 Gate；最终执行结果随 RC2 Commit 一同固定：

| 范围 | 命令/覆盖 | 结果 |
|---|---|---|
| API | typecheck、全量 test、build；平台开关、商家拒绝、Gate、四态、租约与跨商家测试 | PASS；29 suites / 292 tests |
| merchant-admin | typecheck、build；平台入口、商家只读阻断、桌面/手机与三语言 | PASS；仅保留既有 chunk-size warning |
| merchant-cashier | typecheck、lint、test、test:ui、build；四态、按钮、三语言与状态刷新 fail-closed | PASS；16 files / 97 tests；UI 覆盖 1536×1024、1366×768、1280×800、1180×800、1024×768、820×1180、768×1024 |
| Android | `testDebugUnitTest`、lint、assembleRelease；执行前 Gate、会话失效、商家隔离与 USB 证据 | PASS；71 tests；lint 仅有 24 个既有 warning |
| Git | `git diff --check`、敏感信息与范围审计 | PASS |

## 9. 明确未新增与未执行

本次校正：

- 未修改 Prisma schema；
- 未创建或执行 migration；
- 未新增订单、桌台、TableSession、账号、员工、角色或权限接口；
- 未修改订单业务状态机；
- 未恢复 Terminal Token、绑定码、Heartbeat 或独立设备账号；
- 未恢复旧服务器 LAN/TCP 直打；
- 未部署，未执行 production migration，未修改 DNS/Nginx。
