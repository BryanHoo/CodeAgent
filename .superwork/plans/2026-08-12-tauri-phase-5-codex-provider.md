# Tauri Phase 5 Implementation Plan

**Goal:** 完成 `docs/tauri-migration-plan.md` Phase 5，将 Codex App Server 进程、JSONL RPC、通知映射、能力发现与实时任务链路（任务/回合/审批/评审/MCP/终端/连接）迁入 `code-agent-provider-codex` 与 `code-agent-runtime`，Desktop 通过 typed Commands 与 Tauri Channel 提供与 HTTP 契约一致的完整实时能力。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束协议单一来源、验证命令、Desktop 构建与 Codex schema 基线门禁。
- `.superwork/spec/backend/directory-structure.md` — 约束 Provider、Runtime、Delivery 职责边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束有界队列、幂等、取消、事件流与关闭树。
- `.superwork/spec/backend/quality-guidelines.md` — 约束子进程、错误、路径与测试。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol/Core/Provider/Runtime 依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 TypeBox 单一来源与跨语言 fixtures。
- `docs/tauri-migration-plan.md` — Phase 5 实施项、验收项与 §6.2/§6.4/§6.6 设计。

**Architecture:** TS 领域契约是 `AgentProvider`（项目作用域）+ `AgentRuntimeProvider`（全局），Rust 侧以 `ProviderPort`（全局）+ `ProjectProviderPort`（项目作用域）镜像。`crates/provider-codex` 自底向上分四层：二进制定位与进程生命周期、JSONL RPC 客户端（双向、有界、超时与 -32001 重试）、纯函数协议映射层（Codex 通知/条目/服务端请求 → 经 schema 校验的 `RawProviderEvent` 与领域 DTO）、会话编排（任务态、resume 去重、pending 生命周期、review worker 路由、连接服务）。`code-agent-runtime` 新增惰性 per-project 上下文：持有 Provider 订阅接收器并转发进既有 `AgentEventStream`，快照与 checkpoint 对齐。Desktop 用真实 Codex Provider 替换 `DesktopHostPorts` stub，新增 tasks/turns/events Commands，事件经 `tauri::ipc::Channel` 以与 HTTP `EventStreamMessage` 相同的信封投递；Codex 二进制由准备脚本从锁定的 `@openai/codex` 提取为 externalBin，运行时仅由 Rust 后端 spawn。旧 TypeScript Provider/Server 实现继续服务 Web/Node，待 Phase 7 两个宿主均切换 Rust Engine 后统一删除，与 Phase 4 决策一致。

**Tech Stack:** Rust 2024、Tokio、Serde、Typify、reqwest(rustls)、Tauri 2.11、TypeBox、TypeScript 6、Vitest、pnpm 11。

## Global Constraints

- TypeBox Schema 是 TS/Rust 公共 DTO 唯一来源；typify 无法无损表达的复杂联合按 `AgentProviderEvent` 先例从生成排除并提供手写 `parse_*` 校验，禁止静默放宽校验或手写第二份公开 DTO。
- 领域契约以 `packages/core/src/agent-provider.ts` 的 `AgentProvider`/`AgentRuntimeProvider` 方法面为准；“queue” 是客户端 Composer 行为（`followUpBehavior`），禁止新造服务端 queue RPC。
- Codex 进程只由 Rust 后端以参数数组直接 spawn（无 shell、Windows 隐藏窗口），Renderer 不获得任何 spawn/shell/任意 fs 权限；关闭按 stdin 关闭 → SIGTERM → SIGKILL 有界升级，Codex 意外退出必须拒绝全部 pending RPC、转化为 Runtime failure 并通知活跃订阅。
- Provider 事件不携带 `provider`/`sequence`/`sessionId`/`timestamp`/`version`；传输字段只由 Runtime `AgentEventStream` 分配。事件订阅队列有界，慢消费者被踢出并收到 resync；Tauri Channel 信封与 HTTP `EventStreamMessage`（`connection.ready`/`resync.required`/AgentEvent）逐字段一致。
- 所有队列与缓冲有界：JSONL 单帧/缓冲 64 MiB、RPC 默认超时 30s、-32001 重试上限 4 次/5s 窗口、pending 终态缓存上限 1000、事件流沿用容量 1000/单事件 1 MiB/保留 4 MiB。
- Rust Codex 版本常量必须与 TS `SUPPORTED_CODEX_VERSION`（0.147.0）一致并由门禁校验；`codex:schema:check` 基线机制保持不变。
- 新增 HTTP 客户端依赖只允许 rustls TLS，禁止引入 openssl；Cargo workspace 依赖使用精确版本锁定。
- 旧 TypeScript 实现不删除、不双写；每个切片用现有 TS fixtures/测试对照 Rust 行为。
- 项目命令使用 pnpm，Python 使用 python3；关键生命周期与安全边界添加简短中文注释。

