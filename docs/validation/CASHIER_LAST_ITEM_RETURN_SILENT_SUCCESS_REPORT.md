# 云桥 Life｜收银台退最后一个菜 + 成功操作静默化验收报告

日期：2026-07-29
结论：两项需求已在独立 worktree 完成本地实现、自动化测试、fixture 浏览器验收和截图；原本被本机旧 schema 阻塞的真实数据库 E2E 已在一次性隔离 MySQL 中使用仓库现有 migration 完成，最终 21/21 PASS（含此前阻塞的 18/18），临时数据库已删除。当前结果未提交、未推送、未部署，等待人工验证。

## 1. 基线、工作区与边界

- 正式基线及当前 worktree HEAD：`80befa63d17810893424c897b929f9cb703dbeeb`。
- 分支：`work/cashier-last-item-return-20260729-133939`。
- 独立 worktree：`/private/tmp/huayue-cashier-last-item-return-20260729-133939`。
- `origin/main..HEAD` 提交数：`0`。
- 原主仓库 `/Users/peter/Desktop/HuayueLife-MVP` 仍在 `main` / `6ef3c1e8d9191fa335b6321bc3d5a7b0e6bd4eb8`，检查时有 84 个历史脏条目，其中包含与本任务同名文件；本次没有在该目录修改、清理、stash、reset 或提交任何内容。
- 本次未触碰小程序、Merchant Admin、Android 原生、USB 协议实现、Prisma Schema/migration 文件或生产配置；仅按第 18 节在一次性数据库应用既有 migration，完成后已删除该数据库。

## 2. 修改文件清单

### API 与后端测试

- `apps/api/src/modules/merchant-orders/merchant-orders.service.ts`
- `apps/api/src/modules/merchant-orders/merchant-orders.item-adjustments.spec.ts`
- `apps/api/test/merchant-item-adjustments.e2e-spec.ts`

### Cashier 实现、fixture 与测试

- `apps/merchant-cashier/src/components/bills/TableBillDetail.vue`
- `apps/merchant-cashier/src/components/bills/TableBillDetail.test.ts`
- `apps/merchant-cashier/src/components/orders/ReturnItemDialog.vue`
- `apps/merchant-cashier/src/components/orders/ReturnItemDialog.test.ts`
- `apps/merchant-cashier/src/components/printing/PrintJobActions.vue`
- `apps/merchant-cashier/src/components/printing/PrintJobActions.test.ts`
- `apps/merchant-cashier/src/features/delivery/DeliveryContactPanel.vue`
- `apps/merchant-cashier/src/features/fulfillment/FulfillmentV2.test.ts`
- `apps/merchant-cashier/src/fixtures/repository.ts`
- `apps/merchant-cashier/src/fixtures/repository.compatibility.test.ts`
- `apps/merchant-cashier/src/i18n/messages.ts`
- `apps/merchant-cashier/src/pages/TableOverviewPage.vue`
- `apps/merchant-cashier/src/pages/PickupOrdersPage.vue`
- `apps/merchant-cashier/src/pages/DeliveryOrdersPage.vue`
- `apps/merchant-cashier/src/stores/tables.ts`
- `apps/merchant-cashier/src/stores/tables.test.ts`
- `apps/merchant-cashier/src/stores/silent-success-policy.test.ts`（新增）
- `apps/merchant-cashier/src/styles/item-adjustments.css`
- `apps/merchant-cashier/scripts/verify-ui.mjs`
- `apps/merchant-cashier/scripts/capture-last-item-return-silent-success.mjs`（新增）

### 文档与截图

- `docs/architecture/YUNQIAO_PLATFORM_MASTER_BASELINE.md`
- `docs/validation/CASHIER_LAST_ITEM_RETURN_SILENT_SUCCESS_REPORT.md`（本报告）
- `docs/ui-review/cashier-last-item-return-silent-success/` 下 8 张 PNG（新增）

## 3. “最后一个菜不能退”的真实原因

