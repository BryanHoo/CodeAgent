# Web 前端状态管理

## 状态流

`src/platform/tauri/runtime-channel.ts` 建立唯一模块级 Channel，`src/stores/runtime-reducer.ts` 将归一化事件投影到渲染状态，组件通过 `src/stores/runtime-store.ts` 订阅。

## 规则

- 模块级 Channel 只初始化一次，不在 React 生命周期中重复连接
- Reducer 保持纯函数，并根据事件序号拒绝陈旧事件
- 短暂且仅由单组件使用的 UI 状态保留在组件内部
- 新增共享状态前先定义事件来源、初始值、错误状态与清理行为
