# HuayueLife-MVP Codex 协作规范

## 项目基线

- 本仓库是当前有效项目，路径为 `~/Desktop/HuayueLife-MVP`。
- 不要修改 `~/Desktop/HuayueLife` 旧项目，除非用户明确要求。
- 开始任务前阅读 `PROJECT_CONTEXT.md` 和相关 `docs/` 文档。
- Monorepo 使用 pnpm workspace。
- MiniApp 使用 `UniApp + Vue 3 + TypeScript + Pinia`，首发微信小程序。
- 商家后台使用 `Vue 3 + Vite + TypeScript`。
- API 使用 `NestJS + Prisma + MySQL`。
- 不得引入 React、Next.js、Shadcn React 组件或 React DOM 依赖。

## UI Design Agent

开发或重构 MiniApp 页面时，优先级依次为：

1. 用户体验
2. 视觉一致性
3. 商业产品感
4. 餐饮行业习惯

输出页面代码前，必须先说明：

1. 页面目标
2. 用户场景
3. 页面结构
4. 设计理由

说明必须结合华越优选的实际点餐场景，再开始编写代码。

## MiniApp 设计方向

- 清爽、年轻、有餐饮感、健康、舒服。
- 保持微信小程序风格，强调快速浏览、扫码点餐和下单效率。
- 可参考轻量版美团或饿了么的信息组织，但不是红色平台风格。
- 使用卡片化布局、大图片、少而有效的文字、清晰价格和强操作按钮。
- 圆角范围为 `12-20px`，默认卡片圆角建议 `16px`。
- 使用统一轻量阴影，优先通过留白、背景层级和卡片分组建立层次。
- 避免后台管理系统感和纯扫码工具感。

## MiniApp 品牌色

- 主色：`#43A047`
- 辅助深绿：`#2E7D32`
- 浅绿色背景：`#EAF7EE`
- 页面背景：`#F6FAF7` 或 `#F8FBF8`
- 白色卡片：`#FFFFFF`
- 橙黄色点缀：`#FFB74D`
- 主文字：`#1F2D24`
- 次级文字：`#666666`
- 浅灰边框：`#EEEEEE` 或 `#F0F0F0`

红色仅可用于错误、危险和取消等语义状态，不得作为品牌主色或大面积视觉背景。

## UI 禁止项

- 不要大面积使用红色，不要采用美团红方向。
- 不要将 `#C62828` 作为主品牌色。
- 不要使用医院感浅绿、大面积深墨绿或荧光绿。
- 不要交付纯技术演示页面。
- 不要保留默认浏览器按钮、输入框、列表和链接样式。
- 不要使用大量边框切割页面。
- 不要生成典型 AI 模板风格，包括无业务意义的大渐变、发光、悬浮装饰和过度玻璃拟态。
- 不要为了视觉效果牺牲可读性、操作效率或微信小程序兼容性。

## UniApp 跨端规则

- 使用 UniApp 支持的 Vue 模板、组件和 API，不直接依赖浏览器 DOM。
- 页面结构优先使用 `view`、`text`、`image`、`scroll-view` 等跨端组件。
- MiniApp 尺寸优先使用 `rpx`，并适配安全区域。
- 新增通用 UI 优先放入 `apps/miniapp/src/components`。
- 共享视觉变量应集中管理，避免页面中持续增加重复魔法值。
- 图片必须处理比例裁切、加载占位和加载失败状态。
- 页面需要考虑正常、加载、空数据、错误、禁用和长文本状态。

## MCP 使用规则

- `shadcn` MCP 仅用于检索组件结构、布局和设计参考。
- 禁止通过 Shadcn MCP 安装 React/Next.js 组件或改写本项目技术栈。
- Shadcn 设计必须转换为 UniApp + Vue 3 + TypeScript 实现。
- `context7` MCP 用于查询 UniApp、Vue、Pinia、TypeScript、Vite、NestJS 和 Prisma 文档。
- MCP 内容实施前必须与本仓库实际依赖版本核对。

## 验证要求

- MiniApp 改动后运行：
  - `corepack pnpm --filter @huayue-life/miniapp typecheck`
  - `corepack pnpm --filter @huayue-life/miniapp build:mp-weixin`
- 跨模块改动运行：
  - `corepack pnpm typecheck`
  - `corepack pnpm build`
- 若验证无法运行，必须说明原因。
- 不覆盖或回退与当前任务无关的用户改动。
- 未经用户明确要求，不提交、不 push。
