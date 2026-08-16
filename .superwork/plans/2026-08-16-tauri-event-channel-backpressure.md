# Feature Implementation Plan

**Goal:** 让 Tauri 事件交付改为轻量 Channel 通知加有界 pull，使慢 WebView 无法把业务载荷堆进无界 IPC Map，并让 Runtime 现有订阅队列与 resync 对 Desktop 生效。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束有界队列、性能优先和跨层契约同步。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Event Stream 慢订阅者 resync、有界订阅和 Tauri 关闭顺序。
- `.superwork/spec/shared/quality-guidelines.md` — 约束当前 Channel 逐帧 JSON 交付及可信内部事件不重复 Schema 校验。
- `.superwork/spec/shared/directory-structure.md` — 约束 `transport-tauri` 与 Runtime 宿主无关边界。
- `.superwork/spec/frontend/state-management.md` — 约束 `sequence` 连续性与 `resync.required`。
- `.superwork/prd/2026-08-16-tauri-event-channel-backpressure-design.md` — 选定 notify + pull + raw Response 方案与预算常量。

**Architecture:** Desktop 为每个订阅维护 64 事件 / 256 KiB mailbox；Runtime `send` Future 在 `admit` 等待。Channel 只发送 `{ "type": "event.available" }`。前端单飞 `event_pull` 以 length-prefixed raw Response 取回 Runtime 已序列化 frame。HTTP 与 N-API 不变。

**Tech Stack:** Rust 2024、Tokio、Tauri 2.11.5、TypeScript、Vitest、pnpm。

## Global Constraints

- 单文件不得超过 500 行，特殊生成文件除外。
- 性能优先：业务 frame 只在 Runtime 序列化一次，mailbox 保存 `Arc<[u8]>`，pull 只做有界字节拼接。
- Runtime 保持宿主无关，不得解析 Tauri Channel 或 pull 协议。
- 不得使用全局窗口 `emit` / `listen`。
- 不得把 mailbox 或 pull API 提升为 Protocol / Client 公共契约。
- 关键领域逻辑添加清晰、简短的中文注释。

### Task 1: 实现有界 mailbox 与 raw 批次编码

**Files:**

- Create: `apps/desktop/src-tauri/src/event_mailbox.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**

- Consumes: Runtime serialized `Arc<[u8]>` event frames
- Produces: `EventMailbox` bounded admit/pull/close/encode/clamp/notify-hint API

**Behavior:**

- mailbox 在 64 事件或 256 KiB 时让 `admit` 等待，`pull` 按调用方预算取出且非空时至少一帧；单帧超预算仍入队一帧；`close` 唤醒等待者为 false；`encode_pull_batch` 写出 `CAEP` magic、frame_count 与 length-prefixed UTF-8 frames；`clamp_pull_budget` 将 `maxEvents`/`maxBytes` 限制到 `[1, 64]` 与 `[1, 256 KiB]`；空到非空且无未确认通知时给出 notify hint。

**Stop Conditions:**

- 若在不引入无界缓冲或重新 JSON 序列化的前提下无法让 `admit` 等待 pull，则停止并重新评估所有权边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-desktop event_mailbox --locked`

Expected: admit 等待、pull 唤醒、关闭、超预算单帧、空批次编码、预算钳制和 notify hint 测试全部通过。

### Task 2: 将订阅发送改为 mailbox 并暴露 pull command

**Files:**

- Modify: `apps/desktop/src-tauri/src/commands/events.rs`
- Modify: `apps/desktop/src-tauri/src/lifecycle.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Test: `tests/tauri-phase-5.test.ts`

**Interfaces:**

- Consumes: `EventMailbox` bounded admit/pull/close/encode/clamp/notify-hint API
- Produces: `event_pull` raw Response command and notify-only `event_subscribe` Channel

**Behavior:**

- `event_subscribe` 注册 mailbox，将 Runtime send 设为 `admit`，Channel 只发送 `{ "type": "event.available" }` 且按 hint 合并；`event_pull` 返回 `tauri::ipc::Response` raw 字节；未知订阅返回 `not_found`；unsubscribe 与 `DesktopLifecycle::shutdown` 在 Runtime 关闭前 `close_all`；契约测试禁止 Channel 发送业务 frame，并要求注册 `event_pull` 与有界常量。

**Stop Conditions:**

- 若 Tauri 2.11.5 的 command `Response` 仍把批次编码成 JSON `number[]` 业务信封且没有 raw 字节路径，则停止并报告宿主限制。
- 若必须把 checkpoint 或 resync 状态机搬回 Tauri 才能完成 pull，则停止并保持 Runtime 为唯一状态机。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-desktop --locked && pnpm exec vitest run tests/tauri-phase-5.test.ts`

Expected: Desktop crate 测试通过，phase-5 契约断言 notify-only Channel、`event_pull` 与 mailbox 有界常量。

### Task 3: 让 Tauri Transport 按通知单飞拉取批次

**Files:**

- Modify: `packages/transport-tauri/src/event-subscription.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `event_pull` raw Response command and notify-only `event_subscribe` Channel
- Produces: `startTauriEventSubscription` notify-and-pull loop

**Behavior:**

- Channel `event.available` 唤醒最多一个 in-flight `event_pull`；解析 raw 批次后按现有 `connection.ready`、连续 `sequence` 和 `resync.required` 规则交付，`wireBytes` 使用 `frame_len`；打满预算则继续 pull，空批次且无待处理通知则等待；卸载或 resync 忽略过期 pull 并 `event_unsubscribe`。

**Stop Conditions:**

- 若 `SubscribeAgentEventsOptions` 或 Web Project Runtime 必须改签名才能消费批次，则停止并保持宿主无关 facade。
- 若 mock IPC 无法表达 raw 批次且没有等价的 `ArrayBuffer` / `Uint8Array` / `number[]` 归一路径，则停止并报告测试缺口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: ready/连续事件、预算后续拉、空批次停止、本地 gap、服务端 resync 与 unsubscribe 测试全部通过。

### Task 4: 更新交付规范并完成跨层验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `tests/tauri-phase-5.test.ts`
- Modify: `.superwork/plans/2026-08-16-tauri-event-channel-backpressure.md`

**Interfaces:**

- Consumes: `startTauriEventSubscription` notify-and-pull loop
- Produces: spec-backed Tauri notify-and-pull event delivery rules

**Behavior:**

- 规范改为 Channel 只唤醒、pull 返回 raw 批次、`send` Future 等待 mailbox；删除逐帧 `EventStreamMessage` Channel 交付要求；HTTP 与 N-API 原文保留；完整质量门验证 Desktop、Transport 与契约。

**Stop Conditions:**

- 若完整验证发现与本次交付改动无关的既有失败，则记录证据并仅修复本次变更引入的问题。

- [x] **Task Status:** completed

Run: `pnpm check:rust && pnpm check`

Expected: Rust Workspace、格式、Lint、依赖边界、类型和 Vitest 全部通过，规范与实现一致。