API 的 `MerchantOrdersService.adjustOrderItem()` 原来在 `RETURN`、目标数量为 0 且当前订单没有其他菜品行时，直接返回 `LAST_ORDER_ITEM_RETURN_NOT_ALLOWED`。Cashier fixture 复制了同一禁用规则，因此真实 API 和演示模式都会拒绝退空订单。前端同时缺少“退空订单/退空整桌”的危险确认语义，也不会在返回的 Session 已关闭时清理旧账单快照。

本次删除了后端和 fixture 的末项硬拒绝，并把决定权放在后端事务内基于当前 OPEN TableSession 的锁定数据重新计算；前端只负责提示与应用后端快照。

## 4. 后端原子事务实现

`adjustOrderItem()` 继续复用现有 Order、OrderItem、TableSession、DiningTable、权限与日志体系，没有新增状态、接口或数据库字段。事务顺序为：

1. 校验操作员工/商家创建者约束，读取订单关联。
2. 按固定顺序锁定 DiningTable、TableSession、该 Session 全部 Order、幂等日志及全部 OrderItem。
3. 校验 OPEN Session、DINE_IN、允许状态、目标菜归属和 `expectedQuantity`。
4. 删除退为 0 的菜品行或更新剩余数量，并重算当前订单金额。
5. 在锁内按“非 CANCELLED 的现有有效订单 + quantity”重算整桌有效数量。
6. 当前订单退空时，将订单条件更新为 `CANCELLED`；整桌有效数量为 0 时，同事务将 TableSession 更新为 `CLOSED`、`openTableId=null`、写入 `closedAt` 并清除抹零状态。
7. 写入退菜日志与自动取消日志；任一条件更新、日志或 Session 关闭失败都会抛错并由数据库事务整体回滚。
8. 事务提交后用现有 mutation response 返回最新 Order/Session 快照。

没有调用结账、Settlement、Payment 或自动打印触发逻辑；这条路径是“退空取消”，不是已支付或正常结账。

## 5. 状态变化矩阵

| 场景 | OrderItem | 当前 Order | TableSession | DiningTable | 结账/支付/打印 |
| --- | --- | --- | --- | --- | --- |
| 单订单、最后一份退空 | 删除有效行（等价有效数量 0） | `CANCELLED`，金额归零 | `CLOSED`，`openTableId=null` | 由现有 `openTableId` 语义恢复空闲 | 不创建 |
| 单菜 ×3 退 1 | quantity 3 → 2 | 状态不变、金额重算 | 保持 `OPEN` | 保持用餐中 | 不创建 |
| 当前订单退空、其他有效订单存在 | 当前行删除 | 当前 Order `CANCELLED`；其他 Order 不变 | 保持 `OPEN` | 保持用餐中 | 不创建 |
| 多订单最终剩余菜退空 | 最后一行删除 | 最后有效 Order `CANCELLED` | `CLOSED`，`openTableId=null` | 恢复空闲 | 不创建 |
| 仅剩已取消订单的历史菜品行 | 历史行不计入有效数量 | 历史取消状态不变 | 当前退空后关闭 | 恢复空闲 | 不创建 |

项目没有单独的 DiningTable occupancy 枚举；桌台是否占用由 OPEN TableSession 的 `openTableId` 表达，因此释放桌台的正式动作是原子清空该字段。

## 6. 并发、幂等与审计保护

- 退菜与开台/加菜遵循同一 DiningTable 优先锁顺序；后进入的并发加菜必须等待，退菜事务随后锁定全 Session 的 Order/OrderItem 并以最新提交状态计算，已成功加入的新菜会阻止错误关闭桌台。
- Order 和 OrderItem 均按 ID 排序锁定，减少交叉请求死锁风险。
- `expectedQuantity` 防止旧页面把已变化数量再次扣减；状态更新和 Session 关闭使用带原状态条件的 `updateMany`，影响行数不为 1 即冲突回滚。
- `requestKey` 在状态拒绝之前读取：同 key、同 payload 在首次退空并关闭桌台后仍可稳定重放；同 key 不同 payload 返回 `ADJUSTMENT_REQUEST_KEY_CONFLICT`。
- 前端保留 mutation loading、pending request 和不确定结果重试锁，防止连续点击；不确定网络结果继续以原 request key 重试。
- `ORDER_ITEM_RETURNED` 日志包含员工、商家、桌台、Session、Order、OrderItem、退前/退后/退回数量、金额及是否取消/关桌；`ORDER_AUTO_CANCELLED_EMPTY_AFTER_RETURN` 记录 Order 状态变化和关桌结果。现有接口没有退菜原因字段，未为此新增字段或 migration。

