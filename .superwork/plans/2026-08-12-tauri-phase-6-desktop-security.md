# Tauri Phase 6 Implementation Plan

**Goal:** 完成 `docs/tauri-migration-plan.md` Phase 6，为 Desktop 增加原生选择器与通知，收紧 CSP、导航和 capability，建立 single-instance 与有界退出流程，并让所有 Tauri 错误携带可追踪 correlation ID。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Desktop 验证、Rust 生命周期和安全门禁。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束关闭顺序、受跟踪任务和有界资源清理。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部输入、路径、日志与错误边界。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束宿主能力副作用与清理。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束交互测试、可访问性和构建验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公共协议、运行时校验和契约测试。
- `docs/tauri-migration-plan.md` — Phase 6 实施项、验收项与整体安全约束。

**Architecture:** 继续保持 Renderer 只依赖宿主 Transport。原生目录/文件选择与通知通过领域化 Tauri Commands 调用官方插件 Rust API，插件前端权限不授予 WebView；系统打开沿用已受 Project/Attachment 归属与 canonical path 约束的 Rust 路径。`tauri.conf.json` 使用最小 CSP 和显式 capability，并由 Builder 导航钩子拒绝远程页面。single-instance 插件最先注册并聚焦现有主窗口；统一 `DesktopLifecycle` 保证订阅、Runtime、Codex 只关闭一次且顺序有界。Delivery 边界为每个错误保留或生成 UUID correlation ID，用户消息不暴露底层路径、命令和 backtrace。

**Tech Stack:** Rust 2024、Tauri 2.11、tauri-plugin-dialog、tauri-plugin-notification、tauri-plugin-single-instance、TypeScript 6、TypeBox、Vitest、pnpm 11。

## Global Constraints

- Renderer 不获得任意 `fs`、`shell:execute`、HTTP 或 plugin frontend capability；原生能力只通过已注册、owned typed Command 暴露。
- capability 只匹配 `main` 窗口且不声明 `remote`；CSP 只允许本地应用、Tauri IPC、blob/data 图片与 `codeagent-asset`，不得允许远程 script、frame 或 navigation。
- 原生选择结果视为不可信外部输入：目录在加入 Project 前继续 canonicalize；附件 import 继续拒绝 symlink、非普通文件、媒体伪装和 oversized payload。
- 通知只接受有界 title/body/tag，不接受任意图标路径、URL、脚本或平台扩展 payload；权限拒绝不得中断实时事件流。
- single-instance 插件必须首先注册；第二实例只显示、取消最小化并聚焦主窗口，不解析或执行任意传入参数。
- 关闭流程以幂等状态保证只执行一次，顺序固定为 Event subscriptions → Runtime → Codex supervisor；关闭失败只记录 correlation ID，不阻塞进程无限等待。
- `CommandError` 必须包含非空 `correlationId`，复用领域错误已有 ID，否则在 Delivery 边界生成 UUID；Renderer 只展示稳定用户消息。
- 所有文件继续遵守 500 行上限；关键安全和生命周期位置添加简短中文注释。

### Task 1: 增加原生目录、文件选择与系统通知宿主契约

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/client.ts`
- Modify: `packages/client/src/project-client.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.test.ts`
- Create: `apps/desktop/src-tauri/src/commands/host.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Test: `apps/desktop/src-tauri/src/commands/host.rs`

**Interfaces:**

- Consumes: `CodeAgentTransport`、Tauri `AppHandle`、`DialogExt`、`NotificationExt`、现有 Project/Attachment 输入限制
- Produces: `host.directory_select`、`host.files_select`、`host.notification_show` operations 与 `host_directory_select|host_files_select|host_notification_show` typed Commands

**Behavior:**

- Desktop 可选择一个目录或一组受 kind 过滤的附件文件，取消时返回稳定空结果；通知请求校验 title/body/tag 长度后检查并按需请求系统权限，再发送原生通知。选择器和通知只从 Rust Command 调用官方插件，不向 Renderer 授予 plugin capability，也不返回额外文件元数据或开放任意路径 API。

**Stop Conditions:**

- 若插件必须向 Renderer 授予任意文件系统权限、选择结果绕过后续 Project/Attachment 校验，或通知需要接受任意平台 payload，则停止并收紧宿主契约。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-desktop host --locked && pnpm exec vitest run packages/protocol/src/project.test.ts packages/transport-tauri/src/tauri-transport.test.ts`

Expected: 目录/文件取消与选择、过滤器、通知长度/权限降级、operation 映射和响应 Schema 测试通过。

### Task 2: 将 Desktop 原生选择与通知接入现有 React 工作流

**Files:**

- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/notifications/browser-task-notifier.ts`
- Modify: `apps/web/src/features/notifications/browser-task-notifier.test.ts`
- Modify: `apps/web/src/app/providers.tsx`

**Interfaces:**

- Consumes: Task 1 的宿主 operations、现有目录浏览 fallback、`TaskNotifier`
- Produces: Desktop 原生选择路径与原生通知适配，Web 保持现有浏览器目录树和 Notification API

**Behavior:**

- Desktop 的添加 Project 与添加附件入口优先打开原生系统选择器，选择结果继续走既有 `addProject`/`attachments.import_host`；取消不显示错误，宿主不支持时保留现有树形选择器。Desktop 后台任务通知通过宿主 operation 发送，Web 仍使用浏览器 Notification API，前台页面仍不重复通知。

**Stop Conditions:**

