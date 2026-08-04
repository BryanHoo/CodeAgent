# Web 质量规范

## Purpose

规定浏览器层改动的最低验证范围。

## Rules

- 组件与状态逻辑使用 Vitest；关键用户流程使用 `tests/e2e` 下的 Playwright 测试。
- 页面行为变化运行 `pnpm test:e2e`，基础门禁运行 `pnpm check`。
- Web 支持 Chrome/Chromium 116+、Firefox 124+ 和 Safari 17.4+；`apps/web/vite.config.ts` 的 `build.target` 必须保持相同最低版本。Vite 不为运行时 API 注入 polyfill，使用新的浏览器 API 前必须验证该版本矩阵；Chromium E2E 只作为关键流程门禁，不代表完整跨浏览器覆盖。
- 浏览器侧 UUID 统一使用 `uuid` 的 `v4()`，不得直接依赖仅在安全上下文提供的 `crypto.randomUUID()`；回归测试必须覆盖局域网 HTTP 环境中仅有 `crypto.getRandomValues()` 的情况。
- Web ESLint 必须启用 `react-hooks/rules-of-hooks`、`react-hooks/exhaustive-deps` 和 `eslint-plugin-jsx-a11y` 推荐规则；原生 Dialog、ARIA 复合控件等已验证语义只能使用带原因的局部例外，禁止全局降级规则。
- 检查键盘操作、焦点、可访问名称、空状态、错误状态与慢连接状态。
- 移动工作台 E2E 至少覆盖 `320px` 最窄竖屏和手机横屏；页面 viewport 必须禁用用户缩放并使用 `viewport-fit=cover`，根容器必须使用 `dvh` 并承接 `safe-area-inset-*`；文档及 Composer 等内部控件不得横向或纵向溢出动态视口，Composer 常用控件在手机宽度下必须保持单行，主要移动操作的触控目标不得小于 `44px`。
- 流式输出和长历史变更检查渲染次数、DOM 规模及布局稳定性。
- `pnpm test:performance` 必须以固定 10,000 Item 历史验证归一化、虚拟挂载规模与渲染预算，以固定高频 Delta 验证 Item 级通知合并，并通过显式 GC 验证重复 Store 生命周期 Heap；规模与阈值只维护在 `tests/performance-budgets.json`。
- Web 语法高亮必须使用 `shiki/core`、JavaScript Regex Engine、项目语言白名单和 `github-light`/`github-dark` 两个主题；高亮器、源码查看器与 Diff Viewer 只在对应内容或交互出现后动态加载，生产构建不得重新引入完整 `shiki`、全量主题或 Oniguruma WASM。
- 测试断言用户可观察行为，不复制实现细节。
- Snapshot 恢复 E2E 必须覆盖至少一次请求失败、旧 Timeline 与非阻塞恢复状态持续可见、自动重试成功，以及成功后新实时事件继续渲染。
- i18n 单元测试必须覆盖语言匹配、损坏存储回退、资源 key 对齐和 `<html lang>` 同步；关键 E2E 必须覆盖设置内切换英文、刷新后持久化、Codex 官方英文术语，以及用户/Assistant/服务端动态内容保持原样。
- Agent 消息中的本地文件引用必须覆盖 POSIX、Windows 盘符、UNC、原始或 URL 编码的 UTF-8 路径、未编码空白和字面 `%`；本地 Markdown 目标在解析前编码不允许裸写的空白，href 在进入受控预览前只解码一次，外部 URL 仍使用 Markdown 渲染器的默认安全策略。
- 持有事件序号、Session 或场景状态的 E2E Server 必须由 worker fixture 为每个 Playwright worker 启动独立进程，并使用操作系统动态分配的独立端口；不得跨 worker 共享内存状态、实时事件或静态资源缓存。
- LAN Access E2E 必须使用独立 Worker Fastify 进程和真实 Cookie、HTTP、WebSocket，不得用 `page.route()` 伪造 Access API。至少覆盖错误与正确配对、刷新保持、无 Cookie Browser Context、注销失效，以及未认证时无 Project 请求或 WebSocket。
- 大型 App Shell Playwright 套件按 Settings/Navigation、Composer、Runtime、Inspector/Layout 领域拆分，共享默认 API mock 只能放入 per-test fixture；领域文件不得共享可变模块状态或依赖执行顺序。Fake App Server 场景在领域文件内部串行，领域文件之间保持并行，并校验迁移前后测试总数不减少。
