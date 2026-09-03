# Web 前端状态管理

## 状态流

`src/client/` 读取 HTTP 快照并订阅 WebSocket 事件，`src/features/conversation/runtime/` 将事件投影到任务 Store，TanStack Query 管理项目和设置等服务端状态。

## 规则

- 每个项目 Runtime 只维持一条事件订阅，并使用 checkpoint/session 信息恢复连接
- 运行、等待、完成和失败的任务活动事实来源是 Rust `TaskActivityState`；WebView 只保留侧栏渲染投影，重建时必须读取 `get_task_activities` 完整快照
- 任务看板必须复用 `ProjectDraftStore` 待办与 Rust 任务活动投影；运行中、待处理只遍历有界 Activity Map，已完成由 Rust 过滤 `idle/notLoaded` 后按更新时间提供 10 条一页的跨项目 Cursor，WebView 仅维护项目过滤和 Infinite Query 页面，不提供手动拖拽改写；已完成查询失败只能降级对应列并提供重试，不得替换为全局 Runtime 不可用页面
- 已完成卡片必须消费 Runtime 的 `attention: "completed"` 区分未查看的新完成任务，并同时使用结构、底色和明确文案提示；进入任务后复用 `acknowledgeTaskActivity` 清除 attention，不得在 WebView 新增第二套已读状态
- 主窗口持续失焦、最小化或不可见达到延迟阈值后，暂停详细 Task Store 投影、动画、视图计时器和轮询；Runtime、Activity 和桌面通知必须继续消费事件。恢复时批量提交有界积压，Snapshot 前后事件必须按 session/checkpoint 截断，溢出时改用权威 Snapshot 恢复
- Query Key、失效和乐观更新集中在对应功能域的 query options/cache 模块
- Mutation 写入 Query Cache 前必须精确取消同 Key 的在途旧快照请求，避免迟到响应覆盖已确认的服务端变更；相关测试必须覆盖旧请求晚于 Mutation 完成的时序
- 事件投影按序列处理并拒绝陈旧会话事件；快照恢复不得覆盖更新的本地状态
- 短暂且仅由单组件使用的 UI 状态保留在组件内部
- 新增共享状态前先定义事件来源、初始值、错误状态与清理行为
