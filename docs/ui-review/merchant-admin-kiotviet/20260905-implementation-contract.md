# 商家后台 UI 实施合同

<!-- THESIS: Business analysis is the home, with records and management one step away.
OWN-WORLD: Approved YunQiao analytics sage, system sans, compact KiotViet-inspired navigation. No copied identity, invented services, decorative marketing surfaces, or replacement financial rules.
STORY: Choose business date, read the full picture, drill into a real record, return to the same context. Order taking stays in Cashier.
FIRST VIEWPORT: Desktop data-rich overview and paired charts; mobile compact dates, financial overview, then the full analytics stack, not an excerpt.
FORM: Vue, existing APIs and chart library. Desktop top navigation; mobile Home, Dishes, Orders, Settlements, More. Responsive sheets, list rows, safe-area spacing, keyboard focus and explicit back paths. -->

状态：开发中，用户已授权跳过再次出图审核。只做本地开发和验收。

## 数据与操作边界

- 首页直接复用经营分析接口完整响应，不嵌入图稿示例金额。
- 单日指标进入同一营业日结账记录；区间先按天选择，不将区间误当成最后一天。
- 结账记录只查询；现金/银行转账是现有支付方式，不新建资金账簿。
- 原单、结账单、作废档案分开；保留角色、能力、作废确认和审计规则。
- 不改 API、数据库、金额计算、营业日归属、Cashier、MiniApp、平台后台。

## 验收

桌面 1440 / 1280 / 1024，手机 768 / 390，并补查 320 / 375 / 414。检查完整分析、日期与返回、分类搜索、表单与危险操作、只读结账、权限、长文本、无横向溢出、安全区。自动化本地结果与用户真实手机/PWA结果分别记录。
