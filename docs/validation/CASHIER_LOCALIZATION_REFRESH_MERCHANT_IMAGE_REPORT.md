# 收银台菜品多语言、静默刷新与商家图本地验收报告

日期：2026-07-29（Asia/Ho_Chi_Minh）
状态：已在最新 `origin/main` 的隔离发布 worktree 完成本地修改与验收；正式部署结果另见生产部署报告。

## 1. 本任务修改文件

### API 最小字段透传

- `apps/api/src/modules/merchant-orders/merchant-orders.service.ts`
- `apps/api/src/modules/table-sessions/table-sessions.service.ts`
- `apps/api/src/modules/table-sessions/table-sessions.service.spec.ts`

### 收银台实现与类型

- `apps/merchant-cashier/src/domain/localized-order-item.ts`
- `apps/merchant-cashier/src/domain/index.ts`
- `apps/merchant-cashier/src/domain/tables.ts`
- `apps/merchant-cashier/src/domain/merchant.ts`
- `apps/merchant-cashier/src/types/orders.ts`
- `apps/merchant-cashier/src/types/tables.ts`
- `apps/merchant-cashier/src/components/common/view-models.ts`
- `apps/merchant-cashier/src/components/bills/TableBillDetail.vue`
- `apps/merchant-cashier/src/features/fulfillment/OrderItemsSection.vue`
- `apps/merchant-cashier/src/components/orders/ReturnItemDialog.vue`
- `apps/merchant-cashier/src/stores/tables.ts`
- `apps/merchant-cashier/src/pages/TableOverviewPage.vue`
- `apps/merchant-cashier/src/layouts/CashierShell.vue`
- `apps/merchant-cashier/src/components/shell/CashierSidebar.vue`
- `apps/merchant-cashier/src/components/shell/CashierMerchantPanel.vue`
- `apps/merchant-cashier/src/styles/final-layout.css`

### 定向测试与本地演示验收

- `apps/merchant-cashier/src/domain/localized-order-item.test.ts`
- `apps/merchant-cashier/src/domain/merchant.test.ts`
- `apps/merchant-cashier/src/components/shell/CashierMerchantPanel.test.ts`
- `apps/merchant-cashier/src/components/bills/TableBillDetail.test.ts`
- `apps/merchant-cashier/src/stores/tables.test.ts`
- `apps/merchant-cashier/src/fixtures/data.ts`
- `apps/merchant-cashier/src/fixtures/repository.ts`
- `apps/merchant-cashier/scripts/capture-localization-refresh-review.mjs`

## 2. 菜品多语言真实字段与回退逻辑

真实数据库结构：

- `OrderItem.productNameZhSnapshot`：中文历史快照，必填。
- `Product.nameZh`：当前中文商品名。
- `Product.nameVi`：当前越文商品名，可空。
- 当前 Prisma `Product` 和 `OrderItem` 均没有英文名称字段，也没有越文/英文订单快照字段。

本次不新增字段、不做 migration。API 仅在商家订单与桌账 serializer 中透传已有商品关联的 `productNameZh`、`productNameVi`；商品已删除时仍保留中文历史快照。

统一 helper `resolveLocalizedOrderItemName(item, locale, fallback)` 的语义：

1. 当前语言快照名称（若未来/兼容响应已提供）。
2. 当前语言商品关联名称。
3. 中文历史快照。
4. 原始 `productName` / `name` 兼容字段。
5. 任意可用中文、越文、英文名称。
6. 当前语言安全占位文案，最终兜底 `—`。

桌台菜品汇总、到店自取、商家配送、历史订单详情和退菜弹窗统一使用该 helper；locale 在 render/computed 层读取，切换语言立即更新。

## 3. 10 秒闪白真实根因

`tables` store 在每次 `refreshSelectedSession()`（包括 10 秒轮询）开始时都设置 `detailLoading=true`；`TableOverviewPage` 又在 `detailLoading` 时无条件用整块 `LoadingState` 替换 `TableBillDetail`。旧详情数据实际仍在 store 内，但 UI 被 Skeleton 覆盖，因此出现闪白、组件卸载和滚动位置丢失风险。

## 4. 静默刷新方案

- `detailLoading` 现在只代表“当前没有任何可用详情”的首次加载或新会话加载。
- 同一会话后台刷新时保留最后一次成功的 `selectedSessionDetail`，不显示整块 Skeleton。
- 成功后按稳定桌台 ID 原位替换详情；失败保留旧详情。
- 既有 `queryRevision`、`detailRequestSequence` 和 `selectedTableId` 校验继续阻止迟到响应覆盖新选择。
- 当前桌台仍存在时不重置选择；桌台消失或会话结束时仍使用既有明确空态。
- 未修改 10 秒轮询频率、桌台 API、订单状态机或 TableSession 业务规则。

