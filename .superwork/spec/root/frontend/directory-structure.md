# Web 前端目录结构

## 目录职责

- `src/app/`：应用装配与页面外壳
- `src/components/`：通用 UI 和按需引入的 AI Elements 源码；`ai-elements/` 承载可复用的 Agent 对话与开发工具视图
- `src/domain/`：Provider 无关的稳定视图模型与 IPC 类型
- `src/platform/tauri/`：`invoke`、`Channel` 等 Tauri API 适配
- `src/stores/`：后端事件到 WebView 渲染状态的投影
- `src/styles/`：Tailwind 主题与全局样式

## 依赖规则

- 组件通过 Store 或平台适配层获取运行时状态，不直接调用 Tauri API
- `src/domain/` 不依赖 React、Store 或平台实现
- 应用装配可以组合各层，但不承载可独立测试的领域逻辑
