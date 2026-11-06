# 平台电脑后台补充页面生图记录

2026-11-05。内置 imagegen 生成；仅设计评审，不是业务页面实现。源图20MB、统一优化、不保存源文件的图库修订，以及回收站，按用户最新确认追加。原生绿色Logo在实际实现中沿用仓库文件。

## 平台设置修订

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

Full platform settings page, 平台设置 active. Same approved shell, no logo subtitle, all navigation expanded. Main tabs 平台配置 /平台账号 /服务诊断 /操作记录 /指标口径.
Main identity strip YunQiao original greenLogo, 运营城市 北宁、北江, read-only 运营时区 Asia/Ho_Chi_Minh.
Important main card 平台经营总开关 with EXACTLY ONE large blue toggle in a clearly labeled row "经营能力总控" / "已开启". Short helper "控制平台经营能力；各商家的堂食、自取、配送分别配置". A small secondary link "前往商家能力设置" opens merchant selection. Below row neutral note "关闭总控保留商家原设置，重新开启后按原设置生效". Show modest 本次变更 summary only for master control and a blue 保存设置 button. Do NOT show three individual platform controls or three service toggles.
Right platform-account card3 generic sample accounts, each labeled 平台管理员; no other roles. Bottom cards service diagnostics API接口 未检测 /图片服务 未检测 and empty check times, 按需检查 button; operation records sample2026dates. No claim of actual measured service status.
Make the top-bar language picker open with three concise options 中文 (checked), Tiếng Việt, English. Keep language dropdown small and opaque, outside primary content. Consistent calm spacing, plenty of working room without huge empty panels.
```

## 商家账号与分项能力

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

Full dedicated edit page for 顺发餐厅. 商家列表 nav active. Header merchant photo/name, 展示中 badge. Local tabs 资料与营业时间 /图库与展示 /分类与标签 /账号与能力, last active.
A small read-only status strip "平台经营总控：已开启" with link 查看平台设置. This strip is not an editable platform switch here.
Main white card "本商家经营设置" with a clear table 能力 /商家设置 /当前生效. Rows 堂食 on ->已开启; 到店自取 off ->已关闭; 商家配送 on ->已开启; 扫码点餐 on ->已开启; 桌台管理 on ->已开启. The toggles belong only to THIS merchant. Use blue toggles for on, neutral for off, clear matching words. Show a concise sentence 关闭平台总控时保留本商家设置.
Lower compact base capabilities card 电话、导航、图库展示, independent per-merchant settings and labels. No new global service switches.
Right merchant-account card 账号已开通, masked login phone, current account 启用, normal 修改登录手机 link and low-emphasis 更多账号操作 menu, no giant danger button. Side info box "生效关系" with small labeled levels 平台总控 → 本商家设置 → 当前生效, not raw code identifiers.
Footer 保存商家设置 blue and 返回列表 secondary. It is a full edit page rather than drawer. Sample account/merchant data, no role-permission reconfiguration.
```

## 新增与批量导入

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

新增与导入 active in sidebar. Header 新增与导入, local tabs 快速新增 /批量导入, latter active. Main title 批量导入商家.
Four clear progress steps 上传文件 →列匹配 →核对数据 →导入结果, 核对数据 active. File strip 北宁商家资料.zip, 26行, 图片已关联, 更换文件 quiet.
Concise review counts 总计26 /可建草稿23 /待核对2 /缺少必填1. Small sentence 草稿只需店名与城市，导入后完善资料再发布.
Main editable-in-page validation table with checkboxes and columns 行号 /店名 /城市 /行业 /检查结果 /操作. Show6 sample rows: 青禾咖啡 北宁 咖啡茶饮 可建草稿 selected; 顺发餐厅 北宁 餐饮 疑似重复 unselected with 核对; 家味小馆 北江 餐饮 可建草稿 selected; one row 兰庭酒店 cityblank with 补充城市 action; two more selected valid rows. Do not print a new hard row-count cap or auto-overwrite rule. No guessed duplicate merge execution.
Below table a compact 列匹配摘要 店名→商家名称, 城市→运营城市, 图片目录→图库 with 调整映射 link. Footer 已选择23行, primary 导入23家为草稿, secondary 上一步, 导出检查结果. Explicit preview result, not production import executed. Only checked valid rows proposed; duplicates remain awaiting choice. One main table, no oversized decorative KPI blocks.
```

## 商家基础资料与营业时间

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

Full dedicated merchant edit page for 青禾咖啡, state 草稿. 商家列表 sidebar active. Tabs 资料与营业时间 active /图库与展示 /分类与标签 /账号与能力.
Main form ~70% width, publish-check column~30%. Form section 商家资料: Chinese name 青禾咖啡, Vietnamese name Cà phê Thanh Hòa; English optional collapsed input labeled 英文（选填）. City 北宁, industry 咖啡茶饮, contact person 林先生, sample masked phone. Address Chinese 越南北宁省北宁市示例路88号 and corresponding Vietnamese sample address. Coordinates small numeric fields with label 地图定位 and 选择位置 button, no elaborate invented real basemap.
Description Chinese 咖啡、轻食与舒适的聚会空间; Vietnamese description field blank visibly marked 待补充. Keep English optional, never required.
Second form section 营业时间 uses simple weekly schedule e.g. 每天10:00–22:00 with 编辑每周时间 link, not a limited2-interval error warning.
Right 发布检查 with "1项待补" /越南文介绍, and completed items 店名与城市 /行业与联系资料 /地址与定位 /封面与展示内容 /营业时间. Rule note 中文和越南文齐全后可发布，英文选填. Quiet 草稿仅需店名与城市.
Footer 保存草稿 active blue, 发布商家 disabled neutral with 补齐1项后可发布 caption. Current state is not publicly displayed, no falsely active saved update button. Medium-density readable form, no long form inside a drawer.
```

