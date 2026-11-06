# 平台后台视觉提案生成记录

2026-11-05。使用内置 imagegen 生成评审图，用户确认配色方向后归档。图稿为示例数据，原 Logo 最终使用仓库原文件；布局、字段及必填规则继续确认。最新范围仅平台后台。

参考图分别为现有绿色 Logo 和用户指定 FloShot 首页截图，后者仅用于学习色彩关系与层次。提示词明确要求重新设计原始后台页面，不复制参考网站品牌、版式、产品图或文案。

## 运营总览

[归档图稿](visual-direction-overview.png)

```text
Use case: ui-mockup.
Create an original YunQiao PLATFORM ADMIN web console design review, landscape 2560x1600, crisp Chinese typography and professional desktop proportions. It is a high-craft working admin product, moderate information density, generous but efficient space, restrained Apple-like hierarchy.
REFERENCE IMAGE 1 is the exact existing circular green YQ cloud/book Logo. Preserve its green, white line art and proportions; use it small at top left with the exact word YunQiao. Do not redesign or recolor it.
REFERENCE IMAGE 2 is a third-party FloShot marketing website. Learn ONLY its multi-hue harmony, pale blue/lavender accents, warm clean whites, soft card depth, contrast and elegant visual polish. Create an entirely original YunQiao admin layout, original components and business content. Do not copy that site's layout, brand, illustrations, text or product screenshots.
Our proposed palette: mist-white canvas #F5F7FA, opaque white panels, pale lavender/ice blue/teal tints on small functional surfaces. Ink #222936; navigation/links and primary actions sober clear blue #416BD8; violet #7961C8 for content operations; teal #288F95 for merchant-related information; amber #A87925 for pending work; red only errors/danger. Existing Logo green #008E48 unchanged. Chart categorical colors stable and sparing. No multicolor numbers, no dark mode, no giant gradient hero. Very soft small blue/lavender edge wash permitted on compact KPI corners, never behind table text.
Application shell: white left sidebar ~215px, white top bar ~68px, thin neutral separators, clear active row with soft blue fill, understated rounded icons. Sidebar groups include 运营总览, 商家中心 with 商家列表/新增与导入, 内容运营 with 生活分类/首页推荐/标签库, 交易 with 订单管理/评价审核, 用户档案, 营业分析, 系统设置. Fit all groups with sensible typography, no empty decorative sidebar areas.
Top bar has breadcrumb, real-looking compact global search 搜索商家、订单、用户, small notification icon and avatar. Main headers have one primary action or compact period selector. Standard card radius14-18px, subtle diffuse shadow, no heavy outlines, readable chart axes and labels, right-aligned tabular currency.
All data is sample visual-review data; small footer 视觉提案 · 示例数据. No cashier, KDS, merchant-operated backend, consumer app or phone screens. This is platform-level management.
SCREEN: Full operational overview with 运营总览 active in sidebar, main title 运营总览, short quiet subtitle 今天的业务与待办，一眼看清. Top right date 今天 · 11月5日 and city 全部城市.
A compact four-column KPI row: 今日订单 379 单, 今日订单额 137,334,920 ₫, 活跃商家 18 家, 待处理 12 项. Values dark, tiny accent icons and small pale-blue/violet/teal/amber corner tones. Avoid distracting mini charts in every KPI.
Main middle row: broad 7日订单趋势 line chart on left, narrower 待办事项 on right. Main chart has clean date axis 10/30 10/31 11/01 11/02 11/03 11/04 11/05; y axis unit 单 and ticks 0 50 100 150. Blue real line with sensible varying heights, light gray dashed preceding-period comparison. Segmented selector 订单量 / 订单额 with 单量 selected. Tooltip around 11/03 displays 11月3日 70 单. Calm grid and visible baseline.
Pending card two actionable rows: 待审核评价 8, 商家资料待补 4, with small directional arrows and review context. Below it compact 快捷入口 links 新增商家, 批量导入, 内容预览 as proposed actual operations.
Lower row: 商家排行 table and 最近订单 table. Ranking includes Bắc Ninh, Bắc Giang restaurant names with realistic small venue thumbnails; columns 商家/订单/订单额 and 3 rows. Recent orders show three rows with order IDs, 门店, 堂食/自取/配送, textual statuses. Keep readable no excessive numbers.
The whole overview must feel calm yet distinctly richer than a monochrome green admin. A full screenshot-like product canvas, straight-on view, no computer hardware mockup, no outside title strip or explanatory arrows.
```