### Task 1: 扩展 Phase 5 协议 DTO 与 Rust 校验助手

**Files:**

- Modify: `packages/protocol/src/rust-runtime-schema.ts`
- Modify: `packages/protocol/src/rust-runtime-schema.test.ts`
- Modify: `schemas/code-agent-runtime.schema.json`
- Modify: `crates/protocol-gen/src/main.rs`
- Modify: `crates/protocol/src/generated.rs`
- Modify: `crates/protocol/src/lib.rs`
- Test: `packages/protocol/src/rust-runtime-schema.test.ts`

**Interfaces:**

- Consumes: `AgentTaskSchema`、`AgentTaskSnapshotSchema`、`EventStreamMessageSchema`、`EventCheckpointSchema`、`PendingRequestSchema`、`StartAgentTurnRequestSchema` 等 `packages/protocol` 既有导出
- Produces: 扩展后的 `$defs` bundle、typify 排除清单、`crates/protocol` 手写 `parse_agent_task_snapshot`/`parse_pending_request`/`parse_event_stream_message` 等校验助手

**Behavior:**

- 在 `createRustRuntimeSchemaDocument().$defs` 增加 Phase 5 领域类型：任务与快照（含 checkpoint 响应）、回合输入/输出（start/steer/interrupt）、审批（PendingRequest 及 resolve 请求/响应）、评审目标与请求、事件流消息（connection.ready/resync.required/checkpoint）、分页（tasks/models/skills/mcp servers/background terminals）、连接操作（官方登录开始/取消、登出、自定义配置）与提交信息生成请求/响应；简单类型进 typify 生成，含 `AgentItem`/`AgentEvent` 等复杂联合的类型按既有先例排除生成并在 `crates/protocol/src/lib.rs` 提供内嵌 schema 校验的 `parse_*` 助手；TS 侧测试断言 `$defs` 键集合与 JSON 产物无 drift。

**Stop Conditions:**

- 若 typify 对新增简单类型仍产生同名 payload 合并或字段丢失，且无法通过排除+手写校验覆盖，则停止并先修正 TypeBox Schema，而不是放宽 Rust 校验。

- [x] **Task Status:** completed

Run: `pnpm run protocol:rust:check && cargo test -p code-agent-protocol --locked`

Expected: schema bundle 与生成代码无 drift，新增 `parse_*` 助手对合法/缺字段/非法枚举 fixtures 通过。

### Task 2: 实现 Codex 二进制定位、进程生命周期与 JSONL RPC 客户端

**Files:**

- Create: `crates/provider-codex/src/binary.rs`
- Create: `crates/provider-codex/src/process.rs`
- Create: `crates/provider-codex/src/rpc.rs`
- Modify: `crates/provider-codex/src/lib.rs`
- Modify: `crates/provider-codex/Cargo.toml`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Create: `crates/provider-codex/tests/bin/fake_codex.rs`
- Test: `crates/provider-codex/tests/rpc.rs`
- Test: `crates/provider-codex/tests/process.rs`

**Interfaces:**