## 7. 前端状态与危险确认

- quantity=1 且有权限、状态允许时退菜按钮可用；quantity≤0、Session 非 OPEN 或状态不允许时仍禁用/报错。
- 全量退掉当前订单最后一个有效菜时显示一次危险确认；文案根据“仅退空当前订单”或“同时退空整桌”分别说明后果。部分退菜使用普通确认。
- 后端返回 Order `CANCELLED` 或 Session `CLOSED` 后，清除已选订单及 query，但保留当前桌台 ID；关闭 Session 的快照不会残留在右侧，页面切回现有空闲桌台/开台点菜入口。
- 活跃账单过滤 `COMPLETED` 与 `CANCELLED` 订单；还有其他有效订单时继续显示其他订单并使用新金额。
- Impeccable 视觉复核发现退菜数量选择器在截图中只露出减号按钮；已将其改为明确的 3 × 44px 栅格（132px），重新截图后加减按钮与数量均完整可见。最终 detector 输出 `[]`。

## 8. 成功提示排查与移除范围

排查了 `apps/merchant-cashier/src` 及 `public` 中的 `.ts/.vue/.js/.mjs`，覆盖 `pushToast`、`toast/message/notification.success`、`Modal.success`、Snackbar、success helper、局部 success banner/state、mutation `onSuccess`、打印与复制反馈。新增 `silent-success-policy.test.ts` 作为 Cashier 范围的静态回归门禁；没有删除全 monorepo 的提示能力。

已移除或确认保持静默的成功反馈：

- 开台、开台并点菜、加菜。
- 减菜、退菜、订单退空/桌台自动关闭。
- 接单、拒单确认后的成功、制作/就绪/配送/完成等状态推进。
- 自取与配送抹零。
- 整桌结账。
- 打印任务提交、补打。
- 配送地址复制；同时清理未被使用的电话复制成功文案。
- 手动刷新原本即只在失败时提示，继续保持成功静默。
- Cashier 内未发现仍会发出成功 Toast、成功 Modal、成功 Notification、绿色成功横幅或 Snackbar 的业务调用。

成功后的按钮 loading 结束、订单状态、桌台颜色、数量、金额、打印任务列表等页面状态反馈保留。

## 9. 保留的提示与确认

仍保留并有测试/源码证据的提示：

- API/网络错误、超时、服务不可用和刷新失败。
- 403 权限不足、订单/数量/Session 状态冲突、请求 key 冲突、没有可退数量、桌台已关闭或已被其他员工操作。
- mutation 结果不确定与关闭页面/对话框受阻警告。
- 打印机未配置、打印服务不可用、打印/补打失败。
- 配送地址复制失败、当前设备不支持拨号。
- 拒单确认、整桌结账确认、退最后一份菜确认，以及补打原因/确认流程。

错误继续优先通过 `apiErrorTranslationKey()` 将后端 code 映射为三语言可理解文案；不把错误静默化。

## 10. i18n

中文、越南语、英文均新增：

- `itemAdjustment.lastItemReturnTitle`
- `itemAdjustment.lastItemReturnDescription`
- `itemAdjustment.lastTableItemReturnDescription`
- `itemAdjustment.noReturnableQuantity`

继续复用既有的订单状态变化、数量变化、TableSession 关闭、请求冲突、权限不足、网络/打印失败等三语言键。删除了只服务于成功弹窗的三语言文案（开台/点菜、状态更新、减菜/退菜、接单、结账、打印/补打、复制等），避免死文案重新被误用。组件内没有写死中文。

## 11. 自动化与工程门禁结果

