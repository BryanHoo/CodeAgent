# React 组件规范

## Purpose

约束 `apps/web` 内组件的职责、可访问性和渲染边界。

## Rules

- 每个组件只承担一个可描述的界面职责，紧凑工作台界面避免装饰性嵌套卡片。
- Web 不提供登录路由或账号控件；Provider 资源不可用时展示 `codex login` 指引和 Query 重试操作，不调用账号接口。
- `shared/ai-elements` 以官方 AI Elements 组件源码和公开 API 为实现基线，只改造样式、基础控件适配与本地化文案以使用本项目设计 Token；不得用功能不完整的自研组件替代官方能力。
- Composer 使用 AI Elements `PromptInput`、`Attachments` 和组合式工具栏，支持点击、拖放、粘贴、预览与移除图片；附件选择是本地操作，在实时连接恢复期间仍保持可用，仅在正在提交时锁定；模型来自 Server Query，审批策略、模型和思考量随同一个 Turn 请求提交，不保留禁用占位控件。
- Composer 的起始 `/` 输入使用 AI Elements `PromptInputCommand*` 在输入框外部向上浮出命令列表，不得把列表嵌入 PromptInput 表面；固定提供代码审查、初始化、副任务、压缩、反馈和在新任务中继续，并支持鼠标、上下方向键、Enter、Escape 和明确的 listbox/option 语义。代码审查、压缩、反馈和续接必须调用对应 Provider 能力；初始化与副任务复用正常 Turn 提交链路，不得在前端伪造执行结果。
- Composer 的审批、模型和思考量选择隐藏原生箭头并按当前文字收缩，思考量选项直接显示“低”“中”“高”等等级，不重复显示“思考量”前缀；思考量紧邻模型；任一内部控件聚焦时只由 Composer 整体显示主色边框，内部控件不重复显示主色焦点轮廓；分支/路径行最右使用圆环按钮表达真实上下文占比，悬停或键盘聚焦后通过 Tooltip 展示百分比和已用/总 Token 数。
- 工作台左栏先展示产品标识与名称，再按常显搜索框、“新建任务”、可选 `Pinned`、`Projects` 排列；没有固定 Task 时不渲染 `Pinned` 区域。
- `Projects` 标题右侧使用可访问的 `+` 图标触发宿主系统目录选择器；添加成功后刷新项目树并进入新 Project，取消选择保持当前界面，项目列表为空时不得伪造默认 Project。
- 左栏 Settings 旁的连接状态必须反映真实 Runtime：活动 Task 使用其实时事件连接状态，新建 Task 页面使用 HTTP Runtime 的加载、可用和失败状态；不得硬编码在线或离线文案。
- Project 名称只切换任务树的展开状态；名称右侧使用可访问的 `+` 图标进入该 Project 的“新聊天”草稿，顶部“新建任务”始终进入第一个 Project 的草稿，目标草稿已打开时直接复用。
- 新聊天草稿在首次提交前不得创建 Codex Task；空 Timeline 的 Project 名称直接渲染为原生 Project 选择器，首次点击必须打开选项列表，切换 Project 时保留 Composer 草稿，首次提交后再创建 Task 并由 Codex 返回的名称替换“新聊天”。
- 通过显式 Props 或专用 Hook 获取数据，不从组件内部访问 Server 或 Provider。
- 长列表使用稳定尺寸与虚拟化；流式 Item 独立订阅，避免整个 Task 重渲染。
- Task Timeline 必须显示失败 Turn 的归一化错误；Command 继续使用 `Tool` 表达调用和状态，输出使用 AI Elements `Terminal` 解析 ANSI、复制、流式跟随和自动滚动，并明确标识截断状态。历史输出保持只读，不提供清空操作；缺少输出时只能展示真实 `cwd`，不得伪造内容。
- 通用 Tool 必须使用 AI Elements `ToolInput` 与 `ToolOutput` 分区展示参数、JSON 结果和错误文本；`AgentItemStatus` 只在 Timeline 视图边界映射为 AI Elements Tool 执行状态，不向 Web 引入 `ToolUIPart` 或 AI SDK Runtime。
- Task Timeline 的 Plan Item 必须使用 AI Elements `Plan` 组合组件并原样展示计划文本；仅当它是运行中 Turn 的当前最后一个 Item 时启用 `isStreaming`，不得为展示状态扩展 Protocol 或使用 `Tool` 模拟 Plan。
- Task Timeline 仅将 `AgentItem` 中的 `activity` 映射为 AI Elements `Task`，按 Activity 状态映射进度；有 `detail` 时允许展开，没有 `detail` 时保持紧凑。不得继续用 `Tool` 模拟 Activity，也不得把 CodeAgent 的整个 Task 或 Turn 映射为 AI Elements `Task`。
- Task Timeline 的用户消息和 AI 回复末尾都必须常显可访问的复制操作与本地时间；消息 Item 和相邻 Turn 之间保留明确纵向间距，不能让下一条用户消息贴住上一条回复。
- Task Timeline 默认随 AI 流式内容自动滚动到最新位置；用户主动离开底部后暂停跟随，用户再次滚动到底部或使用“回到底部”操作后恢复自动跟随。
- AI 回复中的 Project 内绝对文件引用必须可点击打开只读源文件弹窗；带行号时定位并高亮对应行。源文件只通过 Server 受控接口读取，超长内容显示明确截断状态，页面不得直接访问本地文件系统。
- Timeline 展示 Task Snapshot 中的 Agent 文件操作，Inspector 则始终展示当前 Project 的真实 Git 未提交文件，并明确区分非空的未暂存与已暂存分组；变更总览固定在 Inspector 顶部，只有文件列表滚动，不展示未接通的提交入口。当前 Task 运行时 Inspector 定时刷新 Git 状态，停止运行后补做最终刷新。两处文件行都复用 Diff 弹窗；新增或删除文件的行数统计同时支持 Unified Diff 和 Provider 返回的完整文件内容，完整 Viewer 使用 `@pierre/diffs/react` 并仅在打开弹窗后动态加载，不能在消息内展开原始补丁或保留演示变更数据。
- 每次已结束的 AI 回复在末尾聚合该 Turn 已完成的文件变更，以卡片展示去重文件数和总增删行；单击文件继续打开单文件 Diff，“审核”则打开同一组文件的连续审核弹窗。连续审核必须提供明确的当前位置、上一个/下一个按钮、左右方向键和首尾禁用状态，并支持 Escape 与 backdrop 关闭。
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
