---
name: YunQiao Merchant Admin
description: Formal YunQiao analytics at home, Apple-like management everywhere else
colors:
  primary: "#1F7835"
  background: "#F1F5F1"
  surface: "#FBFDFB"
  foreground: "#183426"
  muted: "#5F6D65"
  outline: "#DFE8E1"
---

# Design System: YunQiao Merchant Admin

> 当前合同：`/dashboard` 与 `/business-analytics` 直接使用此前线上正式经营分析页，桌面与手机展示同一套完整内容。其他商家页面在功能、权限、接口和业务规则不变的前提下重构。先本地验收；未经新指令不 commit、不 push、不部署。

## Design thesis

首页是经营事实本身，不另造简化摘要，也不重新包装已正式使用的图表。管理页采用接近 Apple 工具型产品的秩序：安静背景、强标题、连续记录、清楚层级、少而准确的强调色。它借鉴 KiotViet 的信息架构与操作效率，但不复制其品牌，也不添加 YunQiao 尚不存在的功能。

## Visual language

- 颜色完全从正式经营分析页取值：`#F1F5F1` 页面、`#FBFDFB` 表面、`#183426` 主文字、`#5F6D65` 次文字、`#DFE8E1` 分隔线、`#1F7835` 操作绿、`#E5F4E8` 选中背景。
- 使用系统无衬线字体栈，优先 `-apple-system` / `BlinkMacSystemFont`；中文、越文、英文共享字号层级。
- 金额和数量使用等宽数字特性、稳定对齐；长名称和编号先收缩、截断并保留 `title`，不撑破布局。
- 管理页以细分隔、轻边框和留白分层，避免旧式深绿侧栏、重阴影、胶囊堆叠、玻璃拟态和装饰性渐变。
- 控件圆角约 9–10px，主要内容组 13–14px，弹层 16–18px；危险色仅用于删除、作废、停用等真实语义。

## Information architecture

桌面使用顶部品牌栏和主导航：`首页 / 菜品 / 订单 / 结账 / 桌台 / 更多`。页面内部以紧凑工具栏、目录或筛选、连续内容区和逐层详情组织，不把所有业务都套成 KPI 卡片。

手机与主屏幕 PWA 使用固定五栏：`首页 / 菜品 / 订单 / 结账 / 更多`。首页仍是完整正式经营分析；结账只查看结账与收款记录，不执行收银。桌台、店铺设置、员工和打印从“更多”进入，并始终提供应用内返回与安全区。

## Page patterns

- **首页**：正式 `BusinessAnalyticsPage` 原样作为唯一经营分析实现；正式日期筛选、资金概览、简报、趋势、时段分析、TOP5、占比和建议均保留。
- **菜品**：桌面为分类目录 + 固定布局表格；手机为连续图文行。详情和编辑逐层进入，保留新增、编辑、删除、上下架、售罄、单位和分类逻辑。
- **订单**：连续单据流水，状态、桌台/渠道、时间和金额分层；正常与作废记录明确区分，详情保留来源、处理轨迹和已有动作。
- **结账**：收款总览 + 只读结账流水；最终实收、支付方式、实际结账时间和来源订单分开呈现，不新增收款动作。
- **桌台**：状态筛选后的桌台目录；账单、创建、编辑、二维码各在清楚的抽屉或弹层中完成。
- **员工 / 设置 / 打印**：分别按团队名录、设置分区和设备/规则/模板/记录任务建模，不复用同一张通用大卡片。

## Responsive and interaction rules

- 必查宽度：1440 / 1280 / 1024 / 768 / 390，并补查 414 / 375 / 320。
- 桌面菜品表格不横向滚动；1440 / 1280 / 1024 的编辑与删除必须直接可见。
- 手机触控目标至少 44px，输入字号 16px，支持顶部和底部安全区；固定底栏不得遮挡保存动作或内容。
- 弹层关闭恢复焦点；详情返回恢复日期、筛选和来源链；共享弹层只由一个滚动锁拥有者管理。
- 加载、空数据、错误、无权限、禁用、成功和危险确认都要有明确状态。动画只表达状态，并尊重 `prefers-reduced-motion`。
- 内部分类或页签只有在确有必要时才允许自身滚动，绝不带动整页横向滚动。

## Implementation boundary

`src/styles/merchant-workbench.css` 管理商家后台外壳、tokens、基础控件、响应式导航和安全区；`src/styles/merchant-pages.css` 管理非首页页面结构。`.m-main--analytics` 与 `.m-main--management` 必须隔离，避免重构样式污染正式经营分析。

共享组件为 `MerchantIcon`、`MerchantDialog`、`MerchantDatePicker` 与 `useMerchantNavigation`。继续使用 Vue 3 / Vite / TypeScript 与现有 Chart.js；不引入 React、Next.js 或第二套图表库。不改 Cashier、MiniApp、平台后台、API、数据库或营业日/财务口径。
