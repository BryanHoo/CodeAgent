# Tauri Phase 3 Implementation Plan

**Goal:** 完成 `docs/tauri-migration-plan.md` Phase 3，建立由 TypeScript TypeBox Schema 单向生成的 Rust Protocol、领域端口、可构建且可关闭的 Runtime 控制面，以及具有顺序、合并、保留、回放和重同步语义的 Rust Agent Event Stream。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Rust Workspace、验证和跨包公共边界。
- `.superwork/spec/backend/directory-structure.md` — 约束 Core、Provider、Runtime 与 Delivery 职责。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束有界队列、幂等、取消、事件和关闭树。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Schema、错误、安全和测试。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Core、Platform、Provider 和 Runtime 依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束协议单一来源、事件版本与运行时校验。
- `docs/tauri-migration-plan.md` — 定义 Phase 3 实施项和验收项。

**Architecture:** `packages/protocol` 继续作为公开 Schema 单一来源，并导出一个版本化、确定性排序的 Rust Runtime Schema bundle；`code-agent-protocol-gen` 使用锁定的 `typify` 生成可审查的 `crates/protocol/src/generated.rs`。`code-agent-core` 只维护标识符、错误和 Repository/Provider/Git/File/Attachment/Clock/Update ports；`code-agent-runtime` 通过 type-state Builder 强制注入 ports，使用 Tokio 有界队列、`CancellationToken` 和受跟踪任务实现请求注册、幂等、取消与关闭。事件流在 Runtime 内分配 session/sequence，按相邻 key 合并 Delta，以事件数和 UTF-8 字节双预算保留，并在缺口、淘汰或 session 变化时要求 Snapshot 重同步。

**Tech Stack:** Rust 2024、Serde、Typify、Tokio、tokio-util、thiserror、TypeScript 6、TypeBox、Vitest、pnpm 11。

## Global Constraints

- TypeScript TypeBox Schema 是公开协议唯一来源；生成文件必须提交且 drift check 不允许手工编辑。
- Runtime、Core、Protocol 不依赖 Tauri、N-API、Fastify 或具体 Codex/SQLite 实现。
- 所有请求和事件队列同时具有数量上限；事件保留还必须具有 UTF-8 序列化字节上限。
- Provider 事件不携带 `sessionId`、`sequence`、`timestamp`、`version`；这些字段只由 Runtime Event Stream 分配。
- 合并只允许相邻同 key Delta；关键事件、checkpoint、replay 和 shutdown 前先冲刷更早 Delta。
- 取消使用协作式 `CancellationToken`；关闭必须停止接收、取消子任务并有界等待，不依赖 Drop 中的异步清理。
- Phase 3 使用 fake ports 验证 Runtime，不接入真实 SQLite、Git、文件、Codex 或 Tauri Command；这些属于后续阶段。
- 使用项目现有 `pnpm` 和 Cargo lockfile；关键生命周期与边界逻辑添加简短中文注释。

### Task 1: 建立 Protocol Schema 导出与 Rust drift gate

**Files:**

- Create: `packages/protocol/src/rust-runtime-schema.ts`
- Create: `packages/protocol/src/rust-runtime-schema.test.ts`
- Create: `tools/generate-rust-protocol.mjs`
- Create: `schemas/code-agent-runtime.schema.json`
- Create: `crates/protocol/src/generated.rs`
- Modify: `crates/protocol-gen/src/main.rs`
- Modify: `crates/protocol-gen/Cargo.toml`
- Modify: `crates/protocol/src/lib.rs`
- Modify: `crates/protocol/Cargo.toml`
- Modify: `package.json`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`

**Interfaces:**

- Consumes: TypeBox `TSchema`、Project/Task identifiers、settings、Provider capability、errors、Agent Event schemas。
- Produces: `schemas/code-agent-runtime.schema.json`、Serde Rust DTO、`protocol:rust:generate` 和 `protocol:rust:check`。

**Behavior:**

- 导出稳定 `$defs` bundle 并由 Rust generator 生成 DTO；跨平台生成脚本更新两个受版本控制的产物，check 逐字节比较当前生成结果；TS/Rust 使用同一 JSON fixtures 验证序列化往返。

**Stop Conditions:**

- 若生成器不能保留判别联合、严格字段或 camelCase JSON 名称，停止并缩小/修正 Schema，而不是手写第二份公开 DTO。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/rust-runtime-schema.test.ts && pnpm run protocol:rust:check && cargo test -p code-agent-protocol --locked`

Expected: Schema bundle、生成代码和跨语言 fixtures 无 drift，未知字段与非法枚举被拒绝。

### Task 2: 建立 Core 类型与必需 Ports

**Files:**