| 门禁 | 结果 |
| --- | --- |
| API 定向：item adjustments + creator invariant | PASS，36/36 |
| Cashier 定向：TableBillDetail、ReturnItemDialog、tables store、fixture compatibility、FulfillmentV2、PrintJobActions、silent success policy | PASS，51/51 |
| Cashier 全量 Vitest | PASS，44 files / 285 tests |
| Cashier lint | PASS，0 warning |
| Cashier typecheck | PASS |
| Cashier production build | PASS，1939 modules |
| API typecheck | PASS |
| API build | PASS |
| `verify-ui.mjs` | PASS，10 个核心 viewport、三语言/网络恢复/桌台布局；本地 fixture 图片已安全 stub |
| 专项截图脚本 | PASS，8/8；浏览器 console/page error 为 0，无成功提示 |
| Impeccable detector | PASS，`[]` |
| `git diff --check`（最终工作区） | PASS |

定向测试覆盖最后一份可退、确认取消/仅提交一次、退空后空闲 UI、其他订单保留、金额/状态、fixture 幂等与关闭 Session、错误反馈、打印/补打成功静默与失败提示，以及 Cashier 源码全局成功提示禁用策略。

## 12. API 全量与真实数据库 E2E

### API 全量 Jest

- 结果：44 suites；438/439 tests PASS。
- 唯一失败：`apps/api/src/modules/merchant-orders/merchant-orders.printing-outbox.spec.ts:58`。
- 失败内容：`resolves.toBe(accepted)` 收到内容相等但引用不同的对象，Jest 建议值相等断言；与已知正式基线“merchant-orders 对象引用断言”一致。
- 本次未修改该 spec 或 transition/printing-outbox 路径，因此按指令记为既有非阻塞项；没有新增全量测试失败。

### 新增真实数据库 E2E

- 已编写 21 个场景，覆盖单菜单份、单菜多份、当前订单退空但其他订单存在、多订单最后一份、真实事务回滚、并发加菜等待、重复请求、已取消/已完成/已关闭/数量非法/跨商家等。
- 历史首次连接本机既有测试数据库时：3/21 通过，18/21 被该旧库缺少 `orders.rounding_amount_vnd`（及同组 `rounding_*`）阻塞；没有对该库执行 migration。
- 该历史阻塞已由第 18 节的一次性隔离数据库补充验证解除：仓库 22 个既有 migration 全部成功应用，最终 21/21 PASS、18/18 原阻塞项 PASS、0 skipped、0 setup failure、0 open handle。

## 13. USB Hotfix 回归

- `print-jobs.service.spec.ts` + `receipt-compatibility.spec.ts`：PASS，48/48。
- 本次没有修改 USB、ESC/POS、receipt parser/renderer 或 Android 原生代码。
- 物理 USB 打印未执行，也未构建或更新 APK。

## 14. 本地浏览器验收与访问地址

- 地址：`http://127.0.0.1:5176/login`（fixture 演示模式，检查时 HTTP 200；服务保留供人工验证）。
- 浏览器：项目独立 Playwright 脚本复用本机 Chrome。内置浏览器连接器在当前会话不可用，因此没有依赖它完成验收。
- 已交互验证：单菜单份退空并关桌、单菜多份退一份、当前订单退空但其他订单保留、数量冲突错误、加菜成功静默、越南语危险确认，以及 1920×1080/1280×800 布局。
- 现有 `verify-ui.mjs` 另通过 1366×768、1280×800、1180×800、1024×768、820×1180、768×1024、430×932、390×844、375×812、360×800 核心矩阵及网络恢复验证。
- 静默范围的其余 mutation 由组件/域测试和全源码策略覆盖；由于本机真实 API 数据库不兼容，未把 fixture 验收表述为真实 API 人工验收。

## 15. 截图

目录：`docs/ui-review/cashier-last-item-return-silent-success/`