连续观察 70,000 ms（约 7 个轮询周期）：Skeleton 出现 0 次，详情卸载 0 次；当前主线桌账内容未形成内部溢出，滚动位置稳定为 `0 → 0`；选中路径保持 `/tables/demo-table-1`，浏览器错误 0。

## 5. 商家图片字段与 fallback

现有 `/merchant/profile` 已返回：可见 `images[]`、`coverUrl`、`logoUrl`。本次候选顺序：

1. 可见 `STORE` 门店图。
2. 可见 `COVER` 封面图。
3. `coverUrl`。
4. 可见 `LOGO` 图片。
5. `logoUrl`。
6. 商家名称首字母。

所有 URL 继续通过既有 `resolveMediaUrl` 处理；重复 URL 去重。图片逐个监听加载失败并自动尝试下一候选，最终回到首字母，不显示破图。图片使用 `object-fit: cover`；常规宽屏为 42×42px / 11px 圆角，1280×800 D10 布局为 34×34px / 9px 圆角，以保留既有 186px 侧栏和长越文商家名省略空间。

## 6. 测试命令与结果

- `corepack pnpm --filter @huayue-life/merchant-cashier lint`：PASS。
- `corepack pnpm --filter @huayue-life/merchant-cashier typecheck`：PASS。
- `corepack pnpm --filter @huayue-life/merchant-cashier test`：PASS，43 个测试文件、273/273 用例通过。
- `corepack pnpm --filter @huayue-life/merchant-cashier build`：PASS，Vite 1939 modules transformed。
- `corepack pnpm --filter @huayue-life/api typecheck`：PASS。
- `corepack pnpm --filter @huayue-life/api test -- table-sessions.service.spec.ts`：PASS，13/13 用例通过。
- `corepack pnpm --filter @huayue-life/api build`：PASS。
- `POLL_OBSERVE_MS=70000 node scripts/capture-localization-refresh-review.mjs`：PASS；完成三语言、商家图、1280×800、1920×1080 与 70 秒轮询验收。

## 7. 本地访问地址

- 收银台 fixture：`http://127.0.0.1:5176`
- 本地图片静态服务：`http://127.0.0.1:3001`

验收完成后服务已停止；以上地址不是部署地址。

## 8. 截图与证据目录

`docs/ui-review/cashier-localization-refresh-merchant-image/`

- `01-zh-order-item.png`
- `02-vi-order-item.png`
- `03-en-order-item.png`
- `04-merchant-store-image.png`
- `05-1280x800-full-page.png`
- `06-after-70s-polling.png`
- `07-pc-1920x1080-full-page.png`
- `polling-evidence.json`

截图使用明确标记的本地非真实 fixture 数据，不包含密码、Token、API Key 或个人敏感信息。

## 9. 已知限制

- 当前正式数据模型没有英文商品名，也没有英文订单快照；因此真实 API 的英文界面会按规则回退到中文历史快照，无法凭空显示英文。英文 helper/响应兼容与 fixture 切换已验证，但若未来要求真实英文商品名，需要另立产品与 schema/migration Gate，本任务未扩大范围。
- 越文优先使用当前关联 `Product.nameVi`，不是历史越文订单快照；商品越文名后来修改时，历史订单的越文显示会随当前商品变化。中文价格/数量历史快照保持不变。
- 70 秒轮询为本地浏览器 fixture 验收，不等同于生产或实体收银机现场验收。
- 收银台内未发现独立“打印预览”菜名组件；正式票据仍使用历史中文快照，本次按打印冻结边界未修改打印链路。

## 10. Git 状态与脏改动边界

开始前正式源码工作区处于 `main...origin/main [behind 42]`，并存在大量未提交历史改动与未跟踪文件，主要包括：

- `apps/merchant-terminal-android/**`
- `apps/merchant-admin/**` 打印中心与 Android 下载入口
- `apps/api/src/modules/printing/services/print-jobs.service.spec.ts`
- `deploy/**`
- 既有 `apps/merchant-cashier/scripts/capture-handover-final.mjs`、`capture-workflow-review.mjs`
- 既有 `docs/ui-review/merchant-cashier-*` 目录

上述历史内容均未覆盖、清理、回退、暂存或提交。本任务从最新 `origin/main` 建立独立发布 worktree，新增/修改文件仅为第 1 节清单以及本报告和新截图目录。

本地验收快照状态：隔离发布 worktree 已通过门禁；未更新 APK、未执行数据库 migration，原工作区历史脏改动保持原样。
