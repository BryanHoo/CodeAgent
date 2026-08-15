# Paginated Task Turn History Implementation Plan

**Goal:** 打开长会话时只读取和传输最近一页完整 Turn，并允许按需分页加载更早历史。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨层协议、Rust 生成和验证流程。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex App Server、Snapshot、分页和 IPC 边界。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、实时事件与细粒度 Store 合并。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 TypeBox、Client、Transport 和契约测试。

**Architecture:** 使用本机 Codex 0.147.0 的 `thread/read(includeTurns: false)` 读取 Task 元数据，再用 `thread/turns/list` 读取最近一页 `itemsView: "full"` 的 Turn。公共协议通过 `AgentTurnPage` 和 Snapshot 的旧页游标贯通 Runtime、N-API、HTTP、Tauri、Client 与 Web；Web Store 按 ID 去重并前插旧页。

**Tech Stack:** Rust、Tauri v2、N-API、TypeScript、TypeBox、Fastify、React、Zustand、Vitest。

## Global Constraints

- 单个生产文件不超过 500 行，性能优先，分页游标必须防止重复请求。
- 只实现 Codex 0.147.0 已提供的新分页逻辑，不保留全量历史读取回退。
- 公共协议以 TypeBox 为唯一来源，并生成 Rust DTO。
- 不启动开发服务器。

### Task 1: 定义并实现 Provider Turn 分页

**Files:**

- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/rust-runtime-schema.ts`
- Modify: `crates/protocol/src/generated.rs`
- Modify: `crates/core/src/ports.rs`
- Modify: `crates/provider-codex/src/project_provider/tasks.rs`
- Modify: `crates/provider-codex/src/history_mapping.rs`
- Modify: `crates/provider-codex/src/project_provider.rs`
- Modify: `crates/provider-codex/src/task_state.rs`
- Test: `packages/protocol/src/project.test.ts`
- Test: `crates/provider-codex/tests/history.rs`

**Interfaces:**

- Consumes: Codex `thread/read` 与 `thread/turns/list` 0.147.0 experimental API。
- Produces: `AgentTurnPage`、Snapshot `turnsNextCursor`、`ProjectProviderPort::list_task_turns`。

**Behavior:**

- Snapshot 只映射最新固定页大小的完整 Turn，按时间正序返回；后续请求通过不透明游标读取更早 Turn。Review 子线程只读取最新一个完整 Turn。

**Stop Conditions:**

- 如果本机 Schema 不包含 `thread/turns/list` 或其 full items 视图，停止实现。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test history`

Expected: Provider 请求参数、顺序、游标和 Review 子线程分页测试通过。

### Task 2: 贯通 Runtime、N-API、HTTP、Tauri 与 Client

**Files:**

- Modify: `crates/runtime/src/lib.rs`
- Modify: `crates/node-binding/src/operations/tasks.rs`
- Modify: `packages/engine-node/src/engine.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Modify: `packages/server/src/routes/schemas.ts`
- Modify: `packages/client/src/contracts.ts`
- Modify: `packages/client/src/task-client.ts`
- Modify: `packages/transport-http/src/http-client-tasks.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Modify: `apps/desktop/src-tauri/src/commands/tasks.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `packages/server/src/app.test.ts`
- Test: `packages/transport-http/src/http-client.test.ts`
- Test: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `ProjectProviderPort::list_task_turns` 与 `AgentTurnPageSchema`。
- Produces: `turns.list` Client operation、HTTP `/turns` GET、Tauri `turn_list` Command。

**Behavior:**

- 两种宿主传输使用相同严格分页契约，并原样透传 Cursor；Runtime 校验 Task 归属与输出 Schema。

**Stop Conditions:**

- 如果现有 Engine 或 Tauri 命令注册无法在不破坏边界的情况下扩展，停止并报告具体冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/transport-http/src/http-client.test.ts packages/transport-tauri/src/tauri-transport.test.ts`

Expected: HTTP 与 Tauri 均按同一契约返回 Turn 页并拒绝非法参数。

### Task 3: 在 Web Store 按需前插旧 Turn

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/shared/components/agent/conversation.tsx`
- Modify: `apps/web/src/shared/components/agent/conversation-scroll.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Test: `apps/web/src/features/conversation/runtime/use-task-runtime.test.ts`
- Test: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Test: `apps/web/src/shared/components/agent/conversation-scroll.test.ts`

**Interfaces:**

- Consumes: `CodeAgentClient.listTaskTurns` 与 Snapshot `turnsNextCursor`。
- Produces: Store `prependTurns`、Runtime 历史加载状态、时间线顶部加载命令。

**Behavior:**

- 旧页只在用户请求时读取，按 Turn/Item ID 去重后前插；重复 Cursor、并发点击和失败重试都不会破坏现有实时状态。

**Stop Conditions:**

- 如果分页前插会使虚拟列表滚动位置无条件跳变且现有组件无法恢复锚点，停止并先补充滚动锚点能力。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store.test.ts apps/web/src/features/conversation/runtime/use-task-runtime.test.ts apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 首屏只含最近页，加载旧页后顺序稳定、无重复且实时 Item 不被覆盖。

### Task 4: 固化规范并完成验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/plans/2026-08-15-paginated-task-turn-history.md`

**Interfaces:**

- Consumes: 完成的跨层分页实现与测试结果。
- Produces: 长会话固定成本约束、完成状态与最终验证证据。

**Behavior:**

- 记录 Snapshot 禁止全量 Turn 读取，并完成格式、TypeScript、Rust、协议漂移和相关测试验证。

**Stop Conditions:**

- 任一验证失败时停止完成声明，保留失败命令和根因。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm check:rust && pnpm run protocol:rust:check && pnpm run codex:schema:check`

Expected: 所有门禁通过，且没有生产文件超过 500 行。
