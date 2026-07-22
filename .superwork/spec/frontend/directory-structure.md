# Web 目录结构

## Purpose

当前 Web 根目录为 `apps/web`，构建产物进入根目录 `dist/web`。

## Rules

- `src/main.tsx` 只创建 React Root 并装配应用级 Provider。
- `src/App.tsx` 只承担应用外壳和顶层导航结构。
- 功能代码按真实用户能力放入 `src/features/<feature>`，不要按技术类型堆放全局目录。
- `features/projects` 负责 Project 集合、目录选择和 Task 归属；Project 选择整合进工作台，不创建独立 Project 索引页。
- 仅被单个功能使用的组件、Hook 和状态留在该功能目录。
- 跨功能 UI 经过复用验证后放入 `src/shared`；API 类型仍来自 `@code-agent-window/protocol`。
- 禁止从 Web 导入 `core`、`provider-codex` 或 `server`。
