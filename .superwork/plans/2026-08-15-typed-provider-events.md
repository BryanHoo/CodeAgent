# Feature Implementation Plan

**Goal:** 将 Provider 事件内部热路径从 `serde_json::Value` 迁移为强类型事件，并保留外部 JSON Schema 边界校验与现有 wire contract。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Rust、Protocol、Provider 与验证流程。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Provider 事件映射、归属、订阅与 Runtime 生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束事件 Schema、传输边界、性能和回归测试。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公共协议、边界校验和消费者同步。

**Architecture:** 在 Rust Protocol 层定义可判别的强类型 Provider Event，`parse_provider_event` 只负责外部 JSON Schema 校验后立即反序列化；Core Port 和 Runtime Channel 只传强类型。Runtime 基于枚举分派、合并并直接序列化传输信封，避免动态字段查找。Codex 高频 Delta 映射直接构造强类型事件，复杂低频事件仍可在 Provider 边界通过 Schema 解析进入同一内部类型。

**Tech Stack:** Rust、Serde、serde_json、JSON Schema、Tokio、Cargo、pnpm

## Global Constraints

- 保持 `AgentProviderEvent` 与 `EventStreamMessage` 的现有 JSON wire contract，不修改版本字段或事件语义。
- 外部动态 JSON 只能在 Provider/Protocol 边界存在；Core Port、订阅队列和 Runtime 合并不得依赖动态字段查找。
- 高频文本事件不得执行 `json!`、完整 JSON Schema 遍历或中间 JSON 分配。
- 新增生产 Rust 文件不超过 500 行，并优先减少热路径分配与克隆。

### Task 1: 建立强类型 Provider Event 与 Runtime 合并路径

**Files:**

- Create: `crates/protocol/src/provider_event.rs`
- Create: `crates/protocol/src/provider_event/access.rs`
- Modify: `crates/protocol/src/lib.rs`
- Modify: `crates/core/src/ports.rs`
- Modify: `crates/runtime/src/event_stream.rs`
- Modify: `crates/runtime/src/lib.rs`
- Test: `crates/protocol/src/lib.rs`
- Test: `crates/runtime/tests/event_stream.rs`
- Test: `crates/runtime/tests/idempotent_mutations.rs`
- Test: `crates/runtime/tests/platform_tasks.rs`
- Test: `crates/runtime/tests/settings_validation.rs`

**Interfaces:**

- Consumes: `AgentProviderEvent` JSON Schema、现有 `ProjectProviderPort::subscribe_events` wire semantics
- Produces: `ProviderEvent`、`ProviderEventKind`、强类型 Delta 合并与一次性 wire serialization

**Behavior:**

- 将 Schema 校验后的 JSON 立即转换为可判别强类型事件；Runtime 使用枚举字段计算合并键并追加 Delta，发布结果保持现有 JSON 完全兼容。

**Stop Conditions:**

- 如果现有 JSON Schema 无法无损映射到稳定的强类型事件，停止并报告具体不兼容分支。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-protocol -p code-agent-runtime`

Expected: Protocol round-trip 与 Runtime 合并、顺序、容量和恢复测试全部通过。

### Task 2: 让 Codex 高频事件直接构造强类型事件

**Files:**

- Modify: `crates/protocol/src/provider_event.rs`
- Modify: `crates/protocol/src/provider_event/access.rs`
- Create: `crates/provider-codex/src/mapping/deltas.rs`
- Create: `crates/provider-codex/src/mapping/plans.rs`
- Modify: `crates/provider-codex/src/mapping/mod.rs`
- Modify: `crates/provider-codex/src/mapping/events.rs`
- Modify: `crates/provider-codex/src/project_provider.rs`
- Modify: `crates/provider-codex/src/project_provider/events.rs`
- Modify: `crates/provider-codex/src/task_state.rs`
- Modify: `crates/provider-codex/src/mcp.rs`
- Modify: `crates/provider-codex/src/provider/notifications.rs`
- Modify: `crates/provider-codex/src/project_provider/requests.rs`
- Test: `crates/provider-codex/tests/contracts.rs`
- Test: `crates/provider-codex/tests/mapping.rs`
- Test: `crates/provider-codex/tests/pending_requests.rs`
- Test: `crates/provider-codex/tests/provider.rs`

**Interfaces:**

- Consumes: `ProviderEvent` constructors、Codex notification mapping contract、Provider event Schema boundary
- Produces: 无 `json!`/Schema 遍历的文本 Delta 映射、强类型 Provider 广播与状态观察

**Behavior:**

- 对 `message.delta`、`command.output_delta`、`plan.delta` 和 `reasoning.delta` 直接构造强类型事件；低频动态事件在单一边界解析后进入同一类型，订阅溢出与状态缓存不再通过 JSON pointer 读取热路径字段。

**Stop Conditions:**

- 如果 Codex 映射测试显示现有事件 wire 输出发生非预期变化，停止并保留差异证据。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex`

Expected: Provider 映射、契约、订阅、Pending Request 与历史测试全部通过，Delta wire 输出保持兼容。
