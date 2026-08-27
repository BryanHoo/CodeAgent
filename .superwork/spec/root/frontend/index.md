# Web 前端开发规格

## 范围

适用于根包 `src/` 下的 React WebView。入口装配、UI、领域视图模型、状态投影与 Tauri 适配必须保持目录边界。

## 规格索引

| 文档 | 内容 |
|---|---|
| [目录结构](./directory-structure.md) | 前端代码放置与依赖方向 |
| [组件规范](./component-guidelines.md) | React 组件与交互实现约束 |
| [状态管理](./state-management.md) | Runtime 事件到界面状态的投影规则 |
| [类型安全](./type-safety.md) | TypeScript 与 IPC 类型契约 |
| [质量规范](./quality-guidelines.md) | 测试、检查与验收要求 |

## 开发前检查

- 阅读 [.superwork/spec/guides/index.md](../../guides/index.md)
- 涉及 IPC 时同步阅读 [Tauri 后端开发规格](../../src-tauri/backend/index.md)
- 确认变更属于应用装配、组件、领域、平台适配或状态投影中的单一职责
