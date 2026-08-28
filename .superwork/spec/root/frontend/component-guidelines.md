# Web 前端组件规范

## 规则

- 使用函数组件和显式 Props，保持单一 UI 职责
- 通用控件优先复用 `src/shared/components/core/`，图标使用 `lucide-react`
- 交互元素提供可访问名称、禁用状态和可见焦点反馈
- 工作台仅面向桌面端，使用全局设计 tokens 约束三栏布局、颜色、间距和交互状态，不增加移动端适配分支
- 对话、推理、工具调用、终端、计划、文件树和 Diff 优先复用 `src/shared/components/agent/`；菜单与弹窗使用 Radix 交互语义
- Markdown 外部 `http/https` 链接必须通过 `src/platform/tauri/` 调用系统 URL opener；页内锚点保留 WebView 内导航
- 服务端快照通过 TanStack Query 读取，实时任务状态通过功能域 Runtime/Store 的选择器读取，避免订阅无关状态
- `temporary` 是合成任务作用域；依赖真实 Project 或根目录的查询必须在该作用域禁用
- Inspector 始终显示可用 Tab；数据模块仅在存在实体时渲染，无内容时在面板内容区显示空状态
- `@pierre/diffs` 首次显示前按当前文件语言预加载高亮器，避免首个 Diff 异步初始化后保持空白
- Composer 提交消息时必须保留完整 `AgentMessageAttachment`，不得退化为仅含 `id` 的引用
- Composer 必须将 `CODEX_THREAD_BUSY` 映射为本地化的可操作提示；未知原生拒绝不得显示硬编码英文兜底文案
- 仅在多个调用方确有一致需求时提取通用组件
- 桌面宠物不得挂载到工作台 DOM；主窗口只投影动画与有界任务摘要，宠物和气泡使用专用入口与最小 Provider 装配，气泡点击通过固定事件回到主窗口路由，避免重复连接 Provider Runtime
- 桌面宠物必须保留 Codexly 的动画映射：超过阈值后切换 `running-left`/`running-right`，释放后播放 `jumping` 再恢复活动动画；macOS 使用一次原生拖拽命令跟踪至 `mouseUp`，其他平台的位置 IPC 按动画帧合并到最新坐标
- macOS 宠物在 CodeAgent 未激活时不得获取 key focus；切换到原生拖拽前必须先释放 WebView pointer capture，物理主键释放后再恢复 main key window 并同步位置、气泡布局和持久化；WebView fallback 必须在 `buttons` 不含主键时兜底结束拖动
- Tauri asset protocol 的宠物图集使用 `HTMLImageElement` 解码后绘制到 Canvas；不得依赖 WKWebView 对自定义协议执行 `fetch` 后再 `createImageBitmap`