## 用户档案与订单关系

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

用户档案 active. Header 用户档案. Compact search 用户昵称、手机号或ID, 全部城市, 注册时间 dropdown, 查询, 更多筛选. Minimal counts no invented engagement score.
Main65% table: 用户 /所在城市 /注册时间 /订单数 /最近活动 /操作. Five sample users 林先生, 小玲, 阿强, 梅子, 陈先生 with small tasteful avatars, masked sample phones as secondary text, cities北宁北江, full dates2026, counts12/8/6/3/2, 查看 action. Selected 林先生 row paleblue.
Right35% read-only 用户速览: avatar 林先生, ID U1024, city 北宁, masked sample phone, 注册2026/09/12. Small actual-like order summary 全部12 /已完成10 /取消2, 已完成订单额3,250,000 ₫. A recent-order mini table with3 rows, orderIDs and 查看 links. Link 查看全部12笔订单 and 打开完整档案. No delete/ban/reset-user-password controls, no irrelevant technical OpenID.
The links and counters are explicitly sample data. Consistent global header language picker 简中 and full expanded navigation. Table content readily scannable with dates/money aligned; right panel is not editable.
```

## 生活分类与发布预览

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

生活分类 active. Header 生活分类. Main actions 新增分类, 保存草稿, 预览, 统一发布; small 待发布2项 badge.
Context 全部城市 or 北宁 preview scope clearly separate. Main left2/3 white category-configuration table with rows 餐饮美食 /咖啡茶饮 /休闲娱乐 /酒店住宿 /生活服务 /运动休闲. Columns 排序 /分类名称 /关联行业 /商家数 /展示状态 /操作. Drag handles, crisp small category glyphs, merchant counts and simple 启用 labels, 查看/编辑 links. Editing a full record uses a page; this table shows ordering and overview rather than long inline forms.
Right1/3 read-only panel "北宁 · 分类效果预览" with an understated3×2 grid of category names/icons, not a redesigned mobile app frame. Below "影响范围" summary affected categories2 /查看关联商家 link and current versus pending display label.
A bottom change list 分类顺序调整, 分类名称更新, all labeled 未发布. Publish acts on previewed draft changes; no automatic save-to-live promise. Existing navigation and original green brand stay exactly consistent. No deep category permission restrictions or all-merchants reload animations.
```

### 局部校正

```text
Use case: precise-object-edit. Make two targeted consistency corrections in this YunQiao category-management screenshot. In the left app navigation, remove the active blue fill and blue text from 运营总览 so it becomes a neutral unselected item; keep 生活分类 as the ONLY active sidebar item. In the main category table replace only merchant-count numbers in row order with 餐饮美食46, 咖啡茶饮18, 休闲娱乐14, 酒店住宿9, 生活服务28, 运动休闲13. These are sample counts totaling128. Keep everything else including all6categories, preview icons and labels, two pending changes, original greenLogo and YunQiao only, desktop layout, language dropdown, spacing and color palette unchanged.
```

## 行业与默认能力

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

