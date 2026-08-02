# Web 质量规范

## Purpose

规定浏览器层改动的最低验证范围。

## Rules

- 组件与状态逻辑使用 Vitest；关键用户流程使用 `tests/e2e` 下的 Playwright 测试。
- 页面行为变化运行 `pnpm test:e2e`，基础门禁运行 `pnpm check`。
- Web ESLint 必须启用 `react-hooks/rules-of-hooks`、`react-hooks/exhaustive-deps` 和 `eslint-plugin-jsx-a11y` 推荐规则；原生 Dialog、ARIA 复合控件等已验证语义只能使用带原因的局部例外，禁止全局降级规则。
- 检查键盘操作、焦点、可访问名称、空状态、错误状态与慢连接状态。
- 流式输出和长历史变更检查渲染次数、DOM 规模及布局稳定性。
- `pnpm test:performance` 必须以固定 10,000 Item 历史验证归一化、虚拟挂载规模与渲染预算，以固定高频 Delta 验证 Item 级通知合并，并通过显式 GC 验证重复 Store 生命周期 Heap；规模与阈值只维护在 `tests/performance-budgets.json`。
- Web 语法高亮必须使用 `shiki/core`、JavaScript Regex Engine、项目语言白名单和 `github-light`/`github-dark` 两个主题；高亮器、源码查看器与 Diff Viewer 只在对应内容或交互出现后动态加载，生产构建不得重新引入完整 `shiki`、全量主题或 Oniguruma WASM。
- 测试断言用户可观察行为，不复制实现细节。
- i18n 单元测试必须覆盖语言匹配、损坏存储回退、资源 key 对齐和 `<html lang>` 同步；关键 E2E 必须覆盖设置内切换英文、刷新后持久化、Codex 官方英文术语，以及用户/Assistant/服务端动态内容保持原样。
- Agent 消息中的本地文件引用必须覆盖 POSIX、Windows 盘符和 UNC 路径；这些路径只能进入受控源码预览，外部 URL 仍使用 Markdown 渲染器的默认安全策略。
- 持有事件序号、Session 或场景状态的 E2E Server 每次测试运行使用全新进程，不复用上一次运行的内存状态或静态资源缓存。
- 大型 App Shell Playwright 套件按 Settings/Navigation、Composer、Runtime、Inspector/Layout 领域拆分，共享默认 API mock 只能放入 per-test fixture；领域文件不得共享可变模块状态或依赖执行顺序。Fake App Server 场景在领域文件内部串行，领域文件之间保持并行，并校验迁移前后测试总数不减少。