- Consumes: `tokio::process`、`PortRequestContext`、`CodeAgentError`
- Produces: `locate_codex_binary`/`check_codex_version`（常量 `SUPPORTED_CODEX_VERSION = "0.147.0"`）、`CodexAppServerProcess`（spawn/`app-server --listen stdio://`/initialize 握手/stderr 环形缓冲/退出监视/关闭升级）、`JsonlRpcClient`（request/notify/双向 server request 处理器、关闭语义）

**Behavior:**

- 二进制解析顺序为显式路径 → `CODE_AGENT_CODEX_BIN` → 调用方提供的候选路径列表，`--version` 输出必须精确匹配支持版本；JSONL 客户端按行分帧（兼容 `\r\n`、跨 chunk 缓冲、64 MiB 单帧/缓冲上限）、单调数字 id 关联 oneshot 响应、默认 30s 超时、`-32001` 且 `retry:true` 时按指数退避重发同一请求（≤4 次且总窗口 5s）、畸形帧立即失败全部 pending 并关闭连接；服务端请求（string|number id）路由到注册处理器并可回 result/error；关闭升级依次为 stdin 关闭 → 等待 2s → SIGTERM（Unix，经 libc）→ 等待 2s → kill，全程 `kill_on_drop` 兜底；`fake-codex` 测试二进制通过 `FAKE_CODEX_SCENARIO` 环境变量加载脚本化场景，覆盖握手、乱序响应、服务端请求、超时、malformed 帧与意外退出。

**Stop Conditions:**

