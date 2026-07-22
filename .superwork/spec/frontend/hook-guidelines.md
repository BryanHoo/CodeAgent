# Hook 与副作用规范

## Purpose

约束 HTTP Snapshot、WebSocket 事件和浏览器副作用的封装方式。

## Rules

- Hook 按提供的行为命名，不以页面或实现细节命名通用 Hook。
- HTTP 与 WebSocket 访问统一经过 `packages/client`，组件不得手写协议解析。
- 每个订阅必须处理取消、重连、重复事件与组件卸载清理。
- Hook 返回明确的加载、错误和终态，不用异常或隐式全局变量传递状态。
- Delta 合并留在实时状态边界，组件只消费可渲染状态。
