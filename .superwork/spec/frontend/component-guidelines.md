# React 组件规范

## Purpose

约束 `apps/web` 内组件的职责、可访问性和渲染边界。

## Rules

- 每个组件只承担一个可描述的界面职责，紧凑工作台界面避免装饰性嵌套卡片。
- 工作台的项目打开控件使用分段按钮：左侧不显示图标，只显示“在 <应用名称> 中打开”并执行当前选择；右侧 `ChevronDown` 只负责打开应用菜单，hover 不得自动展开。菜单项只能来自 Server 返回的当前宿主应用目录，选择按 Project 写入版本化浏览器偏好，并支持 ArrowDown、Escape、焦点离开和外部点击；Project 没有本地偏好时依次使用全局默认和首个可用应用。
- Inspector Project 文件树的文件与目录节点使用右键菜单复用同一宿主应用目录；右键目标立即进入文件树选中高亮态，菜单顶部显示“打开方式”和当前目标路径。菜单项是立即打开目标的命令，不修改中栏保存的默认应用。菜单必须脱离滚动容器裁剪并限制在视口内，打开后聚焦首项，支持 Escape 和外部点击关闭，请求期间禁用重复操作。
- Web 不提供登录路由或账号控件；Provider 资源不可用时展示 `codex login` 指引和 Query 重试操作，不调用账号接口。
- `shared/ai-elements` 以官方 AI Elements 组件源码和公开 API 为实现基线，只改造样式、基础控件适配与本地化文案以使用本项目设计 Token；不得用功能不完整的自研组件替代官方能力。
- Task Timeline 不展示原生 Reasoning Item 或 Chain of Thought；Codex Commentary 与 Final Answer 都作为普通 Assistant Message，通过 `MessageResponse` 实时流式展示。Command、Tool 等结构化 Item 保持独立可见，不包裹进思考容器。新聊天首次提交开始后必须立即显示通用运行状态，不等待 `startTurn` 返回；运行中的 AI 回复必须在回复最后一行始终使用 AI Elements `Shimmer` 表达持续生成状态。存在运行中的 Command、Tool、Activity 或流式 Plan 时，在“正在运行”后直接追加 Codex Item 的原始操作名称，其中 Command 同时显示终端图标，不得解析 `commandActions` 生成映射文案；快速操作已完成但 Turn 仍在运行时继续以 Shimmer 显示最近原始操作，不切换成完成文案；没有结构化操作时回退为通用运行状态，并在 Turn 结束后移除。原始操作名称变化时只能更新 Shimmer 文本，必须保留同一 DOM 与动画时间轴，不得按文案长度改写扫光参数。
- Composer 使用 AI Elements `PromptInput`、`Attachments` 和组合式工具栏，支持点击、拖放、粘贴、预览与移除附件；纯文本粘贴严格超过 1,000 个 Unicode 字符时生成名为 `Pasted text.txt` 的 `text/plain` 附件，不把全文写入编辑器，等于阈值和更短文本保持普通光标插入；草稿输入与附件选择是本地操作，在实时连接恢复期间仍保持可用，仅在正在提交时锁定，提交和设置等网络控件继续暂停；模型来自 Server Query，审批策略、审批审核方、沙盒模式、模型和思考量随同一个 Turn 请求提交，不保留禁用占位控件。
- Composer 文本草稿必须在 Runtime 重渲染期间保留浏览器的 IME 组合缓冲，不能通过受控内容回写覆盖尚未触发 `input` 的临时文本；已有 Task 之间切换时必须复用同一个编辑区域 DOM 节点，并按 `projectId + taskId` 分别保存和恢复草稿、附件及 Skills，新聊天使用 Project 独立草稿；Task Snapshot 加载产生的 `connecting` 或 `reconnecting` 状态不得把该节点设为不可编辑，不能通过父级重挂载或短暂禁用破坏原生输入法上下文；程序化清空或替换草稿时仍需同步真实编辑区域，并使用 `compositionstart` 后触发重渲染及切换 Task 的 Playwright 用例覆盖中文首键。
- Composer 在已有 Task 中使用 Snapshot 携带的完整设置，在新聊天中按 Project 显式默认优先、Global 默认回退初始化完整设置；沙盒选择紧邻审批并提供只读、工作区可写和完全访问；设置只由用户事件触发完整对象 Mutation，不得通过 effect 写回或从其他 Task 继承审批。
- 活动 Turn 运行时，Composer 的非空提交必须按 Global `followUpBehavior` 选择排队或即时引导，空输入继续执行中断。排队项按 `projectId + taskId` 隔离并在 Composer 输入框外部上方按 FIFO 展示，每项提供带 Tooltip 的立即引导和取消图标；当前 Turn 结束后自动启动队首消息，失败时保留原项。文本、Skill 和附件引用必须随队列项保存，附件仅在实际发送时上传，发送、取消或 Draft Store 释放时清理不再使用的预览 URL。
- Composer 在文本开头或空白字符后的 `/` 输入使用 AI Elements `PromptInputCommand*` 在输入框外部向上浮出分组列表，连续正文字符后的 `/` 仅作为普通字符；不得把列表嵌入 PromptInput 表面。列表先固定提供代码审查、初始化、副任务、压缩、反馈和在新任务中继续，再在命令组下方展示当前 Project 由 Server 返回的可用 Skills，并支持鼠标、上下方向键、Enter、Escape、点击输入框与列表之外区域关闭，以及明确的 listbox/option 语义。Skill 描述固定为单行省略；键盘高亮移动到滚动区域外时必须自动滚动到可见位置。每次选择 Skill 只替换当前 Slash 片段并保留已有正文，允许在正文任意位置插入多个有序 Token；Token 使用 `accent` 主色和展示名，内部值与复制文本固定序列化为 `$<skill.name>`，可点击或使用邻接删除键移除。提交按 Token 顺序携带结构化不透明引用，不把 `$name` 拼接进普通正文，也不得接触原生路径。代码审查先选择未提交更改或基础分支，基础分支列表必须来自当前 Project 的真实 Git 状态；代码审查、压缩、反馈和续接必须调用对应 Provider 能力；新聊天中的代码审查先创建空 Task，再直接启动 Review，不能伪造用户消息或普通 Turn；初始化与副任务复用正常 Turn 提交链路。
- Composer 的批准模式、模型和思考量选择隐藏原生箭头并按当前文字收缩；批准模式中的“自动审批”必须映射为 `on-request + auto_review`，切换到其他模式必须恢复 `approvalsReviewer: "user"`，不得把 `never` 当作自动审批；思考量选项直接显示“低”“中”“高”等等级，不重复显示“思考量”前缀；思考量紧邻模型；任一内部控件聚焦时只由 Composer 整体显示主色边框，内部控件不重复显示主色焦点轮廓；分支/路径行最右使用圆环按钮表达真实上下文占比，悬停或键盘聚焦后通过 Tooltip 展示百分比和已用/总 Token 数。
- 工作台左栏先展示产品标识与名称，产品标识只承担展示职责，不提供导航或新建任务交互；浏览器 favicon 必须与左栏 `CA` 方块标识保持相同的尺寸比例、圆角、字体和深浅主题配色；再按常显搜索框、“新建任务”、可选 `Pinned`、`Projects` 排列；没有固定 Task 时不渲染 `Pinned` 区域。
- `Projects` 标题使用高于分组元数据的字号并固定在项目树滚动区域之外；Project 行之间不增加分组间隔。每个 Project 的 Task 首屏只请求并展示最近 5 项；“显示更多”每次只按该 Project 的 Cursor 请求一个下一页，加载失败保留已有 Task 并允许重试，全部加载后可通过同样的整行控件收起。归档后必须重新校准对应 Project 的 Cursor 页面并自动补足最近 5 项。非空搜索按需读取所有 Project 的完整 Task 分页后再匹配标题，不得只过滤当前已经渲染的 Task；搜索加载和失败状态必须明确可见。
- Project 名称行在指针移动超过点击容差后立即进入拖动排序，不设置固定长按等待；点击容差内只切换对应任务树的展开状态，不改变当前中栏或路由；释放后保存完整 Project 顺序并播报结果；键盘必须提供 `Alt + ArrowUp/ArrowDown` 等价操作。排序过程中只保留瞬时顺序，保存失败恢复 Server 顺序并显示可见错误。
- Project 文件夹在没有本地偏好时只默认展开第一个；用户展开或收起后必须将完整展开形态保存到版本化浏览器存储，并在下次打开时按 Project ID 恢复。存储不可用或内容损坏时回退到默认形态，不能阻断侧栏交互。
- Task 行常态在最右侧显示更新时间；运行时在同一位置显示带可访问状态的旋转加载图标。非当前 Task 收到审批请求时在该位置显示审批标记，AI 回复完成后显示完成标记，回复异常中断或遇到不可恢复错误后显示未完成标记；重试中的错误不产生未完成标记。用户进入对应 Task 后立即消费标记，当前 Task 不重复显示提醒。鼠标悬停或键盘焦点进入后在同一稳定位置显示省略号操作；菜单必须脱离 Pinned 与 Projects 滚动容器的裁剪，左边缘与当前省略号按钮对齐。菜单提供固定/取消固定、重命名和归档，支持 Escape 与点击外部关闭。重命名使用带焦点圈定的 Dialog，归档当前 Task 后进入所属 Project 的新聊天草稿。
- 中栏已有 Task 标题使用带 `Pencil` 图标的可访问按钮打开同一重命名 Dialog；保存成功后同步更新中栏、`Pinned`、`Projects` 与已加载的搜索源，失败时保留 Dialog 并显示错误。新聊天标题保持只读。
- 浏览器获得系统通知权限后，仅当页面隐藏或浏览器窗口失焦时，Task 完成、不可恢复中断或错误、等待审批及等待用户输入才发送系统通知；通知标题必须包含来自 Snapshot 或 Project Task Query 的最新 Task 名称，不能展示原生 Task ID。点击通知聚焦页面并进入对应 Task。首次 Prompt、Review 或 Compact 启动时在当前用户手势内申请权限，权限不可用不得阻断 Task 操作。
- `Projects` 标题右侧使用可访问的 `+` 图标触发宿主系统目录选择器；添加成功后刷新项目树并进入新 Project，取消选择保持当前界面，项目列表为空时不得伪造默认 Project。
- 左栏 Settings 旁的连接状态必须反映真实 Runtime：活动 Task 使用其实时事件连接状态，新建 Task 页面使用 HTTP Runtime 的加载、可用和失败状态；不得硬编码在线或离线文案。
- 左栏 Settings 必须使用按钮在当前工作台打开可访问的原生 Dialog，不注册独立设置路由。弹窗使用 macOS 设置式双栏，将字段归入“外观”“Agent 默认值”“提交消息”“应用集成”，窄屏改为顶部横向分类；模型与思考量使用带边界和 Chevron 的 AI Elements `PromptInputSelect`。Dialog 必须支持加载、失败重试、全局设置完整对象原子保存、Escape、backdrop 与关闭后焦点恢复。
- Project 名称只切换对应任务树的展开状态；名称右侧的可访问 `+` 图标进入该 Project 的“新聊天”草稿，顶部“新建任务”始终进入第一个 Project 的草稿，新增文件夹后进入该 Project 草稿，目标草稿已打开时直接复用。新聊天入口只能重置中栏和切换 Project，左栏不得出现临时“新聊天”Task。
- 新聊天草稿在首次 Prompt 提交或代码审查命令执行前不得创建 Codex Task；空 Timeline 的 Project 名称直接渲染为原生 Project 选择器，首次点击必须打开选项列表，切换 Project 时保存当前 Project 草稿并恢复目标 Project 草稿。首次提交后，`startTask` 返回真实 `taskId` 时立即把 Task 写入对应 Project 列表并选中，`startTurn` 成功后再进入 Task 路由并由 Codex 返回的名称替换“新聊天”。
- 通过显式 Props 或专用 Hook 获取数据，不从组件内部访问 Server 或 Provider。
- 长列表使用稳定尺寸与虚拟化；流式 Item 独立订阅，避免整个 Task 重渲染。
- Task Timeline 必须在该 Turn 已产生的消息与结构化结果之后显示归一化错误，使部分回复与最终失败原因保持同一阅读顺序；Command 继续使用 `Tool` 表达调用和状态，输出使用 AI Elements `Terminal` 解析 ANSI、复制、流式跟随和自动滚动，并明确标识截断状态。历史输出保持只读，不提供清空操作；缺少输出时只能展示真实 `cwd`，不得伪造内容。
- 通用 Tool 必须使用 AI Elements `ToolInput` 与 `ToolOutput` 分区展示参数、JSON 结果和错误文本；`AgentItemStatus` 只在 Timeline 视图边界映射为 AI Elements Tool 执行状态，不向 Web 引入 `ToolUIPart` 或 AI SDK Runtime。Command 与通用 Tool 无论运行或终态都必须默认收起，并在摘要中保留当前状态；参数、输出、错误和 Terminal 只在用户首次展开时挂载，重新折叠后立即卸载。
- Task Timeline 的 Plan Item 必须使用 AI Elements `Plan` 组合组件并原样展示计划文本；仅当它是运行中 Turn 的当前最后一个 Item 时启用 `isStreaming`，不得为展示状态扩展 Protocol 或使用 `Tool` 模拟 Plan。
- Task Timeline 仅将 `AgentItem` 中的 `activity` 映射为 AI Elements `Task`，按 Activity 状态映射进度；有 `detail` 时允许展开，没有 `detail` 时保持紧凑。不得继续用 `Tool` 模拟 Activity，也不得把 CodeAgent 的整个 Task 或 Turn 映射为 AI Elements `Task`。
- Codex 子代理协作使用统一 `agent/*` Tool 数据；中间 Timeline 只用不可交互的 AI Elements `Task` 展示操作名称、数量与聚合状态，不展示任务正文、模型或子线程 ID。右侧 Inspector 的“上下文”页签必须提供“子代理”栏目，按唯一子线程 Task ID 逐项展示 Codex `agentPath` 提供的昵称、模型、思考量和状态，不展示线程 ID或提示词；父回复完成后继续保留仍存在的子代理，只有明确的 `agent/close` 操作才移除对应项。有子代理的 Task 首次进入时优先展示该页签。单击栏目项打开可访问的原生 Dialog，并按子线程 Task ID 挂载独立 Runtime，以 AI Elements Timeline 展示 Snapshot 与流式 Item。关闭 Dialog 必须卸载 Runtime 并取消实时订阅，但不能中断 Codex 子代理；再次打开时重新读取最新 Snapshot checkpoint 并继续接收后续事件，不能只展示父协作 Item 的完成摘要。
- 右侧 Inspector 的“上下文”页签必须在“运行中的终端”栏目展示当前 Task 的后台终端命令与工作目录，并提供带可访问名称的停止图标按钮。终端可以晚于 AI 回复结束，Turn 完成不得移除该栏目；停止提交期间禁用操作，失败显示可重试错误，完整输出仍只在 Timeline 展示。
- 右侧 Inspector 的“上下文”页签必须使用 Project 级 Query 在“MCP”栏目展示当前 Project 启用的 MCP 服务名称，并提供明确的加载、失败和未启用空态；MCP Query 失败只能影响该栏目，不能让整个工作台进入 Runtime 不可用状态。不得保留旧“环境”栏目或展示模型、思考量、审批、沙盒、工作目录和 Git 分支。“来源”栏目始终展示 Project 目录，并按首次出现顺序去重展示当前 Task 用户消息实际使用的 Skills 与图片附件；不得展示 `This Mac`、硬编码分支、演示来源或未接通的“添加来源”操作。
- Task Timeline 的用户消息和 AI 回复末尾都必须常显可访问的复制操作与本地时间；消息 Item 和相邻 Turn 之间保留明确纵向间距，不能让下一条用户消息贴住上一条回复。统一 `review` Item 按用户请求位置只显示一条固定中文文案、复制操作和“审查模式”，不得展示 Codex 内部英文 Review Prompt 或重复时间。
- Task Timeline 的用户消息必须按协议顺序渲染统一消息字段携带的多个 Skill Token；实时 Turn、首轮乐观消息和重新打开 Task 后的历史消息复用编辑器 Token 的 `accent` 主色模块。Web 不从普通文本猜测 Skill，Provider 必须解析 Codex `userMessage.content` 中的 `skill` 字段并在丢弃原生路径后提供 Skill 名称。
- Task Timeline 的用户消息必须渲染统一消息协议携带的图片附件，并提供可访问的缩略图查看入口；附件作为独立于用户文本气泡的块按协议顺序显示在气泡上方，纯图片消息不得渲染空文本气泡，缩略图不重复显示文件名标题栏。Web 只使用随机附件 ID 构造 Project/Task 作用域受控端点，不接收 Base64 Data URL 或 Codex 本地文件路径。历史图片固定使用 `loading="lazy"`、`decoding="async"` 和显式 `width`/`height`；Turn 容器使用稳定内在尺寸与 `content-visibility: auto` 延迟可视区外渲染。纯图片首轮消息必须使用 Provider 返回的用户 Item 完成即时回显。
- Task Timeline 默认随 AI 流式内容自动滚动到最新位置；用户主动离开底部后暂停跟随，用户再次滚动到底部或使用“回到底部”操作后恢复自动跟随；每次切换 Task 都必须等待消息分帧布局稳定后，将中栏聊天消息区域直接滚动到最底部，不恢复离开前的滚动位置。
- AI 回复中的 Project 内绝对文件引用必须可点击打开只读源文件弹窗；带行号时定位并高亮对应行。源文件只通过 Server 受控接口读取，超长内容显示明确截断状态，页面不得直接访问本地文件系统。Markdown 与 MDX 源文件的顶部必须提供带可访问名称的图标按钮，在渲染视图和带行号原文之间切换；切换文件或关闭弹窗后必须恢复原文视图。
- Timeline 展示 Task Snapshot 中的 Agent 文件操作；Inspector 的“变更”页签只在当前 Project 存在真实 Git 未提交变更时渲染变更总览，工作区干净时整个总览和操作区都不渲染。总览左侧在“未提交变更”下方依次同行展示变更总数、增加行数和删除行数，右侧并排展示使用相同中性背景的“审核”与“提交”按钮。“审核”使用统一文件审核 Dialog 浏览全部未暂存与已暂存 Diff；“提交”打开原生 Dialog，按 Project 相对路径合并 staged/unstaged 记录并默认全选，允许生成或编辑 message，再执行 commit 或 commit+push；commit+push 主操作使用主色背景和白色前景。提交控制器、Dialog 和 Mutation observer 只在首次打开时动态加载并注册，关闭后必须整体卸载。文件选择器默认折叠为一行摘要，点击摘要后才渲染选择明细；展开时只允许有界文件区域内部滚动，message 输入区和弹窗操作区必须保持可见。聚合子仓库模式禁用提交；commit 或 commit+push 完整成功后必须立即关闭 Dialog，并通过应用根级的可访问 toast 宿主提示对应成功结果，通知在页面顶部居中显示、自动消失且不提供关闭按钮，通知生命周期不得依附于按需提交弹窗；commit 成功但 push 失败或未配置上游时，Dialog 必须保留 commit SHA 与部分成功状态。总览下方使用本地 AI Elements `FileTree` 展示受限 Project 文件树，“项目文件”标题必须固定在文件树滚动容器之外；目录默认折叠，用户展开时才加载其直接子项，折叠父目录时清理后代展开状态；点击存在 Git 变更的文件必须打开单文件 Diff 弹窗，点击未变更文件继续打开受控源码预览弹窗；根目录和各级子目录的加载、空与错误状态必须明确。Git 状态可用且存在未提交变更时，文件行最右侧展示该文件的增删行数；具体文件尚不可见时只在最深可见祖先目录最右侧展示后代汇总，并随目录展开逐层下移；已删除或被文件树规则过滤的文件没有实际节点时，汇总必须保留在最深可见祖先目录。Inspector 只消费 Project Git Query 并提供手动刷新；运行期刷新、终态刷新、失败暂停和恢复由 Project Runtime 的单一 Git 状态协调器负责。完整 Diff Viewer 使用 `@pierre/diffs/react` 并仅在打开弹窗后动态加载，不保留旧 Git 分组列表或演示数据。
- 每次已结束的 AI 回复在末尾聚合该 Turn 已完成的文件变更，以卡片展示去重文件数和总增删行；单击文件继续打开单文件 Diff，“审核”则打开同一组文件的连续审核弹窗。连续审核必须提供明确的当前位置、上一个/下一个按钮、左右方向键和首尾禁用状态，并支持 Escape 与 backdrop 关闭。
- 交互控件使用语义化元素并提供可访问名称、键盘行为和明确状态。
- Approval 使用 `Confirmation` 提供 Allow、Deny 和可用的 Session 级决策；进入已有待审批 Task 或当前 Task 新增审批时，队首可操作请求的“允许”按钮必须自动聚焦，让用户可直接按 Enter 确认；网络审批必须明确显示目标 Host 与协议，不能依赖命令文本表达授权对象；User Input 的选择、确认和短文本分别使用 Radio、可切换 Button 和 Input，提交开始后立即禁用重复操作。
- 可能位于裁剪容器或视口边缘的 Tooltip 必须脱离局部层叠上下文渲染，并在桌面与窄屏中自动翻转、限制到视口安全边距；同时验证 Hover 和键盘焦点行为。
- `shared/styles/globals.css` 是颜色、字体、间距、圆角、阴影、动效和固定布局尺寸的唯一设计 Token 来源；组件使用语义化 Tailwind Token，不散落视觉字面值。
- 浅色与深色主题在同一语义 Token 中使用 `light-dark()` 定义，`data-theme` 只切换 `color-scheme`，禁止复制整套主题变量。
- 颜色模式只提供 `light` 与 `dark`，使用版本化浏览器存储保存并在 React 挂载前同步到根节点；主题切换即时生效，不进入 Agent 设置 API，也不因取消设置表单而回滚。
- 主题色固定为浅色 `surface #ffffff`、`ink #111111`、`accent #006aff`、`diffAdded #28a948`、`diffRemoved #eb001d`，深色 `surface #181818`、`ink #ffffff`、`accent #339cff`、`diffAdded #40c977`、`diffRemoved #fa423e`；Skill 展示统一复用 `accent`，不维护独立颜色；浅色大面积区域保持纯白，普通文字使用 `450` 字重，不添加固定浅灰底。
- 工作台区域优先使用材质背景、淡阴影和留白区分层级，不使用贯穿面板的高对比边框；视口进入覆盖模式时关闭已打开的桌面面板。左右栏的打开状态仅由各自工具栏按钮、窄屏遮罩或响应式视口变化控制，任何情况下都不得由 Escape 键关闭。桌面常驻布局必须提供可拖拽且支持方向键的语义化分隔线，左栏宽度限制为 `220px` 至 `400px`，右栏限制为 `260px` 至 `480px`；窄屏覆盖模式不显示分隔线。
- 永久 Sidebar 和 Inspector 使用连续同色背景，仅在其纵向边界添加低对比单像素分隔；三栏标题行使用相同高度并保持文字、图标垂直居中，侧栏顶栏不与下方内容分隔，主内容 Toolbar 的单像素底部分隔与左栏搜索框、右栏 Tab 的顶部对齐。不使用模糊或多层重阴影，浮动阴影只用于 Composer、弹层和独立表面。
- 视觉系统变更使用 Playwright 检查 computed style、桌面与移动溢出、窗口缩放和控制台错误。
- 只有形成稳定复用模式后才写入本规范。
