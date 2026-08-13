# Unified Host File Picker Implementation Plan

**Goal:** 让 Desktop 与 Web 的项目目录、Composer 文件和 Composer 图片入口统一使用高性能 Web modal 文件树，支持顶部绝对路径导航和默认隐藏隐藏文件的显隐切换，并彻底移除系统文件选择弹窗。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、Desktop 安全边界和验证门禁。
- `.superwork/spec/frontend/component-guidelines.md` — 约束项目添加、Composer 附件选择、共享组件和移动端可访问性。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 React 性能、测试和 Bundle 预算。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Schema、跨 Transport 契约和 Rust 生成协议。
- `.superwork/spec/backend/quality-guidelines.md` — 约束目录浏览、路径校验与跨平台测试。

**Architecture:** 扩展现有 `project_directories.list` 与 `host_files.list` 严格查询契约，以 `showHidden` 驱动 Rust 文件系统遍历阶段的隐藏项过滤；抽取单一共享宿主文件选择 Dialog，以按展开节点懒加载、React Query 缓存和扁平可见节点虚拟化承载三类选择场景；删除 Tauri 原生文件选择 Operation、Command 和 dialog 插件，使 Web 与 Desktop 只通过相同的受控目录读取链路工作。

**Tech Stack:** TypeScript、React 19、TanStack Query、TanStack Virtual、TypeBox、Vitest、Playwright、Rust、Tokio、Tauri v2、pnpm。

## Global Constraints

- 所有生产源文件保持不超过 500 行，并按职责拆分共享控件、状态 Hook 与节点渲染。
- 目录只在根路径或展开节点变化时读取；默认在 Rust I/O 层跳过隐藏项，不预读整棵文件树。
- 绝对路径必须继续由现有严格 Schema 和 Runtime `canonicalize` 校验，不能让 Renderer 获得直接文件系统权限。
- Desktop 与 Web 使用同一 React Dialog、同一 Client Operation 和相同交互，不保留系统选择器回退或旧兼容路径。
- 顶部路径输入支持键盘提交；隐藏项按钮使用 Lucide `Eye` / `EyeOff`、Tooltip 和可访问名称，默认 `showHidden=false`。
- 窄屏从无前缀移动端布局开始，主要触控目标至少 44px，Dialog 不产生水平溢出。
- 项目命令使用 `pnpm`，Python 命令使用 `python3`，不启动开发服务器。

### Task 1: 扩展隐藏文件浏览契约与 I/O 过滤

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/project-client.ts`
- Modify: `packages/transport-http/src/http-operation-map.ts`
- Modify: `packages/transport-http/src/http-client-projects.ts`
- Modify: `packages/transport-http/src/http-client.test.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `crates/core/src/ports.rs`
- Modify: `crates/runtime/src/lib.rs`
- Modify: `crates/platform/src/files.rs`
- Modify: `crates/platform/src/host_file_browser.rs`
- Modify: `crates/node-binding/src/operations/files.rs`
- Modify: `apps/desktop/src-tauri/src/commands/files.rs`
- Test: `crates/platform/src/host_file_browser.rs`

**Interfaces:**

- Consumes: `ProjectDirectoryQuerySchema`, `HostFileQuerySchema`, `FilePort`, `CodeAgentRuntime`, `ProjectCodeAgentClient`
- Produces: `showHidden?: boolean` 查询字段及贯穿 HTTP、N-API、Tauri IPC、Runtime 和 `browse_directory` 的显隐参数

**Behavior:**

- 默认请求不返回 Unix 点前缀项或 Windows hidden 属性项，`showHidden=true` 时返回这些普通目录和受支持文件；两种模式继续跳过符号链接、拒绝非法路径，并保持目录与条目稳定排序。
- Client 和两个 Transport 将 `showHidden` 原样传到宿主 Runtime，React Query 可按显隐模式建立互不污染的缓存。

**Stop Conditions:**