- 若响应关联需要无界缓冲、关闭升级依赖 Drop 中的异步等待，或 fake 二进制无法跨平台复现关键故障场景，则停止并修正进程边界设计。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test rpc --test process --locked`

Expected: 握手、关联、超时、重试上限、malformed 帧、服务端请求往返、退出拒绝 pending 与关闭升级测试全部通过。

### Task 3: 实现 Codex 协议映射层

**Files:**

- Create: `crates/provider-codex/src/mapping/mod.rs`
- Create: `crates/provider-codex/src/mapping/common.rs`
- Create: `crates/provider-codex/src/mapping/events.rs`
- Create: `crates/provider-codex/src/mapping/items.rs`
- Create: `crates/provider-codex/src/mapping/turns.rs`
- Create: `crates/provider-codex/src/mapping/server_requests.rs`
- Modify: `crates/provider-codex/src/lib.rs`
- Create: `crates/provider-codex/tests/fixtures/mapping/`
- Test: `crates/provider-codex/tests/mapping.rs`

**Interfaces:**

- Consumes: Codex 通知/条目/服务端请求 JSON（`serde_json::Value`）、`code_agent_protocol::parse_provider_event`
- Produces: `map_codex_notification -> Option<RawProviderEvent>`、`map_codex_item`/`map_codex_turn`/`map_context_usage`、`map_codex_server_request -> PendingRequest 草稿`、通知分类三集合（mapped/ignored/special）

**Behavior:**

- 按 TS `codex-event-mapping.ts`/`codex-item-mapping.ts`/`codex-mapping-common.ts` 的映射表逐项移植：`turn/started|completed`、`item/*` delta 与状态、`turn/plan/updated`、`turn/diff/updated`、`thread/tokenUsage/updated`、`error|warning|guardianWarning`、`model/*`、`hook/*`、审批三类服务端请求等；命令输出与 diff 沿用字节预算裁剪；映射产物全部通过 `parse_provider_event`/`parse_pending_request` 校验；映射失败丢弃该通知并记录 warn，不得中断 RPC 流；fixtures 从 TS 测试用例提取为 JSON 对（Codex 输入 → 期望领域事件），保证跨语言行为一致。

**Stop Conditions:**

- 若任一映射产物无法通过公共 schema 校验，或必须在事件中携带传输字段/绝对路径才能表达，则停止并修正映射或 Schema。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test mapping --locked`

Expected: 全部通知映射 fixtures、条目/使用量/审批草稿映射、未知通知丢弃与 schema 校验测试通过。

### Task 4: 扩展 Provider 端口并实现会话编排与连接服务

**Files:**

- Modify: `crates/core/src/ports.rs`
- Modify: `crates/core/src/lib.rs`
- Modify: `crates/core/Cargo.toml`
- Create: `crates/provider-codex/src/provider.rs`
- Create: `crates/provider-codex/src/project_provider.rs`
- Create: `crates/provider-codex/src/pending.rs`
- Create: `crates/provider-codex/src/task_state.rs`
- Create: `crates/provider-codex/src/connection.rs`
- Create: `crates/provider-codex/src/transcript.rs`
- Modify: `crates/provider-codex/src/lib.rs`
- Modify: `crates/provider-codex/Cargo.toml`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Test: `crates/provider-codex/tests/provider.rs`

**Interfaces:**

- Consumes: `JsonlRpcClient`、映射层、`Project` DTO、Codex home 路径（rollout 转录）
- Produces: `ProviderPort` 全局方法面扩展与 `ProjectProviderPort`、`CodexRuntimeProvider`（capabilities/models/默认设置/连接操作/for_project/release_project）、`CodexProjectProvider`（start_task/list_tasks/read_task/pin/rename/archive/fork/compact/unsubscribe/start_turn/steer_turn/interrupt_turn/start_review/resolve_pending_request/list_skills/list_mcp_servers/reload_mcp_servers/list_background_terminals/terminate_background_terminal/upload_feedback/subscribe_events）

**Behavior:**

- `ProviderPort` 扩展为全局方法面（capabilities/models/默认设置/连接操作）并新增 `for_project -> Arc<dyn ProjectProviderPort>` 与 `release_project`；`ProjectProviderPort` 表达上述任务/回合/审批/评审/MCP/终端/技能/反馈/事件订阅方法，事件订阅返回有界 `mpsc` 接收器并支持 include_ephemeral 过滤。随后移植 TS 编排语义：`thread/*`、`turn/*`、`review/start`（inline delivery 与 worker 子线程到父任务的事件/interrupt 重路由）、`startTurn` 前强制 `thread/resume` 且 App Server 生命周期内去重、任务态内存缓存（usage/plan/MCP 状态/review worker 映射）、taskId→project 归属注册防跨项目路由、pending 请求激活/解析/过期生命周期（终态缓存上限 1000，决策映射 accept/acceptForSession/decline/cancel 与 user_input answers）；快照装配合并 `thread/read`、review worker turns、rollout 转录 Skill 恢复（`$CODEX_HOME/sessions/**/rollout-*-{threadId}.jsonl`，有界读取）与内存态；连接服务实现 `config/read`+`account/read` 并行读取、官方 ChatGPT 登录开始/取消、登出、自定义 Provider `config/batchWrite` 与 `{baseUrl}/models` HTTP 发现（reqwest+rustls）；`thread/start` 支持 ephemeral。

**Stop Conditions:**

- 若 review worker 事件无法稳定重路由到父任务、resume 去重需要全局锁跨越 `.await`，或连接凭据会被返回给调用方，则停止并修正编排与安全边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test provider --locked`

Expected: 基于 fake-codex 的完整回合流（started/delta/completed）、审批往返、resume 去重、review 路由、MCP/终端、ephemeral 任务、连接读取与 Codex 退出失败传播测试全部通过。

### Task 5: Runtime 集成 Project 上下文与事件流

**Files:**

- Create: `crates/runtime/src/project_context.rs`
- Modify: `crates/runtime/src/lib.rs`
- Test: `crates/runtime/tests/platform_tasks.rs`
- Test: `crates/runtime/tests/runtime_integration.rs`

**Interfaces:**

- Consumes: `AgentEventStream`、Task 4 交付的 `ProviderPort`/`ProjectProviderPort` 扩展、`RepositoryPort`、`GitPort`
- Produces: Runtime facade 新方法（任务/回合/审批/评审/MCP/终端/技能/模型/能力/连接操作/事件订阅与回放/提交信息生成）、惰性 per-project 上下文注册表与 `release_project_context`

**Behavior:**