- 若 Web bundle 引入 `@tauri-apps/*`、取消选择触发错误提示、原生选择绕过既有 mutation，或通知失败会中断事件处理，则停止并修正前端宿主边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx apps/web/src/features/notifications/browser-task-notifier.test.ts`

Expected: Desktop 原生路径、Web fallback、取消、导入 mutation、前后台通知与失败降级测试通过。

### Task 3: 收紧 CSP、导航、capability 与 DevTools

**Files:**

- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/main.json`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Create: `tests/tauri-phase-6.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: Tauri v2 CSP/capability 配置、`codeagent-asset` protocol、Desktop Vite 产物资源类型
- Produces: 严格 CSP、仅本地 capability、远程 navigation 拒绝钩子、`tauri:phase6:check`

**Behavior:**

- CSP 明确限制 `default/script/style/connect/img/font/object/frame/base/form` 来源，保留 Tauri IPC、inline style、blob/data 和 opaque asset protocol 所需最小集合；主窗口拒绝 `http:|https:|file:` 等远程/本地文件导航，仅允许应用自身 Tauri origin；capability 无 wildcard、remote、fs、shell、http 或未使用 plugin permission；release 配置不启用 DevTools feature。

**Stop Conditions:**

- 若 Markdown/Shiki/附件/字体构建资源需要远程源、custom protocol 无法在严格 CSP 下加载，或远程页面仍可获得 IPC capability，则停止并修正资源或导航策略。

- [x] **Task Status:** completed

Run: `pnpm run tauri:phase6:check && pnpm run build:desktop-ui`

Expected: Phase 4/5/6 安全门禁通过，Desktop UI 在严格 CSP 所需资源范围内完成构建且 Web bundle 不含 Tauri 插件。

### Task 4: 实现 single-instance 与幂等有界关闭策略

**Files:**

- Create: `apps/desktop/src-tauri/src/lifecycle.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `tests/tauri-phase-6.test.ts`
- Test: `apps/desktop/src-tauri/src/lifecycle.rs`

**Interfaces:**

- Consumes: `EventSubscriptions`、`CodeAgentRuntime`、`CodexSupervisor`、Tauri single-instance callback 与 `RunEvent`
- Produces: `DesktopLifecycle::shutdown`、第二实例聚焦策略、主窗口关闭即退出且不托盘驻留的单窗口策略

**Behavior:**

- single-instance 插件作为 Builder 的第一个插件注册，第二实例仅恢复并聚焦 `main`；窗口关闭触发正常应用退出，不隐藏到托盘；最终 `RunEvent::Exit` 调用幂等 lifecycle，严格按 subscriptions → runtime → supervisor 关闭，每步使用既有内部 timeout，重复事件不重复释放资源。

**Stop Conditions:**

- 若第二实例参数可触发命令/路径操作、关闭流程可能并发执行两次、窗口关闭默认驻留，或任一步可无限等待，则停止并修正生命周期状态机。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-desktop lifecycle --locked && pnpm run tauri:phase6:check`

Expected: 并发/重复 shutdown 只执行一次并保持关闭顺序，single-instance 注册顺序、聚焦与无托盘策略通过契约门禁。

### Task 5: 统一用户错误与 tracing correlation ID

**Files:**

- Modify: `apps/desktop/src-tauri/src/command_error.rs`
- Modify: `apps/desktop/src-tauri/src/commands/app.rs`
- Modify: `apps/desktop/src-tauri/src/commands/attachments.rs`
- Modify: `apps/desktop/src-tauri/src/commands/files.rs`
- Modify: `packages/client/src/errors.ts`
- Modify: `packages/client/src/client.test.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.test.ts`
- Modify: `tests/tauri-phase-6.test.ts`

**Interfaces:**

- Consumes: `code_agent_core::CodeAgentError`、Tauri command validation errors、`normalizeCodeAgentError`
- Produces: `{ code, message, retryable, correlationId }` Command error envelope 与 Renderer `CodeAgentError.correlationId`

**Behavior:**

- 领域错误已有 correlation ID 时原样保留；其他 command/validation/internal 错误在 Delivery 边界生成 UUID v4。对 invalid input、not found、timeout、provider failure 和 internal 提供稳定用户消息，底层路径、命令参数、stderr 与 backtrace 只进入内部诊断，不出现在 Renderer message；客户端规范化后保留 ID 供日志与支持定位。

**Stop Conditions:**

- 若错误 ID 在传输中丢失、用户消息包含绝对路径/命令/backtrace，或需要修改领域错误码语义才能实现，则停止并修正 Delivery 映射。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-desktop command_error --locked && pnpm exec vitest run packages/client/src/client.test.ts packages/transport-tauri/src/tauri-transport.test.ts && pnpm run tauri:phase6:check`

Expected: 所有 Tauri 错误均包含非空 correlation ID，客户端保留该字段，敏感内部信息与攻击输入不会进入用户消息。

### Task 6: 完成 Phase 6 验证、规范与迁移状态

**Files:**

- Modify: `.superwork/spec/guides/index.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `.superwork/plans/2026-08-12-tauri-phase-6-desktop-security.md`

**Interfaces:**

- Consumes: Tasks 1-5 验证证据、Phase 6 验收项
- Produces: Phase 6 持续门禁与已完成迁移记录

**Behavior:**

- 仅在 targeted Rust/TS tests、`pnpm run tauri:phase6:check`、`pnpm check`、`pnpm check:rust` 和当前平台未签名 Desktop build 全部通过后，将 Phase 6 标记完成；工程指南记录 Phase 6 安全与生命周期门禁。按用户要求不启动 dev server。

**Stop Conditions:**

- 若任一验收项缺少自动化证据、完整检查或 Desktop artifact 构建失败，则保持 Phase 6 待完成并报告具体阻塞。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm check:rust && pnpm --filter @code-agent/desktop build`

Expected: 全量 TypeScript/Rust/安全门禁和当前平台未签名 Desktop artifact 构建通过，迁移文档只将 Phase 6 标记为已完成。
