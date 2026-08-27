# Web 前端目录结构

## 目录职责

- `src/app/`：Provider、TanStack Router 与路由级页面装配
- `src/features/`：按 access、conversation、projects、settings、workbench 等功能域组织业务组件与状态
- `src/shared/`：跨功能域复用的 Agent 组件、基础控件、样式和无业务工具
- `src/client/`：类型安全的 HTTP/WebSocket 客户端
- `src/protocol/`：跨传输共享的 TypeBox 协议与 TypeScript 类型
- `src/mock/`：按协议提供本地 HTTP/WebSocket 传输，实现无需后端的完整工作台交互
- `src/i18n/`：语言偏好、资源注册与中英文文案

## 依赖规则

- 组件通过 Query、功能域 Runtime 或 Context 获取状态，不直接发起原始网络请求
- `src/protocol/` 不依赖 React 或具体传输实现，`src/client/` 仅消费公开协议
- `src/shared/` 不反向依赖具体功能域；应用装配可以组合各层，但不承载领域逻辑
- 后端尚未接入时，客户端必须注入 `src/mock/` 的 fetch 与 WebSocket 工厂，禁止回退到真实网络
