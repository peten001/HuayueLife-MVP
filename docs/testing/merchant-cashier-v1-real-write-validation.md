# 云桥 Life｜Web 收银台 V1 真实写操作验收记录

> 本文只记录专门测试商家、专门测试桌台和用户明确创建的测试订单。报告不包含账号、密码、Token、Cookie、手机号、地址或其他顾客隐私。人工结果由用户于 2026-07-15 明确确认，未被确认的附加场景不记为人工 PASS。

## 1. 最终结论

**Web 收银台 V1 真实订单与桌台业务验收完成。**

Web 收银台 V1 已完成真实 API、真实桌台、真实订单状态流、整桌账单、关闭桌台、拒单和三语言的人工业务验收。

打印功能不属于本阶段，当前页面显示“打印未接入 / 打印待接入”是正确状态。本轮没有开发 PrintJob、PrintAttempt、云打印、LAN 打印、USB 打印或 Android 本地打印连接器。

## 2. 验收环境与安全边界

| 项目 | 记录 | 结果 |
|---|---|---|
| 日期与时区 | 2026-07-15，Asia/Ho_Chi_Minh | PASS |
| 分支 | `feature/merchant-cashier-web-v1` | PASS |
| 验收起始 Commit | `2b643ca89c0d2ff191f68fe9f6d22a428e7cfb0e` | PASS |
| 本地收银台 URL | `http://127.0.0.1:5176/` | PASS |
| API URL | `https://api.huayueyouxuan.com/api/v1` | PASS |
| Fixture | 以 `VITE_CASHIER_USE_FIXTURES=false` 明确关闭；登录页检查未出现演示入口 | PASS |
| 测试商家 | 专门测试商家；名称由用户现场确认，为减少不必要的业务信息留存未写入报告 | PASS |
| 测试桌台 | 专门测试桌台；编号由用户现场确认，未写入报告 | PASS |
| 测试订单 | 两笔明确标记的测试订单；订单号未写入报告 | PASS |
| 顾客隐私 | 未填写真实顾客隐私 | PASS |
| 支付 | 未使用线上支付 | PASS |
| 打印 | 未触发真实打印 | PASS |
| 真实经营数据 | 未操作真实营业订单或真实营业桌台 | PASS |
| 数据库与部署 | 未修改 Prisma、未执行 migration、未部署 | PASS |

## 3. 测试订单 A：完整正向流程

当前真实堂食状态流为：

`PENDING_ACCEPTANCE → ACCEPTED → PREPARING → READY → COMPLETED`

| 步骤 | 实际人工结果 | 结果 | 截图记录 |
|---|---|---|---|
| 真实商家登录 | 登录成功，商家名称和 Logo 正确 | PASS | 未提供可提交的脱敏原图 |
| 真实桌台数据 | 专门测试桌台正确显示 | PASS | 未提供可提交的脱敏原图 |
| 新订单出现 | 用户提交后 10 秒内出现在新订单列表 | PASS | `01-test-order-new.png` 未提供 |
| 新订单提醒 | 新订单数量增加，声音只提醒一次 | PASS | 人工听感确认 |
| 新订单字段 | 桌台号、订单号、人数、菜品数和金额正确 | PASS | 未提供可提交的脱敏原图 |
| 三语言切换 | 中文、越南语、英文切换后数据保持正常 | PASS | `09-vietnamese-state-flow.png`、`10-english-state-flow.png` 未提供 |
| 接单 | 操作成功 | PASS | `02-test-order-accepted.png` 未提供 |
| 接单后列表 | 从新订单移出并进入未完成订单 | PASS | 未提供可提交的脱敏原图 |
| 开始制作 | 状态正确进入制作中 | PASS | `03-test-order-preparing.png` 未提供 |
| 制作完成 | 状态正确进入待出餐（READY） | PASS | 未提供可提交的脱敏原图 |
| 完成订单 | 操作成功，订单从未完成列表移出 | PASS | `04-test-order-completed.png` 未提供 |
| 订单记录 | 完成订单可以查询 | PASS | 未提供可提交的脱敏原图 |
| 刷新一致性 | 刷新后订单状态保持正确 | PASS | 人工确认 |
| 整桌账单关联 | 关联测试订单正确，不混入其他桌台订单 | PASS | `05-table-bill-updated.png` 未提供 |
| 整桌账单内容 | 菜品、数量、金额和账单状态正确 | PASS | 未提供可提交的脱敏原图 |
| 完成桌账 | 关闭专门测试桌台成功 | PASS | `06-table-session-closed.png` 未提供 |
| 桌台恢复 | 关闭后恢复空闲，刷新后仍为空闲 | PASS | `07-table-back-to-idle.png` 未提供 |
| 历史保留 | 关闭 TableSession 后历史订单仍保留 | PASS | 人工确认 |
| 异常 | 无 | PASS | — |

说明：完成订单和关闭 TableSession 均不代表收款；本轮没有调用任何支付或结算能力。

## 4. 测试订单 B：拒单流程

| 步骤 | 实际人工结果 | 结果 | 截图记录 |
|---|---|---|---|
| 第二笔新订单 | 独立测试订单正常出现 | PASS | 未提供可提交的脱敏原图 |
| 拒单二次确认 | 二次确认正确显示 | PASS | `08-test-order-rejected.png` 未提供 |
| 确认拒单 | 真实拒单操作成功 | PASS | 未提供可提交的脱敏原图 |
| 新订单列表 | 拒单后从新订单列表移出 | PASS | 未提供可提交的脱敏原图 |
| 订单记录 | 最终状态正确 | PASS | 未提供可提交的脱敏原图 |
| 桌台与 TableSession | 状态正确，无错误残留 | PASS | 未提供可提交的脱敏原图 |
| 刷新一致性 | 刷新后状态保持正确 | PASS | 人工确认 |
| 异常 | 无 | PASS | — |

