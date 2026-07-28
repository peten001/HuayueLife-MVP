# 打印中心打印机配置与中越双语小票最终报告

## 范围与环境

- Worktree：`fix/d2-mobile-responsive`，本地未提交状态；未执行 Commit、Push、Tag、Merge、部署或生产环境操作。
- API：`http://localhost:3001/api/v1`。
- Merchant Admin：`http://localhost:5173/`。
- 数据库：Docker 本地 MySQL `localhost:3307/huayue_life_mvp`，健康检查通过。
- 本次未新增 migration；已有 dirty worktree 中的历史 schema/migration 文件保持不变。

## 完成内容

### 打印机配置

- 新增、编辑打印机表单不再显示“主要用途”，提交 payload 也不再从 UI 改写历史 `purpose`。
- 自动打印规则仍是唯一打印路由入口；打印机列表用途文案由已启用自动打印规则实时推导，无规则时显示“尚未分配自动打印场景”。
- 移除“高级设置”折叠。LAN 的 IP、端口、纸宽直接显示；USB、飞鹅、易联云的必要配置直接显示。
- 云打印密钥继续由服务端安全配置承载，前端仅显示安全说明，不在打印机配置中暴露或持久化密钥。

### 中越双语小票

- 新增统一双语 footer 解析与默认值：
  - 中文：`谢谢惠顾，欢迎再次光临`
  - 越南语：`Cảm ơn quý khách, hẹn gặp lại!`
- 小票设置改为中文结束语、越南语结束语两个独立字段，各 60 字符上限；历史单 footer 会安全拆分并保留旧模板数据。
- 顾客、厨房、结账、测试小票使用固定中文/越南语标签及商品名称 fallback 规则，不跟随后台当前界面语言切换成单语。
- 预览与实际打印共用双语文档字段；API 创建打印任务时将模板 footer 统一写入 snapshot，Android receipt renderer 读取相同字段并输出两行 footer。
- 旧 snapshot 仍可解析；缺少 footer 时使用同一组默认双语内容；不输出字面量 `\\n`。

## 修改文件

- `apps/merchant-admin/src/pages/printing/PrintingPrintersPage.vue`
- `apps/merchant-admin/src/pages/printing/PrintingTemplatesPage.vue`
- `apps/merchant-admin/src/types/printing.ts`
- `apps/merchant-admin/src/i18n/printing.ts`
- `apps/merchant-admin/src/utils/bilingual-receipt.ts`
- `apps/merchant-admin/scripts/receipt-settings-ui.test.mjs`
- `apps/api/src/modules/printing/types/bilingual-receipt.ts`
- `apps/api/src/modules/printing/types/receipt-document.ts`
- `apps/api/src/modules/printing/services/receipt-snapshot.service.ts`
- `apps/api/src/modules/printing/services/print-jobs.service.ts`
- `apps/api/src/modules/printing/services/receipt-snapshot.service.spec.ts`
- `apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/printing/receipt/ReceiptDocumentV1.kt`
- `apps/merchant-terminal-android/app/src/main/java/com/yunqiao/life/merchantterminal/printing/receipt/ReceiptDocumentRenderer.kt`

## 验证结果

- merchant-admin typecheck：PASS
- merchant-admin test：PASS（3 个脚本，包含打印机配置与双语小票静态断言）
- merchant-admin build：PASS
- API typecheck：PASS
- API printing tests：PASS（3 suites / 61 tests）
- Android receipt unit tests：PASS（`*ReceiptDocument*`）
- Impeccable detector：PASS（无命中）
- `git diff --check`：PASS
- 本地 API health：PASS；本地 MySQL：healthy；前端 5173：可访问

## 执行器边界

未修改 Android USB 执行器、LAN 执行器、飞鹅 Provider、易联云 Provider、打印任务状态机、Prisma schema 或 migration。Android 侧仅调整 receipt document 兼容字段和双语内容渲染。

## 截图

验收截图目录：
`docs/ui-review/printing-center-printer-config-bilingual-receipt-final/`

包含指令要求的 18 个命名截图，覆盖桌面端、D10、D2、移动端及中英文越南语界面。