- Create: `crates/core/src/error.rs`
- Create: `crates/core/src/ports.rs`
- Modify: `crates/core/src/lib.rs`
- Modify: `crates/core/Cargo.toml`

**Interfaces:**

- Consumes: `code-agent-protocol` 生成的 identifiers/settings/capabilities/errors。
- Produces: `RepositoryPort`、`ProviderPort`、`GitPort`、`FilePort`、`AttachmentPort`、`ClockPort`、`UpdatePort` 与统一 `CodeAgentError`。

**Behavior:**

- Ports 只表达领域输入输出和取消上下文；错误使用稳定 code、用户可读 message 与可空 correlation ID，具体基础设施错误不得越过 Core 边界。

**Stop Conditions:**

- 若 Port 必须引用 Tauri、Fastify、rusqlite、git2 或 Codex 原生类型，停止并把类型收敛到 Protocol/Core DTO。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-core --locked`

Expected: fake implementations 可实现全部 ports，错误 JSON round-trip 和稳定 code 测试通过。

### Task 3: 实现 Runtime Builder、请求注册、幂等与关闭树

**Files:**

- Create: `crates/runtime/src/builder.rs`
- Create: `crates/runtime/src/control.rs`
- Create: `crates/runtime/src/idempotency.rs`
- Modify: `crates/runtime/src/lib.rs`
- Modify: `crates/runtime/Cargo.toml`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`

**Interfaces:**

- Consumes: 全部 Core ports、Tokio bounded `mpsc`、`CancellationToken`、受跟踪任务。
- Produces: `CodeAgentRuntimeBuilder`、`CodeAgentRuntime`、`RequestContext`、`OperationRegistry`、`IdempotencyRegistry` 和幂等 `shutdown()`。

**Behavior:**

- Builder 通过 type-state 只在全部必需 ports 已注入时提供 `build()`；活动 request ID 唯一且容量有上限；同 operation/key/payload 复用进行中或成功结果，不同 payload 冲突，失败不缓存；取消和关闭会通知任务并等待释放。

**Stop Conditions:**

- 若实现需要无界 channel、全局可变状态、后台任务脱离跟踪或 Drop 内阻塞等待，停止并修正生命周期设计。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-runtime control idempotency builder --locked`

Expected: 覆盖缺失 port 的编译期边界、容量、重复 key、payload 冲突、取消、重复关闭和关闭后拒绝新请求。

### Task 4: 移植 Rust Agent Event Stream

**Files:**

- Create: `crates/runtime/src/event_stream.rs`
- Create: `crates/runtime/tests/event_stream.rs`
- Modify: `crates/runtime/src/lib.rs`

**Interfaces:**

- Consumes: Provider event DTO、session ID、clock、事件数/字节/单事件预算。
- Produces: `AgentEventStream`、`EventCheckpoint`、`EventReplay`、metrics 和 subscriber receiver。

**Behavior:**

- 分配连续 sequence；相邻相同 key 的 append/replace Delta 按 16ms 窗口合并；关键事件先 flush；环形保留按 count/bytes 淘汰；回放识别 session change、retention overflow、超前 sequence 和单事件超限形成的 gap；慢订阅者不阻塞 Provider 并收到 resync 信号。

**Stop Conditions:**

- 若为保持顺序需要无界缓冲、跨 key 重排或每个订阅者重复序列化同一事件，停止并调整数据结构。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-runtime --test event_stream --locked`

Expected: 正常流、相邻/A-B-A 合并、关键事件 flush、sequence gap、session change、双预算淘汰、慢消费者和 shutdown 全部通过。

### Task 5: 增加 Runtime 集成测试与 Phase 3 门禁

**Files:**

- Create: `crates/runtime/tests/runtime_integration.rs`
- Create: `tests/tauri-phase-3.test.ts`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `docs/tauri-migration-plan.md`

**Interfaces:**

- Consumes: fake ports、Runtime Builder、operation/idempotency/cancellation/event stream API、现有 CI。
- Produces: `protocol:rust:check`、Phase 3 仓库契约和完整 Rust/TypeScript 回归门禁。

**Behavior:**

- fake Provider/Repository 覆盖正常请求、Provider failure、取消、重复 idempotency key、sequence gap、retention overflow 与 shutdown；CI 和 `pnpm check` 执行 protocol drift；架构测试拒绝 Runtime 引入宿主框架或无界 channel。

**Stop Conditions:**

- 若完整门禁因 Phase 3 外的既有失败阻塞，记录独立证据；Phase 3 自身 targeted tests、Rust clippy 和 drift gate 必须全部通过。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e && pnpm check:rust`

Expected: TypeScript、Rust、协议 drift、架构、性能和 E2E 门禁通过，Phase 3 五项状态均为 completed。
