# Feature Implementation Plan

**Goal:** 将 Runtime Provider Event 热路径改为借用信封的一次 JSON 序列化，移除中间 `Value` tree 与重复遍历。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Rust Runtime、协议边界与验证命令。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束实时事件链路、队列和 Runtime 生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Event Stream 测试与性能优先实现。

**Architecture:** 在 `AgentEventStream` 内构造仅借用 `ProviderEvent`、Provider、Session ID 和已格式化时间戳的 serde 信封，通过 `#[serde(flatten)]` 直接写入最终 `Vec<u8>`；删除热路径不再使用的 `ProviderEvent::into_value()`，保留低频借用 `to_value()` 边界。

**Tech Stack:** Rust 2024、Serde、serde_json、Tokio、Vitest、pnpm。

## Global Constraints

- 保持 Delivery JSON 的 `provider`、`sequence`、`sessionId`、`timestamp`、`version` 和 Provider Event 领域字段不变。
- 单个开发文件不得超过 500 行，且事件发布热路径以减少分配和锁内工作为第一原则。
- 不保留旧的 `Value` mutation 兼容路径。

### Task 1: 实现 Provider Event 单次序列化

**Files:**

- Modify: `crates/runtime/src/event_stream.rs`
- Modify: `crates/runtime/tests/event_stream.rs`
- Modify: `crates/protocol/src/provider_event/access.rs`
- Modify: `crates/protocol/src/lib.rs`
- Modify: `crates/provider-codex/tests/mapping.rs`
- Modify: `tests/tauri-phase-3.test.ts`

**Interfaces:**

- Consumes: `ProviderEvent: Serialize`、`EventStreamOptions`、Runtime sequence 与 UTC clock。
- Produces: 与现有 Delivery Schema 等价、由 borrowed envelope 一次写入的 `PublishedEvent::frame()`。

**Behavior:**

- 用 `#[serde(flatten)]` 合并借用的 `ProviderEvent` 与 Runtime 传输字段，并通过单次 `serde_json::to_vec()` 生成最终 frame；测试同时锁定信封实现约束与完整传输字段输出。

**Stop Conditions:**

- 如果 `ProviderEvent` 与 Runtime 传输字段出现 serde key 冲突，或现有 Schema 允许 Provider Event 携带传输字段，则停止并重新确定协议边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-3.test.ts && cargo test -p code-agent-runtime --test event_stream --locked && cargo test -p code-agent-protocol --locked && cargo test -p code-agent-provider-codex --test mapping --locked`

Expected: 仓库契约、Runtime Event Stream、Protocol 与 Provider 映射测试全部通过，最终 frame 保持协议等价且源码不再包含热路径 `to_value()`/对象插入。
