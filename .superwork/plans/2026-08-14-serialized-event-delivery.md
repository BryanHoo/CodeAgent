# Feature Implementation Plan

**Goal:** 减少实时事件在 Node WebSocket 与 Tauri Delivery 边界上的重复复制和 UTF-8 编解码，同时保留 Rust `PublishedEvent` 的双表示。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — Workspace 性能、边界与验证总规则。
- `.superwork/spec/backend/quality-guidelines.md` — 实时事件、WebSocket 与性能测试约束。
- `.superwork/spec/shared/quality-guidelines.md` — Transport 契约与跨宿主一致性要求。

**Architecture:** Server 将 N-API 提供的已序列化 `Uint8Array` 直接作为 binary WebSocket frame 发送，HTTP Transport 使用 `ArrayBuffer` 和单个 `TextDecoder` 解码；Tauri Channel 使用 `InvokeResponseBody::Json` 交付已序列化 frame，避免 `serde_json::Value` 深克隆和再次序列化。N-API 的 `Arc<[u8]> -> Vec<u8>` 拷贝和 Runtime 的 `Arc<[u8]>`/`Arc<Value>` 双表示保持不变，待独立基准证明可安全调整后再处理。

**Tech Stack:** Rust、N-API、TypeScript、Fastify WebSocket、Tauri v2、Vitest

## Global Constraints

- 单文件不得超过 500 行，性能是首要实现原则。
- 保留 `PublishedEvent` 的 `Arc<[u8]>` 与 `Arc<Value>` 双表示，不把内存优化转化为重复 JSON 解析。
- WebSocket 只发送 binary frame，浏览器只执行一次 UTF-8 解码；不保留旧文本帧兼容分支。
- Tauri 不使用小 payload 的 raw IPC 字节数组路径，避免 Tauri 将字节展开为 JSON array。
- 关键逻辑添加简短、清晰的中文注释。
- 使用项目既有 pnpm 命令；Python 命令只使用 `python3`。
- 不启动开发服务器。

### Task 1: 锁定 binary WebSocket 契约和对比基准

**Files:**

- Modify: `tests/performance/server-event-route.test.ts`
- Modify: `packages/transport-http/src/event-client.test.ts`

**Interfaces:**

- Consumes: `CodeAgentEngine.eventSubscribe` 的 `Uint8Array` frame、浏览器 `WebSocket` MessageEvent。
- Produces: `BinaryDeliveryTestEvidence`，覆盖 frame 类型、单次 UTF-8 解码与 A/B 性能数据。

**Behavior:**

- 证明 Server 发送 binary WebSocket frame，HTTP Transport 将 socket 配置为 `arraybuffer`，且事件 JSON 只从该二进制 payload 解码一次。

**Stop Conditions:**

- 若 `ws` 或浏览器 WebSocket 无法稳定提供 binary/`ArrayBuffer` 契约，则停止并重新评估协议边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/transport-http/src/event-client.test.ts --config vitest.config.ts`

Expected: 新增契约测试在生产代码修改前失败，并在 Task 2 后通过。

### Task 2: 实现 binary WebSocket 与浏览器单次解码

**Files:**

- Modify: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/transport-http/src/event-client.ts`
- Test: `packages/transport-http/src/event-client.test.ts`
- Test: `tests/performance/server-event-route.test.ts`

**Interfaces:**

- Consumes: N-API 回调提供的已序列化 `Uint8Array` 与 `BinaryDeliveryTestEvidence`。
- Produces: `BinaryEventDeliveryContract`，包含 WebSocket binary frame 与经协议校验的 `EventStreamMessage`。

**Behavior:**

- Server 直接发送现有字节 frame；浏览器通过 `TextDecoder` 解码 `ArrayBuffer` 并用 `byteLength` 记录 wire bytes，删除字符串重编码路径。

**Stop Conditions:**

- 若真实 WebSocket 测试未报告 binary frame，或协议与性能断言失败，则停止在本任务修复，不进入 Tauri 改动。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run --config vitest.performance.config.ts tests/performance/server-event-route.test.ts`

Expected: 100,000 帧真实 WebSocket 性能测试通过，并输出 binary 相对文本路径的测量结果。

### Task 3: 从已序列化 frame 交付 Tauri 事件

**Files:**

- Modify: `apps/desktop/src-tauri/src/commands/events.rs`
- Modify: `tests/tauri-phase-5.test.ts`

**Interfaces:**

- Consumes: `PublishedEvent::frame()` 与 Tauri `Channel<InvokeResponseBody>`。
- Produces: `TauriSerializedFrameContract`，使用 `InvokeResponseBody::Json` 且前端继续直接接收 `EventStreamMessage` 对象。

**Behavior:**

- replay 与 live 事件将已序列化 UTF-8 frame 转成 Tauri JSON response body，不再调用 `event.value().clone()`，控制消息保持单次序列化；仓库契约测试同步锁定新 Channel 类型。

**Stop Conditions:**

- 若 Tauri Channel 无法把 `InvokeResponseBody::Json` 保持为现有 JS 对象契约，或测试观察到 Raw 字节数组路径，则停止并恢复到协议层设计评估。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-desktop events --locked`

Expected: Tauri event command 测试通过，并明确观察到 `InvokeResponseBody::Json`。

### Task 4: 完成跨边界验证

**Files:**

- Modify: `.superwork/plans/2026-08-14-serialized-event-delivery.md`

**Interfaces:**

- Consumes: `BinaryDeliveryTestEvidence`、`BinaryEventDeliveryContract` 与 `TauriSerializedFrameContract`。
- Produces: `SerializedEventDeliveryVerification`，包含 TypeScript、Rust、性能与架构门禁结果。

**Behavior:**

- 运行格式、Lint、类型、Vitest、Rust check/clippy/test 以及目标性能测试，确认无协议回归且 Rust 双表示仍保留。

**Stop Conditions:**

- 任一门禁失败时停止完成声明，定位并修复与本次改动相关的问题。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm check:rust`

Expected: 本次改动的 TypeScript、Desktop Rust 与目标性能门禁通过；若完整 Workspace 门禁被无关既有问题阻断，记录精确位置与定向验证结果。

## Verification Evidence

- `pnpm check`：通过，109 个测试文件、757 个测试通过。
- `pnpm exec vitest run --config vitest.performance.config.ts tests/performance/server-event-route.test.ts`：通过，binary 编解码代理基准 `275.65 ms`，旧文本路径 `681.00 ms`；真实 100,000 帧耗时 `429.34 ms`。
- `cargo clippy -p code-agent-desktop --all-targets --locked -- -D warnings`：通过。
- `cargo test -p code-agent-desktop --locked`：通过，17 个测试通过。
- `pnpm check:rust`：Workspace `cargo check` 通过；完整 Clippy 被 `crates/platform/tests/performance_budgets.rs:49` 与 `:89` 的既有 `await_holding_lock` 拒绝，与本次改动无关。
- `cargo test --workspace --locked`：`project_open::tests::observed_launch_preserves_process_stderr` 首次出现时序失败；定向复跑通过。
