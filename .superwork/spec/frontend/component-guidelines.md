# React 组件规范

## Purpose

约束 `apps/web` 内组件的职责、可访问性和渲染边界。

## Rules

- 每个组件只承担一个可描述的界面职责，紧凑工作台界面避免装饰性嵌套卡片。
- `shared/ai-elements` 以官方 AI Elements 组件源码和公开 API 为实现基线，只改造样式、基础控件适配与本地化文案以使用本项目设计 Token；不得用功能不完整的自研组件替代官方能力。
- Composer 使用 AI Elements `PromptInput`、`Attachments` 和组合式工具栏，支持点击、拖放、粘贴、预览与移除图片；附件选择是本地操作，在实时连接恢复期间仍保持可用，仅在正在提交时锁定；模型来自 Server Query，审批策略、模型和思考量随同一个 Turn 请求提交，不保留禁用占位控件。
- Composer 的审批、模型和思考量选择隐藏原生箭头并按当前文字收缩，思考量选项直接显示“低”“中”“高”等等级，不重复显示“思考量”前缀；思考量紧邻模型；任一内部控件聚焦时只由 Composer 整体显示主色边框，内部控件不重复显示主色焦点轮廓；分支/路径行最右使用圆环按钮表达真实上下文占比，悬停或键盘聚焦后通过 Tooltip 展示百分比和已用/总 Token 数。
- 工作台左栏先展示产品标识与名称，再按常显搜索框、“新建任务”、可选 `Pinned`、`Projects` 排列；没有固定 Task 时不渲染 `Pinned` 区域。
- Project 名称和右侧箭头都只切换任务树的展开状态，不导航或选中 Project；Task 链接继续负责工作台导航。
- 通过显式 Props 或专用 Hook 获取数据，不从组件内部访问 Server 或 Provider。
- 长列表使用稳定尺寸与虚拟化；流式 Item 独立订阅，避免整个 Task 重渲染。
- Task Timeline 必须显示失败 Turn 的归一化错误，并明确标识已截断的 Command Output，不能把错误或截断状态静默隐藏。
- Task Timeline 的用户消息和 AI 回复末尾都必须常显可访问的复制操作与本地时间；消息 Item 和相邻 Turn 之间保留明确纵向间距，不能让下一条用户消息贴住上一条回复。
- Timeline 展示 Task Snapshot 中的 Agent 文件操作，Inspector 则始终展示当前 Project 的真实 Git 未提交文件，并明确区分非空的未暂存与已暂存分组；变更总览固定在 Inspector 顶部，只有文件列表滚动，不展示未接通的提交入口。当前 Task 运行时 Inspector 定时刷新 Git 状态，停止运行后补做最终刷新。两处文件行都复用 Diff 弹窗；新增或删除文件的行数统计同时支持 Unified Diff 和 Provider 返回的完整文件内容，完整 Viewer 使用 `@pierre/diffs/react` 并仅在打开弹窗后动态加载，不能在消息内展开原始补丁或保留演示变更数据。
- 交互控件使用语义化元素并提供可访问名称、键盘行为和明确状态。
- Approval 使用 `Confirmation` 提供 Allow、Deny 和可用的 Session 级决策；网络审批必须明确显示目标 Host 与协议，不能依赖命令文本表达授权对象；User Input 的选择、确认和短文本分别使用 Radio、可切换 Button 和 Input，提交开始后立即禁用重复操作。
- 可能位于裁剪容器或视口边缘的 Tooltip 必须脱离局部层叠上下文渲染，并在桌面与窄屏中自动翻转、限制到视口安全边距；同时验证 Hover 和键盘焦点行为。
- `shared/styles/globals.css` 是颜色、字体、间距、圆角、阴影、动效和固定布局尺寸的唯一设计 Token 来源；组件使用语义化 Tailwind Token，不散落视觉字面值。
- 浅色与深色主题在同一语义 Token 中使用 `light-dark()` 定义，`data-theme` 只切换 `color-scheme`，禁止复制整套主题变量。
- 主题色固定为浅色 `surface #ffffff`、`ink #171717`、`accent #006aff`、`diffAdded #28a948`、`diffRemoved #eb001d`、`skill #a100f8`，深色 `surface #181818`、`ink #ffffff`、`accent #339cff`、`diffAdded #40c977`、`diffRemoved #fa423e`、`skill #ad7bf9`；浅色大面积区域保持纯白，不添加固定浅灰底。
- 工作台区域优先使用材质背景、淡阴影和留白区分层级，不使用贯穿面板的高对比边框；视口进入覆盖模式时关闭已打开的桌面面板。
- 永久 Sidebar 和 Inspector 使用连续同色背景，仅在其纵向边界添加低对比单像素分隔；三栏标题行使用相同高度并保持文字、图标垂直居中，侧栏顶栏不与下方内容分隔，主内容 Toolbar 的单像素底部分隔与左栏搜索框、右栏 Tab 的顶部对齐。不使用模糊或多层重阴影，浮动阴影只用于 Composer、弹层和独立表面。
- 视觉系统变更使用 Playwright 检查 computed style、桌面与移动溢出、窗口缩放和控制台错误。
- 只有形成稳定复用模式后才写入本规范。