- Windows hidden 属性无法在当前依赖和平台抽象内安全读取时停止，先明确跨平台识别方案。
- `showHidden` 无法通过严格 TypeBox Schema、N-API 和 Tauri IPC 一致传递时停止，不能在前端做伪显隐。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/transport-http/src/http-client.test.ts && cargo test -p code-agent-platform host_file_browser --locked`

Expected: 严格查询 Schema、HTTP 参数映射和 Rust 隐藏项过滤测试全部通过。

### Task 2: 实现统一高性能宿主文件选择 Dialog

**Files:**

- Create: `apps/web/src/features/projects/components/host-file-picker-dialog.tsx`
- Create: `apps/web/src/features/projects/components/use-host-file-picker.ts`
- Create: `apps/web/src/features/projects/components/host-file-picker-tree.tsx`
- Create: `apps/web/src/features/projects/components/host-file-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`
- Modify: `apps/web/src/shared/lib/filesystem-roots.ts`
- Modify: `apps/web/src/shared/lib/filesystem-roots.test.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/features/projects/components/host-file-picker-dialog.test.tsx`

**Interfaces:**

- Consumes: `listProjectDirectories(path, showHidden, options)`, `listHostFiles(kind, path, showHidden, options)`, `FileTree` visual contract, `Dialog`, `Input`, `Button`, `Tooltip`
- Produces: `HostFilePickerDialog` 的 `directory | file | image` 模式、顶部绝对路径提交、默认隐藏的显隐切换、按需目录缓存和单选确认契约

**Behavior:**

- 左栏项目添加、中栏“添加文件”和“添加图片”渲染同一个 Dialog；标题、空态与确认动作按模式变化，但路径导航、磁盘选择、向上导航、显隐按钮、错误重试和文件树保持一致。
- 顶部输入框显示当前规范化绝对路径，按 Enter 或导航按钮后读取目标目录；失败时保留输入以便修正，成功时清空旧分支展开与无效选择。
- `showHidden` 初始为 `false`，切换后使用包含模式的 Query Key 读取当前根和已展开节点；只挂载可见展开节点的 Query，并用 TanStack Virtual 渲染长目录的扁平可见节点列表，避免大目录造成线性 DOM 膨胀。
- `directory` 模式只允许确认目录，`file | image` 模式只允许确认文件；文件类型仍由宿主 I/O 层过滤。

**Stop Conditions:**

- 现有 `FileTree` 的递归 DOM 结构无法兼容虚拟化与键盘树语义时停止，在不破坏 Inspector 文件树的前提下新增专用扁平树组件，不能全局改坏既有树。
- 320px 宽度无法容纳路径输入和图标操作时停止并调整为移动端两行工具栏，不能隐藏绝对路径输入或显隐控制。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/components/host-file-picker-dialog.test.tsx apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx apps/web/src/shared/lib/filesystem-roots.test.ts`

Expected: 三类模式复用同一 Dialog，绝对路径、显隐切换、懒加载、虚拟列表、错误和可访问状态测试全部通过。

### Task 3: 删除系统文件弹窗与旧宿主选择能力

**Files:**

- Modify: `packages/client/src/project-client.ts`
- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/transport-tauri/src/index.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.test.ts`
- Modify: `apps/web/src/types/host-transport.d.ts`
- Modify: `apps/web/vite.config.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/desktop/src-tauri/src/commands/host.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Test: `tests/tauri-phase-6.test.ts`

**Interfaces:**

- Consumes: `host.directory_select`, `host.files_select`, `hostCapabilities.nativeDirectoryPicker`, Tauri `host_directory_select` / `host_files_select`, `tauri-plugin-dialog`
- Produces: 仅保留 `project_directories.list` / `host_files.list` 的统一 Web modal 宿主选择边界，以及继续独立工作的系统通知命令

**Behavior:**

- 删除 Client Operation、Protocol 响应 Schema、Tauri Transport 映射、React 宿主能力分支、Rust Command 注册和 dialog 插件依赖，不保留 fallback 或死代码。
- Desktop 的项目添加、添加文件与添加图片只触发共享 Dialog 和目录列表 IPC；通知插件与 `host_notification_show` 保持不变。
- 更新稳定工程规范，明确 Desktop 与 Web 均禁止原生文件/目录选择器，并由测试拒绝系统 dialog 能力回归。

**Stop Conditions:**

- `tauri-plugin-dialog` 仍存在除本次文件/目录选择之外的真实消费者时停止，只删除文件选择 Command，不移除共享插件依赖。
- 删除 Operation 后存在未迁移的运行时调用方时停止并迁移该调用方，不能保留不可达映射。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts apps/web/vite.config.test.ts tests/tauri-phase-6.test.ts && cargo check -p code-agent-desktop --locked`

Expected: Tauri 不再注册或依赖系统 dialog，Web 和 Desktop 构建契约只暴露统一目录读取能力。

### Task 4: 验证跨端文件选择流程与性能门禁

**Files:**

- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `tests/tauri-phase-4.test.ts`
- Modify: `tests/tauri-phase-6.test.ts`
- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Test: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: 左栏项目添加入口、Composer “添加文件”入口、Composer “添加图片”入口、Desktop Tauri 静态门禁
- Produces: 三入口统一 modal、绝对路径导航、默认隐藏及显隐切换、窄屏无溢出和无原生 dialog 的回归证据

**Behavior:**

- Playwright 验证项目、文件、图片三入口均出现同一文件选择器结构，绝对路径可提交，默认隐藏项不可见，点击显隐图标后可见，并在 320px 视口保持可操作和无水平溢出。
- 静态 Tauri 门禁验证 `tauri-plugin-dialog`、`host_directory_select`、`host_files_select` 和对应 Transport Operation 不会重新进入 Desktop。
- 完整质量检查覆盖 TypeScript、Rust、协议生成漂移、架构边界、性能预算和构建。

**Stop Conditions:**

- E2E fixture 无法稳定表达宿主隐藏文件时停止，先为测试宿主建立确定性 fixture，不依赖开发机主目录。
- Bundle 或大目录渲染性能预算回退时停止并优化共享 Dialog，不能提高预算掩盖回归。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 完整质量门禁和浏览器流程通过，Desktop 与 Web 三类入口均使用统一高性能 modal，且未启动开发服务器。
