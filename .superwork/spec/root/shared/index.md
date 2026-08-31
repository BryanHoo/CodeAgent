# 共享协议规格

## 附件契约

- `AgentMessageAttachment` 是提交、队列编辑和历史恢复共用的完整附件身份，必须保留 `id`、`kind`、`name`、`mediaType`、`size` 与 `path`
- 普通文件通过 `codexly-file:` `text_elements.placeholder` 携带固定大小元数据；关联的 `text` 仅保存本地缓存路径，不得作为可见正文渲染
- 生成图片正文只允许写入本地附件存储；跨 Rust、Tauri Channel 和 WebView 仅传固定大小附件元数据，不得传输 Base64 `result`

## 桌面宠物契约

- `DesktopPetState` 只同步宠物标识、活动动画、本地访问标志和最多 256 条任务气泡摘要；macOS 由原生窗口维护拖动，并以 AppKit 物理主键状态确认释放，前端维护动画生命周期，Linux 与 Windows 按帧合并物理坐标
- 宠物移动、状态更新和任务跳转使用固定 `desktop-pet://*` 事件，独立窗口不得连接 Provider Runtime

## 状态栏任务契约

- Rust 独占最多 256 条任务运行态摘要，直接归约 `turn.started`、`turn.completed`、失败、元数据与任务移除事件并更新状态栏数量和动态菜单
- 主 WebView 不得写入状态栏任务状态；重建时只能通过 `get_running_tasks` 读取 Rust 快照，恢复全部侧栏标记与 Project 事件归属
- Rust 必须按持久化通知与语言偏好发送 Task 终态、失败及待处理请求系统通知，不得依赖主 WebView 是否存在、可见或处于前台
- 状态栏图标左键必须显示任务菜单，不得直接恢复主窗口；应用恢复只能由菜单命令或任务项触发
- 状态栏任务点击必须恢复主窗口并跳转对应任务；普通 Project 使用 `/p/:projectId/t/:taskId`，`temporary` 作用域使用 `/temporary/t/:taskId`

## 性能观测契约

- Rust 映射实时 Delta 时写入 Unix 毫秒字段 `receivedAtUnixMs`；合并 Delta 保留该合并组首个事件的接收时间，前端只对实际进入可见 Task Store 的事件计算 React commit 延迟
- `get_runtime_performance_metrics` 按项目返回 Provider 接收数、IPC 发布数、最近 1 秒 events/s、合并率与有界事件队列高水位

## MCP Elicitation 契约

- form 模式仅在 `accept` 时携带结构化 `content`；URL 模式的 `accept` 只发送 `action`，`decline` 与 `cancel` 均不发送 `content`

## 验证要求

- 覆盖普通文件提交后在队列编辑与历史恢复中的附件 chip 保留行为
- 覆盖生成图片落盘、Base64 移除和时间线附件映射行为
- 覆盖性能分位数、IPC 合并统计、源码虚拟化 DOM 上限和生产 Chunk 预算
- 覆盖 MCP form/URL Resolution Schema 差异，以及 URL 外部打开成功后才提交 `accept` 的交互顺序
- 覆盖状态栏计数清零、Provider 终态归约、左键菜单、前后台系统通知、运行态恢复、菜单目标解析和普通/`temporary` 任务跳转