## 标签库

[归档图稿](visual-direction-tags.png)

```text
Use case: ui-mockup.
Create an original YunQiao PLATFORM ADMIN web console design review, landscape 2560x1600, crisp Chinese typography and professional desktop proportions. It is a high-craft working admin product, moderate information density, generous but efficient space, restrained Apple-like hierarchy.
REFERENCE IMAGE 1 is the exact existing circular green YQ cloud/book Logo. Preserve its green, white line art and proportions; use it small at top left with the exact word YunQiao. Do not redesign or recolor it.
REFERENCE IMAGE 2 is a third-party FloShot marketing website. Learn ONLY its multi-hue harmony, pale blue/lavender accents, warm clean whites, soft card depth, contrast and elegant visual polish. Create an entirely original YunQiao admin layout, original components and business content. Do not copy that site's layout, brand, illustrations, text or product screenshots.
Our proposed palette: mist-white canvas #F5F7FA, opaque white panels, pale lavender/ice blue/teal tints on small functional surfaces. Ink #222936; navigation/links and primary actions sober clear blue #416BD8; violet #7961C8 for content operations; teal #288F95 for merchant-related information; amber #A87925 for pending work; red only errors/danger. Existing Logo green #008E48 unchanged. Chart categorical colors stable and sparing. No multicolor numbers, no dark mode, no giant gradient hero. Very soft small blue/lavender edge wash permitted on compact KPI corners, never behind table text.
Application shell: white left sidebar ~215px, white top bar ~68px, thin neutral separators, clear active row with soft blue fill, understated rounded icons. Sidebar groups include 运营总览, 商家中心 with 商家列表/新增与导入, 内容运营 with 生活分类/首页推荐/标签库, 交易 with 订单管理/评价审核, 用户档案, 营业分析, 系统设置. Fit all groups with sensible typography, no empty decorative sidebar areas.
Top bar has breadcrumb, real-looking compact global search 搜索商家、订单、用户, small notification icon and avatar. Main headers have one primary action or compact period selector. Standard card radius14-18px, subtle diffuse shadow, no heavy outlines, readable chart axes and labels, right-aligned tabular currency.
All data is sample visual-review data; small footer 视觉提案 · 示例数据. No cashier, KDS, merchant-operated backend, consumer app or phone screens. This is platform-level management.
SCREEN: Full platform 内容运营 page, 标签库 active in sidebar. Demonstrate a substantial operational page with a 2/3 width tag-management table and a 1/3 width editing pane, all inside one coherent original desktop console.
Main title 标签库, short subtitle 统一管理运营、菜系与场景标签. Primary blue + 新建标签 button at top right, quiet 批量导入 next to it.
Top compact filter row: search 搜索名称或说明, tabs 全部 / 运营标签 / 菜系标签 / 场景标签; status 全部状态, secondary 更多筛选. Tiny applied tag 使用中 with clear ×. No massive KPI row.
Table columns checkbox, 标签, 类型, 关联商家, 状态, 最近修改, 操作. 6 clear rows of sample tags 热门推荐 / 越南菜 / 中餐 / 适合聚餐 / 深夜食堂 / 家庭友好. Types show colored small category badges stable teal/violet/blue. Status uses 启用 or 停用 with text. Counts 28/46/33/16/12/9, dates11/05. Visible 查看关联 or 编辑 per row, overflow for risky actions. Bottom pagination and 合计 36 个标签. No arbitrary maximum selection count.
The open right editing pane (within app content area, not outside screen) titled 编辑标签, showing 家庭友好 as selected row with subtle blue background.
Pane has labeled fields 中文名称 家庭友好, 越南文 Thân thiện với gia đình, 英文 Family friendly, 分类 场景标签, 标签说明 适合带孩子与家人一起用餐, 排序 20, 启用 toggle. A small preview group 显示预览 containing pale-blue and lavender text chips, readable not rainbow. Explain briefly 修改名称后，关联商家同步显示. Persistent bottom footer with secondary 取消 and blue 保存修改. Pane heading × close.
Below table in available space a compact related-content panel with 3 restaurant thumbnails, title 关联商家, simple shop names and view links. Original restaurant examples in Vietnam. All actions and microcopy should look deliberate.
This page must demonstrate consistent shared shell, organized rows, subtle hover/selection, tasteful restrained functional colors, no flashy effects. High-fidelity desktop screenshot, no external framing or instructional text.
```