当前收银台没有自定义拒单原因输入；真实 API 支持拒单，未提供原因时由后端记录既有默认原因。本轮没有修改该业务规则。

## 5. 其他人工业务验收

| 项目 | 实际 | 结果 |
|---|---|---|
| 真实账号登录与登录保持 | 正常 | PASS |
| 新订单页面 | 正常 | PASS |
| 未完成订单页面 | 正常 | PASS |
| 订单记录页面 | 正常 | PASS |
| 订单详情 | 正常 | PASS |
| 桌台总览 | 正常 | PASS |
| 整桌账单 | 正常 | PASS |
| 中文 | 正常 | PASS |
| 越南语 | 正常 | PASS |
| 英文 | 正常 | PASS |
| 页面刷新后状态 | 一致 | PASS |
| 打印状态 | 显示“打印未接入 / 打印待接入”，符合当前阶段设计 | PASS |
| 异常 | 无 | PASS |

## 6. 离线写操作保护修复

预检发现：网络离线或 API 不可达时，顶部虽然显示网络异常，但订单动作和关闭桌账仍可点击并尝试请求。

本轮保留了以下最小前端修复：

- 离线、API 不可达或 API 仍在重连确认时，禁用所有订单写操作按钮。
- 离线、API 不可达或 API 仍在重连确认时，禁用关闭桌账按钮。
- 网络异常时禁用确认弹窗的写入确认按钮，但保留取消按钮。
- 订单动作与关闭桌账的执行入口增加二次网络 guard。
- 阻止操作时复用已有网络错误提示。
- 未修改 API、数据库、订单状态机、Android 或打印逻辑。

自动回归覆盖按钮禁用、不触发事件、健康网络放行、离线阻止、API 不可达阻止和重连中阻止。真实业务验收完成后未要求用户重复断网写操作，避免产生额外业务写入。

## 7. 刷新、并发、网络与认证证据边界

| 项目 | 证据 | 结果 |
|---|---|---|
| 真实业务刷新一致性 | 用户确认订单 A、订单 B、桌台和 TableSession 刷新后状态正确 | PASS |
| 写操作 loading 与防重复 | 组件禁用、Shell guard、后端状态条件更新；自动测试覆盖前端禁用 | PASS |
| 离线写操作阻止 | 组件与 guard 自动测试 | PASS（自动回归） |
| 网络恢复刷新 | 现有 UI 自动回归覆盖；本轮未重复执行真实写操作 | PASS（自动回归） |
| 401 清理 | Store/API 自动测试覆盖；不记录 Token 或 Cookie | PASS（自动回归） |
| 双标签同步 | 当前依靠约 10 秒轮询最终一致，本轮没有独立人工记录 | NOT TESTED |
| 双标签声音竞态 | 没有主标签选举，本轮没有独立人工记录 | NOT TESTED |

请求超时可能出现服务端已经成功但前端未收到成功响应。实际运营遇到超时时必须先刷新详情，再决定是否重试，不得盲目重复点击。

## 8. 验收截图说明

目标目录：`docs/ui-review/merchant-cashier-real-write-validation/`

本轮没有收到可写入仓库的脱敏原始截图。为避免将 Fixture、路由 Mock 或重建画面伪装为真实 API 人工证据，本报告不生成或提交伪造截图。人工 PASS 结果以用户明确提供的验收记录为依据；若后续补充截图，必须先移除账号、密码、Token、Cookie、手机号、地址和真实顾客隐私。

## 9. 自动回归与构建

| 命令 | 结果 |
|---|---|
| `corepack pnpm --filter @huayue-life/merchant-cashier typecheck` | PASS |
| `corepack pnpm --filter @huayue-life/merchant-cashier lint` | PASS，0 warning |
| `corepack pnpm --filter @huayue-life/merchant-cashier test` | PASS，14 个测试文件、74 项测试 |
| `corepack pnpm --filter @huayue-life/merchant-cashier test:ui` | PASS；覆盖 1536×1024、1366×768、1280×800、1180×800、1024×768、820×1180、768×1024，以及三语言、订单流、网络恢复和打印禁用状态 |
| `corepack pnpm --filter @huayue-life/merchant-cashier build` | PASS |
| `corepack pnpm --filter @huayue-life/merchant-admin typecheck` | PASS |
| `corepack pnpm --filter @huayue-life/merchant-admin build` | PASS；保留既有单个 JS chunk 超过 500 kB 警告（约 516.40 kB） |

`test:ui` 按仓库既有脚本使用临时 Fixture 会话验证布局和交互；它不作为真实业务结果依据。真实订单、桌台和 TableSession 的 PASS 结论只来自本报告前述真实 API 人工验收。临时服务在测试后已关闭。

## 10. 范围与结束状态

- Web 收银台 V1 真实订单与桌台业务验收：完成。
- 最小前端离线写保护：已实现，最终全量回归通过。
- Prisma schema 或 migration：无修改、未执行。
- API 业务代码：无修改。
- Android：无修改。
- 打印功能：未开发，保持“待接入”。
- 部署：未执行。
- push：未执行。