1. `01-last-item-before-1920x1080.png`：最后一份退菜前。
2. `02-last-item-danger-confirm-1920x1080.png`：整桌最后一份危险确认。
3. `03-table-idle-after-return-1920x1080.png`：退空后保持选中并显示空闲/开台入口。
4. `04-multiple-quantity-return-one-1280x800.png`：单菜多份退一份后仍保持订单与桌台。
5. `05-order-empty-other-orders-remain-1280x800.png`：当前订单取消、其他订单保留。
6. `06-stale-quantity-error-1280x800.png`：状态/数量冲突错误提示。
7. `07-silent-add-items-full-page-1280x800.png`：加菜成功后的完整页面，无成功提示占位。
8. `08-vietnamese-last-item-confirm-1280x800.png`：越南语最后一份确认，无溢出。

全部截图只含 fixture 数据，不含密码、Token、Cookie 或 Secret。

## 16. 已知限制与人工验收结论

- 原本的旧 MySQL schema 阻塞已经解除：兼容当前完整 schema 的隔离数据库真实事务、回滚、并发和幂等 E2E 均已通过，见第 18 节。本次临时数据库验证范围内无剩余阻塞项。
- Fixture 浏览器验收、单元/组件/源码策略、构建门禁与隔离数据库 E2E 均通过；生产发布及真实商家人工验收仍需用户另行授权/确认，本报告不把本地验证升级为生产验收。
- 未做 Android 实机 WebView、USB 权限、纸张输出或真实打印机不可用场景；USB 仅做 48/48 自动化回归。
- 本地预览为临时开发服务，不是正式地址，不包含生产数据。

人工复验建议重点：兼容 schema 的隔离环境依次执行 8 组后端场景；再以真实安全商家核对开台、开台点菜、加/减/退菜、接单、制作/完成、抹零、打印提交/补打、结账均成功静默，同时错误、权限、冲突和危险确认仍可见。

## 17. 最终 Git 与禁止项声明

- HEAD 仍为 `80befa63d17810893424c897b929f9cb703dbeeb`，没有创建新 Commit；`origin/main..HEAD=0`。
- 修改仅保留在上述独立 worktree，等待用户验证。
- **未 Commit、未 Push、未部署、未对生产或原本本机数据库执行 migration、未重启 PM2、未修改 Nginx、未构建或更新 APK。** 本轮只对第 18 节的一次性隔离数据库执行 `prisma migrate deploy`，并已连同 volume 完整删除。
- 第一次尝试独立 Docker 测试库时发现目标端口已被既有容器占用；只清除了本次新建且未承载数据的空临时资源，未触碰既有容器或数据。

## 18. 临时数据库 E2E 补充验证（2026-07-29）

本节补充解决第 12、16 节记录的本机旧 schema 阻塞。本轮只创建一次性隔离数据库、应用仓库现有 migration、运行 E2E/回归并更新本报告；没有修改业务代码或测试代码。

### 18.1 数据库与隔离方式

- 数据库类型/版本：MySQL 8.0.46，与仓库 `mysql:8.0` 基线一致。
- 隔离方式：一次性 Docker 容器 + 一次性独立 volume；没有复用 Compose 项目、现有开发容器或现有数据库。
- Host/Port：`127.0.0.1:3317`，`docker inspect` 与 `lsof` 均确认只监听 IPv4 loopback，不暴露到 `0.0.0.0`。
- 临时数据库：`huayue_e2e_last_item_return_20260729_154934`。
- 临时容器：`huayue-e2e-last-item-return-20260729_154934`。
- 临时 volume：`huayue-e2e-last-item-return-20260729_154934-data`。
- 容器有专用 purpose/database label，使用本轮随机临时账号和密码；报告、Git 与命令输出均未记录完整连接串或密码。
- 现有开发 MySQL `huayuelife-mvp-d2-mobile-responsive-mysql-1` 始终保留在原状态和 3307 端口；未连接、停止、迁移或修改。

### 18.2 现有 migration 应用结果

仅对上述临时数据库执行：

```bash
DATABASE_URL="$E2E_DATABASE_URL" \
corepack pnpm --filter @huayue-life/api prisma:deploy
```

- Prisma provider：`mysql`。
- 仓库 migration：22 个目录 / 22 个 `migration.sql`。
- 应用结果：22/22 PASS，0 failed，0 rolled back。
- 最后一个 migration：`20260728110000_add_cloud_print_execution_state`。
- 未运行 `prisma migrate dev`、`prisma db push` 或 `migrate reset`。
- 未修改 `schema.prisma`、`migration_lock.toml` 或任何既有 migration，也未新增 migration。