- Runtime 使用 fake ports 验证并按 projectId 单飞创建上下文（`sessionId` 随机 UUID，`"temporary"` 哨兵经 `ensure_temporary_project` 解析），上下文持有事件流与 Provider 订阅转发任务（`spawn_tracked`，Provider 事件经 `publish` 进流并运行 16ms flush loop）；`read_task` 合并 Provider 快照、SQLite settings 与 flush 后 checkpoint；任务/回合/审批命令经幂等注册表按 TS 作用域（start-task/start-turn/steer-turn/interrupt-turn/resolve-pending-request）执行；`subscribe_project_events(project_id, after_sequence)` 返回 replay 结果与订阅接收器，gap/retention/session 变化产生 resync；提交信息生成移植 TS 的有界 prompt 构建（64KiB 内联/20KiB 摘要/36KiB 节选预算）并经 ephemeral 任务回合完成，超时与清理有界；项目移除与 shutdown 先释放上下文（unsubscribe→事件流 close→Provider release）再走既有关闭树。

**Stop Conditions:**

- 若上下文创建产生重复事件流、快照 checkpoint 与已发布 sequence 不对齐，或 Provider 崩溃后订阅无法收到失败通知，则停止并修正生命周期。

- [x] **Task Status:** complete

Run: `cargo test -p code-agent-runtime --locked`

Expected: 上下文单飞与释放、事件转发与 resync、快照+checkpoint 对齐、幂等作用域、temporary 解析、提交信息生成与 Provider 失败传播测试通过，既有 Runtime 测试无回归。

### Task 6: Desktop 装配 Commands、Channel 事件订阅与 Codex sidecar

**Files:**

