# Web 前端组件规范

## 规则

- 使用函数组件和显式 Props，保持单一 UI 职责
- 通用控件优先复用 `src/shared/components/core/`，图标使用 `lucide-react`
- 交互元素提供可访问名称、禁用状态和可见焦点反馈
- 工作台仅面向桌面端，使用全局设计 tokens 约束三栏布局、颜色、间距和交互状态，不增加移动端适配分支
- Codex Runtime Gate 必须先于 Provider 连接与工作台数据 Provider 挂载；只有不低于协议基线的稳定版本通过检测后才能进入工作台。缺失或不兼容时展示固定的全局安装命令与应用私有下载；用户启动私有下载后必须展示实时下载进度，下载完成后自动复检，并始终保留手动复检入口
- 工作台壁纸必须按视口尺寸与 `devicePixelRatio` 预缩放到物理像素画布，并在画布生成阶段完成模糊；窗口缩放应合并重绘，禁止对全屏原图使用实时 CSS `filter: blur()`
- 已落盘的自定义背景必须使用 Rust 动态授权的 Tauri asset URL 展示；显式读取大图时使用 raw `Response`/`ArrayBuffer`，仅未保存的浏览器草稿创建 blob URL，禁止将图片作为 `number[]` JSON 响应传输
- 对话、推理、工具调用、终端、计划、文件树和 Diff 优先复用 `src/shared/components/agent/`；菜单与弹窗使用 Radix 交互语义
- 桌面文件系统选择器切换盘符或路径时必须保留最近一次成功发现的根列表，加载或失败状态不得卸载盘符选择器；Windows `\\?\` verbatim 路径必须先按普通盘符语义归一化再匹配当前根项
- 对话 Turn 列表必须使用 TanStack Virtual 2026 Chat 模式：以稳定 Turn ID 作为 `getItemKey`，使用 `anchorTo: "end"`、`followOnAppend`、动态 `measureElement` 和有界 overscan；滚动容器、虚拟 sizer 与行位置必须由同一个 Virtualizer 实例管理，启用 `directDomUpdates` 降低滚动期 React 提交；WebKit 使用 `directDomUpdatesMode: "position"`，禁止行级 transform 合成层和应用侧重复 `scrollTop` 补偿；历史 prepend 依赖 end anchor 保持可见 Turn，流式增长仅在用户已经置底时跟随；分页头、Turn 与待处理尾部必须进入同一虚拟序列，导航先定位 Turn 再定位内部消息锚点；`content-visibility` 不得用于对话列表正确性或替代 DOM 窗口化
- 时间线右侧轻量导航必须使用自然文档流完整挂载，不得使用虚拟 sizer、尺寸测量或绝对位移；固定行高虚拟化仅用于可达万级数据的源码行和项目文件树
- 分页源码预览必须按页保留 token 状态并使用固定行高虚拟化，仅在复制或完整 Markdown 预览时物化全文；源码总量超过 `128 KiB` 时默认展示纯文本，禁止翻页后重新拼接并高亮全部前缀
- 工具型独立窗口必须由受限 Tauri 命令创建，使用专用轻量启动面和最小 capability；不得使用 WebView `window.open()`，也不得挂载完整工作台 Provider 树
- Markdown 外部 `http/https` 链接必须通过 `src/platform/tauri/` 调用系统 URL opener；页内锚点保留 WebView 内导航
- Provider 官方认证仅允许打开 `https` URL，并必须通过 `src/platform/tauri/` 调用系统 URL opener；不得使用 WebView `window.open()`
- MCP URL elicitation 必须使用 `new URL()` 严格解析并仅允许 `http/https`，在用户操作前展示完整 URL、突出 `hostname` 并明确征得同意；同意后必须先通过 `src/platform/tauri/` 在系统浏览器打开，成功后才能提交 `accept`，不得使用 WebView 链接导航
- 当前 Task 的 MCP 右栏必须使用线程级权威清单，精确展示连接态与工具数；不得在 WebView 缓存启动通知、展开完整工具定义或混入任务时间线中的 `mcpToolCall` 执行记录
- 服务端快照通过 TanStack Query 读取，实时任务状态通过功能域 Runtime/Store 的选择器读取，避免订阅无关状态
- `temporary` 是合成任务作用域；依赖真实 Project 或根目录的查询必须在该作用域禁用
- Inspector 始终显示可用 Tab；数据模块仅在存在实体时渲染，无内容时在面板内容区显示空状态
- Inspector 的项目 Tab 固定排在上下文 Tab 前；普通 Task 启动后保持项目 Tab，仅当计划或目标出现时自动切换到上下文 Tab
- `@pierre/diffs` 首次显示前按当前文件语言预加载高亮器，避免首个 Diff 异步初始化后保持空白
- Composer 提交消息时必须保留完整 `AgentMessageAttachment`，不得退化为仅含 `id` 的引用
- Composer 必须按 `model/list.inputModalities` 禁止模型不支持的图片或音频提交；图片固定使用 `detail: auto`，浏览器附件走 raw IPC，宿主选择走路径导入，不提供逐图档位选择
- 宿主附件选择器底栏必须限制路径显示宽度并单行省略，操作按钮使用不可收缩的独立布局列；中文长路径必须在 Chromium 与 WebKit 浏览器测试中验证无裁切和溢出
- Composer 必须将 `CODEX_THREAD_BUSY` 映射为本地化的可操作提示；未知原生拒绝不得显示硬编码英文兜底文案
- 仅在多个调用方确有一致需求时提取通用组件
- 应用入口必须通过 React 根回调、`window.error` 与 `unhandledrejection` 上报结构化诊断；后台失败使用同一诊断入口且不得影响主流程。关于页必须提供诊断 ZIP 导出按钮，并明确展示导出中禁用状态和完成/失败通知
- 桌面宠物不得挂载到工作台 DOM；主窗口只提交宠物标识，Rust 从统一任务活动状态投影动画与有界任务摘要；宠物和气泡共用一个专用透明 WebView 与最小 Provider 装配，气泡点击通过固定事件回到主窗口路由，避免重复连接 Provider Runtime；任务气泡必须按投影顺序自然排列，不得叠放或按完成状态重排；设置中的启用状态使用带明确开关选项的下拉组件
- 状态栏任务与宠物气泡打开已存在的主窗口时，Rust 必须发送 `main-window://navigate`，由 TanStack Router 完成 SPA 导航；主窗口 capability 必须同时授权 `core:event:allow-listen` 与 `core:event:allow-unlisten`；仅主 WebView 不存在时允许按目标路由重建，禁止调用 `window.navigate(...)` 重载现有工作台
- 桌面宠物必须支持 macOS、Ubuntu Wayland/X11 与 Windows；macOS 使用一次原生拖拽命令跟踪至 `mouseUp`，Linux 保留 GTK 自动选择的原生显示后端，Windows 使用公开虚拟桌面 API 跟随当前桌面并恢复 topmost 层级；Linux 与 Windows 的位置 IPC 按动画帧合并到最新坐标
- macOS 宠物在 CodeAgent 未激活时不得获取 key focus；切换到原生拖拽前必须先释放 WebView pointer capture，物理主键释放后再恢复 main key window 并同步位置、气泡布局和持久化；WebView fallback 必须在 `buttons` 不含主键时兜底结束拖动
- Tauri asset protocol 的宠物图集使用 `HTMLImageElement` 解码后绘制到 Canvas；不得依赖 WKWebView 对自定义协议执行 `fetch` 后再 `createImageBitmap`