### 18.3 Schema 完整性

迁移后通过 `information_schema` 只读验证，下列字段/状态均存在：

| 表 | 已确认字段/状态 |
| --- | --- |
| `orders` | `status`（含 `CANCELLED`）、`cancelled_at`、`cancel_reason`、`settlement_status`、`rounding_amount_vnd`、`rounding_applied_by_staff_id`、`rounding_applied_at` |
| `order_items` | `order_id`、`quantity`、`subtotal_vnd` |
| `table_sessions` | `status`（含 `CLOSED`）、`open_table_id`、`closed_at`、`rounding_amount_vnd`、`rounding_applied_by_staff_id` |
| `dining_tables` | `id` |
| `order_status_logs` | `action`、`request_key`、`metadata`、`operator_staff_id` |

### 18.4 真实数据库 E2E

运行时显式注入临时 `DATABASE_URL` 和 `NODE_ENV=test`，并关闭自动打印、打印执行、旧打印、Cloud Worker、飞鹅和易联云开关。验收命令为：

```bash
NODE_ENV=test DATABASE_URL="$E2E_DATABASE_URL" \
PLATFORM_ORDERING_ENABLED=true \
PRINTING_TASK_CENTER_ENABLED=false \
PRINTING_AUTO_CREATE_ENABLED=false \
PRINTING_EXECUTION_ENABLED=false \
LEGACY_PRINTING_ENABLED=false \
CLOUD_PRINT_WORKER_ENABLED=false \
FEIE_ENABLED=false YILIAN_ENABLED=false \
corepack pnpm --filter @huayue-life/api exec jest \
  --config test/jest-e2e.config.js \
  --runInBand --runTestsByPath \
  test/merchant-item-adjustments.e2e-spec.ts \
  --verbose --detectOpenHandles
```

- 最终结果：1 suite / 21 tests PASS；0 skipped，0 setup failure。
- 此文件原来在旧本机 schema 上为 3 PASS / 18 blocked；下列此前阻塞的 18 个 test 本轮全部 PASS：

| # | Test name | 结果 |
| --- | --- | --- |
| 1 | `creates one normal staff order in the OPEN session using server price` | PASS |
| 2 | `creates one open-only staff table action with no order and a table session` | PASS |
| 3 | `creates a table session and first staff order together when an empty table has items` | PASS |
| 4 | `serializes concurrent open-only staff attempts to the same table session` | PASS |
| 5 | `allows staff open-only first and customer first-order reuses the same session` | PASS |
| 6 | `returns TABLE_ALREADY_OPEN when customer opens first, then staff open-only hits duplicate` | PASS |
| 7 | `collapses concurrent identical add-order requests to one order` | PASS |
| 8 | `does not serialize independent same-merchant creates on actor/product SHARE locks` | PASS |
| 9 | `does not scan-lock another OPEN session while creating for a different table` | PASS |
| 10 | `serializes concurrent quantity changes and emits no print outbox` | PASS |
| 11 | `returns the same successful result for concurrent identical adjustment retries` | PASS |
| 12 | `safely cancels a pending order when its last item is decreased to zero` | PASS |
| 13 | `returns an accepted item, cancels the emptied order, keeps a non-empty session open, and emits no outbox` | PASS |
| 14 | `returns the only table item, closes the session, releases the table, and replays idempotently` | PASS |
| 15 | `rolls back item, order, session, rounding, and logs when the final session close conflicts` | PASS |
| 16 | `keeps the session open when a concurrently committed add-on order wins the table lock` | PASS |
| 17 | `does not close a session after waiting for a concurrently committed pending order` | PASS |
| 18 | `uses the current committed product price after waiting on its SHARE lock` | PASS |

第一次 21/21 运行的业务断言全部通过，但 Jest 给出退出超过 1 秒的通用异步句柄提醒。未使用 `--forceExit`；随后以 `--detectOpenHandles` 原样复跑，仍为 21/21 PASS，且没有未关闭 handle 诊断或退出提醒。因此最终句柄门禁为 PASS。

