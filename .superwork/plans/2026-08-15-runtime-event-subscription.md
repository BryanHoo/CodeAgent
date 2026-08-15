# Feature Implementation Plan

**Goal:** 将 Tauri 与 N-API 重复的事件订阅状态机和关闭门统一归属 Rust Runtime，使交付适配器只发送 Runtime 生成的最终 frame。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束领域逻辑归属、性能优先和 Rust 验证命令。
- `.superwork/spec/backend/runtime-lifecycle.md` — 定义事件回放、重同步、订阅清理和关闭顺序。
- `.superwork/spec/shared/quality-guidelines.md` — 定义跨 Delivery 一致的 EventStreamMessage 与序列化边界。

**Architecture:** 在 `code-agent-runtime` 新增有界订阅注册表和单一异步状态机，由 Runtime 完成 live 注册、checkpoint、replay、sequence 边界、resync、取消及 RAII 清理，并通过泛型发送函数交付共享序列化 frame；Tauri Channel 与 N-API callback 只实现最终 frame 发送。将通用 `ShutdownGate` 移入 Runtime 并供两端生命周期复用。

**Tech Stack:** Rust 2024、Tokio、tokio-util、serde_json、Tauri 2、napi-rs、Cargo、pnpm。

## Global Constraints

- 单文件不得超过 500 行，特殊生成文件除外。
- 性能优先：事件 frame 只在 Runtime 序列化一次，跨层使用 `Arc<[u8]>` 共享，适配器仅在宿主 API 要求时复制。
- 空 `session_id` 统一使用当前 Runtime session；发送失败、取消、resync 和自然结束均必须清理注册项。
- 不保留旧的适配器状态机或重复 `ShutdownGate` 实现。
- 关键领域逻辑添加清晰、简短的中文注释。

### Task 1: 实现 Runtime 事件订阅状态机

**Files:**

- Create: `crates/runtime/src/event_subscription.rs`
- Modify: `crates/runtime/src/event_stream.rs`
- Modify: `crates/runtime/src/lib.rs`
- Test: `crates/runtime/src/event_subscription.rs`

**Interfaces:**

- Consumes: `AgentEventStream`、`ProjectId`、`CancellationToken` 和异步 frame 发送函数。
- Produces: `CodeAgentRuntime::start_project_event_subscription`、`CodeAgentRuntime::cancel_event_subscription` 和共享 `Arc<[u8]>` frame 状态机。

**Behavior:**

- 统一 live-first 注册、checkpoint、空 session 解析、replay 边界过滤、实时 sequence 过滤、resync、发送失败、取消和 RAII 清理，并使用有界订阅注册表拒绝关闭后的新订阅。

**Stop Conditions:**

- 若现有 Protocol 无法表达有效的 `connection.ready` 或 `resync.required` frame，则停止并报告协议阻塞。
- 若 Runtime 无法在不依赖 Tauri 或 N-API 的情况下抽象发送函数，则停止并重新评估接口边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-runtime event_subscription`

Expected: 空 session、replay 边界、resync、发送失败、取消和清理测试全部通过。

### Task 2: 将 Tauri 与 N-API 收敛为最终 frame 发送器

**Files:**

- Modify: `apps/desktop/src-tauri/src/commands/events.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/lifecycle.rs`
- Modify: `crates/node-binding/src/events.rs`
- Modify: `crates/node-binding/src/engine.rs`
- Test: `tests/tauri-phase-5.test.ts`
- Test: `tests/tauri-phase-7.test.ts`

**Interfaces:**

- Consumes: Runtime 统一订阅启动、取消接口和 `Arc<[u8]>` 最终 frame。
- Produces: 保持现有 Tauri `event_subscribe`/`event_unsubscribe` 与 N-API `eventSubscribe`/`NodeEventSubscription.unsubscribe` 外部契约。

**Behavior:**

- 删除两端的注册表、checkpoint、replay、sequence、resync 和清理分支；Tauri 只把 frame 转为 `InvokeResponseBody::Json` 并发送，N-API 只执行大小检查、必要复制和 callback 发送。

**Stop Conditions:**

- 若现有公开 TypeScript 或 Tauri 命令签名必须变化，则停止并报告契约影响。
- 若任一适配器仍需解释 checkpoint、sequence 或 resync 原因，则停止并将剩余规则继续下沉 Runtime。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-node-binding -p code-agent-desktop`

Expected: 两个交付 crate 编译且现有单元测试通过，事件适配器不再包含领域状态机。

### Task 3: 统一 ShutdownGate 并完成跨 Workspace 验证

**Files:**

- Create: `crates/runtime/src/shutdown.rs`
- Test: `crates/runtime/src/shutdown.rs`
- Modify: `crates/runtime/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/lifecycle.rs`
- Modify: `crates/node-binding/src/operations.rs`
- Modify: `crates/node-binding/src/engine.rs`
- Test: `tests/tauri-phase-6.test.ts`
- Modify: `.superwork/plans/2026-08-15-runtime-event-subscription.md`

**Interfaces:**

- Consumes: Runtime `ShutdownGate` 及现有 Desktop/Node 关闭流程。
- Produces: 单一并发关闭所有者语义，以及完成后的等待者唤醒保证。

**Behavior:**

- 两个交付适配器复用 Runtime `ShutdownGate`，Runtime shutdown 在释放 Project 与受跟踪任务前统一取消所有交付订阅，并通过完整质量门验证边界、格式和行为。

**Stop Conditions:**

- 若共享关闭门会导致 Runtime 反向依赖交付 crate，则停止并修正依赖方向。
- 若完整验证发现与本次重构无关的既有失败，则记录证据并仅修复本次变更引入的问题。

- [x] **Task Status:** completed

Run: `pnpm check:rust && pnpm check`

Expected: Rust Workspace、格式、Lint、依赖边界、类型和 Vitest 全部通过。
