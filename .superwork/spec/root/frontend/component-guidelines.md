# Web 前端组件规范

## 规则

- 使用函数组件和显式 Props，保持单一 UI 职责
- 通用控件优先复用 `src/shared/components/core/`，图标使用 `lucide-react`
- 交互元素提供可访问名称、禁用状态和可见焦点反馈
- 工作台仅面向桌面端，使用全局设计 tokens 约束三栏布局、颜色、间距和交互状态，不增加移动端适配分支
- Codex Runtime Gate 必须先于 Provider 连接与工作台数据 Provider 挂载；只有精确兼容版本通过检测后才能进入工作台。缺失或不兼容时展示固定的全局安装命令与应用私有下载，私有下载完成后自动复检，并始终保留手动复检入口
- 工作台壁纸必须按视口尺寸与 `devicePixelRatio` 预缩放到物理像素画布，并在画布生成阶段完成模糊；窗口缩放应合并重绘，禁止对全屏原图使用实时 CSS `filter: blur()`
- 已落盘的自定义背景必须使用 Rust 动态授权的 Tauri asset URL 展示；显式读取大图时使用 raw `Response`/`ArrayBuffer`，仅未保存的浏览器草稿创建 blob URL，禁止将图片作为 `number[]` JSON 响应传输
- 对话、推理、工具调用、终端、计划、文件树和 Diff 优先复用 `src/shared/components/agent/`；菜单与弹窗使用 Radix 交互语义
- 对话 Turn 列表必须使用自然文档流，禁止使用虚拟 sizer、绝对定位、transform 位移或持续动态测高；运行中与最近 3 个 Turn 保持热渲染，更早的终态 Turn 使用 `content-visibility: auto` 和 `contain-intrinsic-block-size` 作为可降级的浏览器原生优化；该 CSS 优化不得参与正确性判断，不支持时必须退化为完整自然流；历史导航直接定位已挂载锚点，流式置底只由滚动容器级 `ResizeObserver` 管理
- 时间线右侧轻量导航必须使用自然文档流完整挂载，不得使用虚拟 sizer、尺寸测量或绝对位移；固定行高虚拟化仅用于可达万级数据的源码行和项目文件树
- 分页源码预览必须按页保留 token 状态并使用固定行高虚拟化，仅在复制或完整 Markdown 预览时物化全文；源码总量超过 `128 KiB` 时默认展示纯文本，禁止翻页后重新拼接并高亮全部前缀
- Markdown 外部 `http/https` 链接必须通过 `src/platform/tauri/` 调用系统 URL opener；页内锚点保留 WebView 内导航
- Provider 官方认证仅允许打开 `https` URL，并必须通过 `src/platform/tauri/` 调用系统 URL opener；不得使用 WebView `window.open()`
- 服务端快照通过 TanStack Query 读取，实时任务状态通过功能域 Runtime/Store 的选择器读取，避免订阅无关状态
- `temporary` 是合成任务作用域；依赖真实 Project 或根目录的查询必须在该作用域禁用
- Inspector 始终显示可用 Tab；数据模块仅在存在实体时渲染，无内容时在面板内容区显示空状态
- `@pierre/diffs` 首次显示前按当前文件语言预加载高亮器，避免首个 Diff 异步初始化后保持空白
- Composer 提交消息时必须保留完整 `AgentMessageAttachment`，不得退化为仅含 `id` 的引用
- Composer 必须将 `CODEX_THREAD_BUSY` 映射为本地化的可操作提示；未知原生拒绝不得显示硬编码英文兜底文案
- 仅在多个调用方确有一致需求时提取通用组件
- 桌面宠物不得挂载到工作台 DOM；主窗口只投影动画与有界任务摘要，宠物和气泡共用一个专用透明 WebView 与最小 Provider 装配，气泡点击通过固定事件回到主窗口路由，避免重复连接 Provider Runtime
- 桌面宠物必须支持 macOS、Ubuntu Wayland/X11 与 Windows；macOS 使用一次原生拖拽命令跟踪至 `mouseUp`，Linux 在 GTK 初始化前将 Wayland 会话切换到 XWayland 后端，Windows 使用公开虚拟桌面 API 跟随当前桌面并恢复 topmost 层级；Linux 与 Windows 的位置 IPC 按动画帧合并到最新坐标
- macOS 宠物在 CodeAgent 未激活时不得获取 key focus；切换到原生拖拽前必须先释放 WebView pointer capture，物理主键释放后再恢复 main key window 并同步位置、气泡布局和持久化；WebView fallback 必须在 `buttons` 不含主键时兜底结束拖动
- Tauri asset protocol 的宠物图集使用 `HTMLImageElement` 解码后绘制到 Canvas；不得依赖 WKWebView 对自定义协议执行 `fetch` 后再 `createImageBitmap`