核心证据：

- 最后一份退空：Order `CANCELLED`、`UNSETTLED`、金额/菜品归零；TableSession `CLOSED`、`openTableId=null`、抹零清零；0 print outbox；同 request key 重放结果一致且日志各 1 条；关闭后新 key 返回 `TABLE_SESSION_CLOSED`。
- 事务回滚：故意制造 Session guarded close 冲突后，OrderItem、Order、Session、抹零、日志和 print outbox 全部保持操作前状态。
- 并发加菜：新增 Order 先持有桌台锁并提交后，退菜请求才继续；目标 Order 取消，但新增 Order 保持 `ACCEPTED`，Session 仍 `OPEN`、桌台未释放。
- 重复请求/数量保护：并发同 key 只写 1 条日志并返回一致数量；同 key 不同 payload 为 409，数量不为负数。
- 权限/非法状态：跨商家、无认证、非法 BIGINT、0 退菜量、关闭 Session 与状态冲突均返回明确 4xx/code。

### 18.5 回归结果

| 回归 | 结果 |
| --- | --- |
| API 定向 | PASS，2 suites / 36 tests |
| Cashier 定向 | PASS，7 files / 51 tests |
| Cashier 全量 | PASS，44 files / 285 tests |
| USB Hotfix | PASS，2 suites / 48 tests |
| API 全量 | 43/44 suites；438/439 tests；唯一失败仍为 `merchant-orders.printing-outbox.spec.ts:58` 的 `resolves.toBe(accepted)` 对象引用断言 |

API 全量失败的 test 名称、位置、期望/实际内容和 Jest 建议均与本任务开始前记录的既有基线完全一致；本次临时数据库验证没有修改任何业务代码、该 spec 或 transition/printing-outbox 路径，因此记为既有非阻塞项，没有新增失败。439 相对更早 434 基线的净增 5 项来自本任务此前新增的末项退菜定向单测。

### 18.6 文件与 Git 不变性证据

临时数据库验证前后，下列 SHA-256 均完全一致：

- `git diff --binary -- apps`：`5f598ace9cbccb4cb16736537528ad6e779b854241778946aaaf45bcb520267d`
- `apps/api/prisma` 全树：`7c2cbf339814941739ef5285c14008e5cd4d71649c50022f4c6269976c9b963f`
- `schema.prisma`：`efdbf7dc2705260913db71542114488e59d4f9ef9e1edadadc380b98c78a28ce`
- 根 `package.json`：`3023c20165bcb02c9357fc286ae76eec29b5498736acabcecce52625aa83573e`
- API `package.json`：`f83cc16737fb39221e531d29c10f992df3aabd31967a872b1c2ef2a025a345d7`
- `pnpm-lock.yaml`：`61b52f54a8d3e6d4e807762ee71df94481ead5b839380f4048198c6e42df4c6f`

结论：本轮未修改业务代码/测试代码、未新增 migration、未修改 Prisma Schema/依赖/lockfile、未写入 `.env`、SQL dump 或临时凭据文件。

### 18.7 临时数据库清理

- 清理前最终残留检查：`merchants=0`、`orders=0`、`table_sessions=0`、`order_status_logs=0`。
- 数据库连接检查：除执行检查本身外，`huayue_e2e` 其他连接为 0；`--detectOpenHandles` 复跑也没有句柄诊断或退出提醒。
- 删除前再次核对数据库名以 `huayue_e2e_last_item_return_` 开头，并核对容器的 purpose/database label 与 volume purpose label。
- 已精确删除容器 `huayue-e2e-last-item-return-20260729_154934`。
- 已精确删除 volume `huayue-e2e-last-item-return-20260729_154934-data`；临时数据库随独立 volume 删除，不可恢复。
- 3317 端口已释放；容器不存在、volume 不存在，`/tmp` 中本轮临时凭据/日志文件为 0（本轮未创建 env 文件）。
- 原开发容器仍为原 ID `eb357f1af1aa`，保持 healthy 和原 3307 映射，未受影响。
- 最终清理状态：**PASS**。