- Create: `apps/desktop/src-tauri/src/commands/tasks.rs`
- Create: `apps/desktop/src-tauri/src/commands/turns.rs`
- Create: `apps/desktop/src-tauri/src/commands/events.rs`
- Modify: `apps/desktop/src-tauri/src/commands/provider.rs`
- Modify: `apps/desktop/src-tauri/src/commands/git.rs`
- Modify: `apps/desktop/src-tauri/src/commands/app.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/platform_adapters.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/scripts/prepare-codex-binary.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `Cargo.lock`
- Test: `apps/desktop/src-tauri/src/commands/events.rs`
- Test: `apps/desktop/src-tauri/src/commands/tasks.rs`

**Interfaces:**

- Consumes: `tauri::ipc::Channel`、Task 5 交付的 Runtime facade 扩展、Task 4 交付的 `CodexRuntimeProvider`、`@openai/codex` 平台包
- Produces: `task_list|task_start|task_read|task_pin|task_rename|task_archive|task_unsubscribe|task_fork|task_compact|task_review|feedback_upload|mcp_servers_list|mcp_servers_retry|terminals_list|terminal_terminate`、`turn_start|turn_steer|turn_interrupt|pending_request_resolve`、`event_subscribe|event_unsubscribe`、`capabilities_get|models_list|skills_list|provider_login_start|provider_login_cancel|provider_logout|provider_custom_configure`、`git_commit_message_generate`、externalBin 配置与准备脚本

**Behavior:**

- Commands 保持 owned DTO + `Result<T, CommandError>`，只做转换与 Runtime 调用；`event_subscribe(project_id, after_sequence, channel)` 分配订阅 ID，由 runtime 跟踪任务把 replay（`connection.ready` + 事件）与实时事件按 `EventStreamMessage` 信封顺序写入 Channel，resync/发送失败/`event_unsubscribe` 时清理订阅；`platform_adapters.rs` 移除 Provider stub，setup 按 `CODE_AGENT_CODEX_BIN` → 可执行文件旁 sidecar（含 target-triple 变体）→ 仓库 `binaries/codex-{triple}` 顺序解析 Codex 后台启动 supervisor（握手失败或退出转为诊断与 Runtime failure，不阻塞窗口显示，不自动重启）；`app_info` 的 codex 版本改用 Rust 常量；准备脚本从锁定的 `@openai/codex` 平台包校验版本/架构/可执行位后复制为 `apps/desktop/src-tauri/binaries/codex-{targetTriple}`（git 忽略产物），并接入 desktop build/dev 脚本；`tauri.conf.json` 增加 `bundle.externalBin`，capabilities 不新增任何 shell/fs 权限。

**Stop Conditions:**

- 若 Channel 无法保证信封顺序、订阅清理遗留 runtime 任务、Renderer 需要 shell 权限才能工作，或 Codex 缺失导致窗口无法启动，则停止并修正装配。

- [x] **Task Status:** complete

Run: `node apps/desktop/scripts/prepare-codex-binary.mjs && cargo test -p code-agent-desktop --locked`

Expected: 准备脚本产出当前平台 sidecar；tasks/turns/events 命令测试（含订阅 replay、resync、unsubscribe 清理与错误映射）通过，既有 desktop 测试无回归。

### Task 7: Tauri Transport 补全 operations 与 subscribeEvents

**Files:**

- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Create: `packages/transport-tauri/src/event-subscription.ts`
- Test: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `CodeAgentTransport` 契约、`@tauri-apps/api` `Channel`、Task 6 的命令名
- Produces: `tasks.*`、`turns.*`、`pending_requests.resolve`、`mcp_servers.*`、`terminals.*`、`capabilities.get`、`models.list`、`skills.list`、`provider_connection.*`、`feedback.upload`、`git.commit_message_generate` 的 operation→command 映射与基于 Channel 的 `subscribeEvents`

**Behavior:**

- `subscribeEvents` 创建 `Channel`，onmessage 按 `EventStreamMessage` 分派：`connection.ready` 触发 `onConnectionState`，`resync.required` 触发 `onResyncRequired` 并停止订阅，事件消息校验 `sessionId` 与连续 `sequence`（gap 时本地合成 `sequence_gap` resync），语义与 HTTP `event-client` 一致；返回的取消函数调用 `event_unsubscribe` 并防止取消后继续投递；请求路径继续传递 `requestId`/`idempotencyKey` 并映射结构化错误；`"temporary"` 项目作用域与普通 projectId 走同一命令参数；未迁移操作（`app.update_install`、`access.pair`、`access.logout`）保持 `unsupported_operation`。

**Stop Conditions:**

- 若 mockIPC 无法覆盖 Channel 消息顺序或取消后仍有事件投递无法阻止，则停止并修正订阅实现而不是放宽测试。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: 新增 operation 映射、订阅 ready/事件/gap/resync/取消、幂等键传递与错误映射测试全部通过且 mocks 清理干净。

### Task 8: Phase 5 门禁、跨路径一致性与迁移状态

**Files:**

- Create: `tests/tauri-phase-5.test.ts`
- Create: `tests/fixtures/phase5/`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `docs/tauri-migration-plan.md`
- Test: `tests/tauri-phase-5.test.ts`

**Interfaces:**

- Consumes: Task 1–7 产物、既有 `tauri-phase-4` 门禁模式、TS `realtime-path.test.ts` fixtures
- Produces: `tauri:phase5:check` 仓库门禁、跨 Delivery 路径一致性 fixtures、Phase 5 完成状态

**Behavior:**

- 门禁断言：provider-codex 无 unbounded channel/shell 拼接/base64、Rust 与 TS Codex 版本常量一致、通知分类集合与 TS 映射表对齐、desktop 注册全部 Phase 5 命令且 capabilities 无新增 shell/fs 权限、事件命令使用 Channel 而非全局 event、runtime crate 仍不依赖宿主框架；跨路径一致性用共享场景 fixture 驱动 Rust Provider+Runtime 产出的事件序列/快照与 TS 路径期望值比较（剥离传输字段后逐项相等）；spec 增补 Phase 5 验证命令与生命周期约束；全部验证通过后更新迁移文档将 Phase 5 标记为已完成并链接本计划。

**Stop Conditions:**

- 若完整门禁暴露 Web/Node 回归或跨路径结果不一致，则停止并修复实现；不得放宽门禁或提前标记完成。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e && pnpm check:rust && pnpm --filter @code-agent/desktop build`

Expected: TypeScript、Rust、协议 drift、Codex schema 基线、架构、安全、E2E 与当前平台未签名 Desktop artifact 全部通过，Phase 5 八项任务状态均为 completed。
