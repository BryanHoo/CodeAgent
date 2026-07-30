# Web 质量规范

## Purpose

规定浏览器层改动的最低验证范围。

## Rules

- 组件与状态逻辑使用 Vitest；关键用户流程使用 `tests/e2e` 下的 Playwright 测试。
- 页面行为变化运行 `pnpm test:e2e`，基础门禁运行 `pnpm check`。
- 检查键盘操作、焦点、可访问名称、空状态、错误状态与慢连接状态。
- 流式输出和长历史变更检查渲染次数、DOM 规模及布局稳定性。
- Web 语法高亮必须使用 `shiki/core`、JavaScript Regex Engine、项目语言白名单和 `github-light`/`github-dark` 两个主题；高亮器、源码查看器与 Diff Viewer 只在对应内容或交互出现后动态加载，生产构建不得重新引入完整 `shiki`、全量主题或 Oniguruma WASM。
- 测试断言用户可观察行为，不复制实现细节。
- Agent 消息中的本地文件引用必须覆盖 POSIX、Windows 盘符和 UNC 路径；这些路径只能进入受控源码预览，外部 URL 仍使用 Markdown 渲染器的默认安全策略。
- 持有事件序号、Session 或场景状态的 E2E Server 每次测试运行使用全新进程，不复用上一次运行的内存状态或静态资源缓存。
