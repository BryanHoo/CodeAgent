# Web 前端状态管理

## 状态流

`src/client/` 读取 HTTP 快照并订阅 WebSocket 事件，`src/features/conversation/runtime/` 将事件投影到任务 Store，TanStack Query 管理项目和设置等服务端状态。

## 规则

- 每个项目 Runtime 只维持一条事件订阅，并使用 checkpoint/session 信息恢复连接
- Query Key、失效和乐观更新集中在对应功能域的 query options/cache 模块
- 事件投影按序列处理并拒绝陈旧会话事件；快照恢复不得覆盖更新的本地状态
- 短暂且仅由单组件使用的 UI 状态保留在组件内部
- 新增共享状态前先定义事件来源、初始值、错误状态与清理行为