行业与能力 active. A full dedicated industry configuration page headed 行业与能力 /餐饮. Clear industry tree/navigation list in narrow content rail: 餐饮美食 with 餐饮 selected and 咖啡茶饮; 酒店住宿;休闲娱乐;生活服务;运动健身. This content rail is distinct from app sidebar, with natural indentation and no fake sub-role selector.
Main full-page form editing 餐饮: 中文名称 餐饮, 越南文 Ẩm thực, 英文 Food & Dining (optional), 父级 餐饮美食, 排序10, 启用 toggle, 默认模式 资料展示. Actual field names not internal codes.
Lower card 新商家默认能力, concise explanatory text 用于新建商家，已有商家配置保持. Simple checkbox grid 电话 on, 导航 on, 图片展示 on, 到店自取 off, 商家配送 off, 扫码点餐 off, 桌台管理 off, 打印 off. Label defaults clear, not platform-global capability switches.
Side compact 关联商家46家 with 查看关联商家, plus note 商家独立设置可单独维护. Footer 保存行业配置 blue /取消 secondary. No bulk overwrite-existing-merchants checkbox. No long edit drawer. Original brand, desktop spacing, readable multilingual text, neutral borders.
```

### 局部校正

```text
Use case: precise-object-edit / text-localization. Clean up unneeded required-field stars in this YunQiao industry configuration screenshot. Keep the red required star ONLY for 中文名称. Remove red required stars from 越南文, 父级, 排序, 启用 and 默认模式. Vietnamese and English names are optional in this industry dictionary; optionally mark 越南文（选填） compactly if it fits. Keep all current field values, default-mode settings, all checkboxes, existing-merchant preservation note, original greenLogo, colors, layout, right related-merchant panel and navigation unchanged. Do not introduce any new rules or controls.
```

## 公共标签完整编辑

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

标签库 active. Dedicated full edit page, breadcrumb 内容运营 /标签库 /编辑标签. Header 编辑标签, small 未发布修改 badge, not a drawer.
Two-column main form and change-preview summary. Form labels 中文名称* value亲子友好, 越南文 valueThân thiện với gia đình, 英文（选填） valueFamily friendly, 类型 场景标签, 说明 适合家庭聚餐与带孩子用餐, 排序20, 启用 toggle on. Do not place required stars on English or add binding-count limits.
Right READ-ONLY "影响预览" with 当前生效：家庭友好; 待发布：亲子友好; 影响9家商家; link 查看关联商家. Show3 sample associated restaurant names and small thumbnails with 查看全部9家. Clear sentence 发布后所有关联商家同步显示新名称. A small preview chip亲子友好.
Footer secondary 保存草稿 /预览影响 and main 统一发布. No alternate per-merchant rename, no change-ID/code field, no new local-label model. Blue primary, purple scene-tag chip, originalLogo and expanded sidebar. Interface language dropdown简中 is visible, English content optional separate from UI language.
```

### 局部校正

```text
Use case: precise-object-edit. Correct only the selected sidebar state in this existing YunQiao tag edit screenshot. Remove the blue selection background/blue text from 运营总览; render it neutral like the other inactive navigation entries. Keep 标签库 as the ONLY selected sidebar entry. Preserve all form fields, preview, counts, footer, original greenLogo+YunQiao, language control, composition, typography and every other element.
```

## 平台管理员登录

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

