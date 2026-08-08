# Web 目录结构

## Purpose

当前 Web 根目录为 `apps/web`，构建产物进入根目录 `dist/web`。

## Rules

- `src/main.tsx` 只创建 React Root 并装配应用级 Provider。
- `src/App.tsx` 只承担应用外壳和顶层导航结构。
- `src/app/routes` 只定义业务页面与路由级状态，不提供登录页面或认证回调路由。
- Project 与 Task 路由只同步保留路径匹配等关键配置；工作台组件使用 TanStack Router `Route.lazy()` 与 `createLazyRoute()` 按需加载，避免 Markdown、终端和 Inspector 依赖进入首屏入口。
- 功能代码按真实用户能力放入 `src/features/<feature>`，不要按技术类型堆放全局目录。
- `features/access` 负责顶层访问状态、LAN 配对门禁和认证失效清理，不得依赖 Project 或工作台 Runtime。
- `features/projects` 负责 Project 集合、目录选择和 Task 归属；Project 选择整合进工作台，不创建独立 Project 索引页。
- 仅被单个功能使用的组件、Hook 和状态留在该功能目录。
- 跨功能 UI 经过复用验证后放入 `src/shared`；API 类型仍来自 `@code-agent/protocol`。
- 项目自有组件库分为 `src/shared/components/core` 与 `src/shared/components/agent`：前者维护通用交互原语，后者维护 Agent 工作台复合组件；Feature 不得复制同类能力，也不得直接依赖外部组件 registry 或生成配置。
- 跨路由复用的 Runtime 不可用提示放入 `src/shared/components/core`，由页面传入重试行为。
- 禁止从 Web 导入 `core`、`provider-codex` 或 `server`。