Login page exception: no app sidebar, no global data search or logged-in avatar. A calm desktop YunQiao platform admin login screen, white/mistwhite backdrop, sparse refined composition, original greenLogo plus exactYunQiao at top-left with NO subtitle under brand.
Centered opaque white compact login card about440px wide, header 平台管理员登录 as the card heading, separate from brand. Labeled account field 账号 and password field 密码 with eye icon, clean blue 登录 button; no actual credentials or sample password. A small empty inline error-reserved area but no false failure alert. No social logins, signup or automatic password-recovery feature.
Top-right language picker简中 open to 中文 selected /Tiếng Việt /English. Bottom small 设计评审, no invented legal claims, no server status. A gentle pale-blue/lavender edge tint or very faint texture is permissible but no giant glow, imagery hero, animated galaxy, glass effect or huge marketing copy. Professional, focused access screen consistent with approved admin palette and original greenLogo.
```

### 局部校正

```text
Use case: precise-object-edit. Remove the unlabeled pale gray/blue rounded horizontal empty strip located BETWEEN the password field and the blue 登录 button in this YunQiao login screenshot. It is not an input and should not be visible. Leave that region as the clean white card background; move the 登录 button upward slightly for a normal32px gap below the password field, and compact the card height accordingly if helpful. Keep exactly two labeled inputs 账号 and 密码 with the eye icon, original greenLogo+YunQiao, title平台管理员登录, blue 登录 button, all3language options and current design palette unchanged. No third input, no empty progress bar, no additional features.
```

## 图库20MB与自动优化修订

```text
Use case: precise-object-edit. Edit only upload-policy controls and helpful copy in the referenced YunQiao gallery screenshot. It is the approved existing gallery image, not a new page layout.
Remove the whole two-option "上传方式 自动优化 / 原图" segmented control. Replace that same small area with a simple noninteractive caption "自动优化 · 单张最多20MB" and an info icon. There must be NO 原图 option or original-preservation mode.
In the upload zone keep 拖放图片或选择文件. Under it use two concise lines "支持多选 · 单张最多20MB" and "上传后自动优化，不保留上传原图". Preserve the photo aspect ratios and all six images, all4filters 全部39/门面3/环境24/菜品12, upload success/failure queue and retry, publishing-check panel with2missing items, existing saved/published state, brand and fully expanded nav. Add a small closed 简中 language picker to the topbar if needed, preserving search and avatar. No source-code details or file-format internals on the product page. Everything else unchanged.
```

## 商家回收站与恢复预览

```text
Use case: ui-mockup.
Create one refined high-fidelity YunQiao PLATFORM ADMIN desktop screenshot, original design, landscape 2560x1600, straight-on, sharp Chinese typography and professional working product proportions. This is a design-review image using sample data, not production.
REFERENCE 1 supplies the already approved overall visual direction: mist white canvas #F5F7FA, opaque white cards and white left navigation, ink #222936, information/action blue #416BD8, small violet #7961C8 and teal #288F95 supporting accents. Preserve this visual family, improve craft and readability. Small pale-blue/lavender card-edge tints, diffuse restrained shadows, medium density,14–18px corners, neutral 1px separators. No large decorative hero, no luminous effects, no dark theme, no huge empty header.
REFERENCE 2 is the exact existing circular green YQ cloud/book Logo, preserve its green #008E48 and line drawing. Top left has ONLY this small original Logo + exact text "YunQiao". No small subtitle, no PLATFORM ADMIN, no 平台后台 subtitle, no slogans below logo.
ALL navigation groups are permanently expanded. Use small muted group captions, no collapse chevrons. Fixed visible sidebar order: 运营总览; group 商家中心 with 商家列表 and 新增与导入; group 内容运营 with 生活分类, 首页推荐, 标签库; group 交易 with 订单管理, 评价审核; group 用户 with 用户档案; group 数据 with 营业分析; group 系统 with 行业与能力, 平台设置. Fit all items in image with compact sensible row height, clear active row, ample main space.
Top chrome: short breadcrumb, compact search "搜索商家、订单、用户", compact language dropdown 简中, notification icon, avatar with 平台管理员. The UI supports 中文 / Tiếng Việt / English, current image is Chinese. Standard platform identity, no additional permission-role switcher.
Keep color functional, table text and values dark, primary buttons blue, danger red only where necessary, blue/violet/teal category fills pale and sparse. Money and count columns aligned. Buttons are intentional not browser default. No laptop hardware, no phone screens, no merchant-operated cashier/KDS/customer app panels, no third-party product visuals or copied marketing site layout.
Sample footer small "设计评审 · 示例数据". Tables and graphs should be legible, not filler. Preserve sample facts where supplied; do not label completed order amount as revenue, cash receipts or settlement. Charts use 百万 ₫ when monetary; cards/tables/details show complete VND integers. No fake mini-charts beside every metric. Minimal Chinese text with exact supplied labels.
List record right panes are READ-ONLY quick views; full forms/editing occur in dedicated pages. No long editing form in a quick drawer. All nav entries remain visible in every image.
This round targets DESKTOP platform admin only. No mobile layout or screens. Use sample dates2026-11-05 where dates are visible. Platform-wide operational control is ONE master only; dining/pickup/delivery switches are PER MERCHANT, not three new platform-global switches. No role-based permission settings.

Full desktop page 商家回收站. 商家列表 is the ONLY active sidebar item, all groups expanded and 运营总览 neutral.
Header 商家列表 /回收站. Merchant view tabs 全部 /展示中 /草稿 /已隐藏 /回收站, last active. Compact search 店名或ID, 城市全部, 删除时间近30天 and 查询.
Main left two-thirds table3sample deleted merchants 兰庭酒店 北宁 /清风茶室 北宁 /悦康理疗 北江, columns checkbox, 商家, 城市, 删除时间, 删除人, 关联订单, 操作. Use2026dates and generic平台管理员actor. Firstrowselected, shows14relatedorders. Operation 恢复 and 查看. No physical/purge/permanent-delete or empty-bin button.
Right READ-ONLY panel 恢复预览 with 兰庭酒店, 删除时间2026/11/03, 关联订单14 /图片8. Clear resulting states "恢复后展示：隐藏" and "商家账号：继续停用". Helpful short text "资料与历史关联保留；重新展示需完成发布检查". Existing metadata unaffected; no identity reset, new-account creation or auto-publication.
Bottom of preview secondary取消 and blue "恢复为隐藏商家". Above buttons a small confirmation phrase only informational, not fake external operation completed. No green 已恢复 success state. Full amount data absent since this is recovery not transactions. OriginalgreenLogo+YunQiao, closed简中 picker, white/blue/violet/teal palette, moderate data density. Footer设计评审·示例数据.
```
