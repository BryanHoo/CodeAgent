# Rust Provider Parity Implementation Plan

**Goal:** 按顺序补齐 Rust 后端的 Prompt/交互能力、运行时可靠性，并把旧 Node Provider 的关键行为固化为 Rust contract tests。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — Rust Runtime、Protocol 生成和验证总规则
- `.superwork/spec/backend/runtime-lifecycle.md` — Codex RPC、Goal、Review、Pending Request、分页和订阅生命周期
- `.superwork/spec/backend/quality-guidelines.md` — Provider 边界校验、附件、Skill 和统一事件契约
- `.superwork/spec/shared/quality-guidelines.md` — TypeBox/Rust DTO 与跨 Delivery 契约规则

**Architecture:** Tauri Command 只解析公共 DTO；Runtime 编排附件生命周期与任务设置；Codex Provider 负责 Skill、原生 Prompt、Goal/Review、通知和分页映射。所有队列、分页、缓存和终态记录保持有界，外部 JSON 在 Provider 边界严格校验。

**Tech Stack:** Rust 2024、Tokio、Serde、TypeBox 生成 DTO、Cargo test/Clippy、pnpm workspace。

## Global Constraints

- 严格按 Task 1-6 顺序执行，不并行跨批实现。
- 生产源码单文件不得超过 500 行；修改既有超限模块时按职责拆分。
- 附件不得经 Tauri JSON/Base64 传输；图片只在 Codex JSONL RPC 边界编码一次，文件优先传递受管路径。
- Provider 与 Runtime 队列、分页、请求终态和缓存必须有界；禁止生产代码 `unwrap`、`expect` 和无界等待。
- 公共协议以 `packages/protocol` 为唯一来源；需要修改时同步生成 Rust DTO 并检查 drift。
- 代码关键逻辑使用简短、明确的中文注释。

### Task 1: 补齐附件与 Skill Prompt

**Files:**

- Modify: `crates/core/src/ports.rs`
- Modify: `crates/platform/src/attachments.rs`
- Create: `crates/runtime/src/prompt.rs`
- Modify: `crates/runtime/src/builder.rs`
- Modify: `crates/runtime/src/lib.rs`
- Create: `crates/provider-codex/src/prompt.rs`
- Modify: `crates/provider-codex/src/project_provider.rs`
- Modify: `crates/provider-codex/src/skill_mapping.rs`
- Modify: `crates/provider-codex/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/commands/turns.rs`
- Test: `crates/platform/tests/attachments.rs`
- Test: `crates/runtime/tests/platform_tasks.rs`
- Test: `crates/provider-codex/tests/provider.rs`

**Interfaces:**

- Consumes: `AgentPromptInput`、`AgentAttachmentReference`、`AgentSkillReference`、`AttachmentPort`、`ProjectProviderPort`
- Produces: 受检的 Provider Prompt、附件 `pending -> task/turn-bound -> released` 生命周期、Codex `UserInput[]`

**Behavior:**

- Tauri start/steer 保留完整 Prompt；Runtime 校验附件归属和 Prompt 总预算，Provider 校验 Skill ID/name 并映射文本、文件、图片、粘贴文本和 Skill 原生输入。RPC 失败不消费附件，成功后绑定 Task/Turn；Turn 终态后释放运行副本，历史授权读取继续由 Provider 历史 Store 接管。

**Stop Conditions:**

- 如果当前锁定 Codex Schema 不支持规范要求的独立 Skill 或文件输入，停止并报告具体 Schema 字段差异。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform -p code-agent-runtime -p code-agent-provider-codex --locked`

Expected: 附件/Skill start 与 steer、失败回滚、终态释放和边界拒绝测试通过。

### Task 2: 实现 Pending Request 状态机

**Files:**

- Create: `crates/provider-codex/src/pending_requests.rs`
- Modify: `crates/provider-codex/src/project_provider.rs`
- Modify: `crates/provider-codex/src/provider.rs`
- Modify: `crates/provider-codex/src/lib.rs`
- Test: `crates/provider-codex/tests/pending_requests.rs`
- Test: `crates/provider-codex/tests/provider.rs`

**Interfaces:**

- Consumes: `RpcServerRequest`、`ResolvePendingRequestInput`、`serverRequest/resolved`、Provider 关闭/Turn 终态
- Produces: 有界 `Pending / Resolving / Resolved / Expired` 注册表和严格的 `pending_request.*` 事件

**Behavior:**

- 串行化创建、身份校验、decision/answers 映射、并发重复响应、RPC 写入失败回滚、过期、Codex 原生解决和关闭清理；只保留有界终态指纹，用户回答事件不得泄露 Secret。

**Stop Conditions:**

- 如果公共 Rust DTO 缺少 Pending Request 判别字段，先更新 TypeBox Schema 并生成 DTO；Schema 生成失败时停止。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test pending_requests --locked`

Expected: Node 生命周期测试对应的正常、拒绝、问答、竞态、过期、重试和清理场景全部通过。

### Task 3: 补齐 Goal 与 Live Review

**Files:**

- Create: `crates/provider-codex/src/goal.rs`
- Create: `crates/provider-codex/src/review.rs`
- Modify: `crates/provider-codex/src/project_provider.rs`
- Modify: `crates/provider-codex/src/provider.rs`
- Modify: `crates/provider-codex/src/task_state.rs`
- Modify: `crates/provider-codex/src/lib.rs`
- Test: `crates/provider-codex/tests/goal_review.rs`

**Interfaces:**

- Consumes: `AgentTurnOptions.goalMode`、`AgentReviewTarget`、review worker Notification、interrupt
- Produces: Goal 首轮状态机、Codex review target 映射、父子 Review Session 路由和正确中断目标

**Behavior:**

- Goal 先更新 Thread 设置，再 `thread/goal/set` 并有界等待自动 `turn/started`，禁止额外 `turn/start`；Review 映射 snake_case target，保存 worker task/turn，折叠内部 Prompt，实时事件归属父 Task，中断实际 worker，并在全部终态清理。

**Stop Conditions:**

- 如果 Goal 自动 Turn 通知缺少可关联的 Thread/Turn 标识，停止并记录锁定 Schema 与测试帧。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test goal_review --locked`

Expected: Goal 调用顺序、超时、Review 路由、Prompt 折叠、worker interrupt 和清理测试通过。

### Task 4: 补齐特殊通知和通用分页

**Files:**

- Create: `crates/provider-codex/src/notifications.rs`
- Create: `crates/provider-codex/src/pagination.rs`
- Create: `crates/provider-codex/src/mcp_mapping.rs`
- Modify: `crates/provider-codex/src/provider.rs`
- Modify: `crates/provider-codex/src/project_provider.rs`
- Modify: `crates/provider-codex/src/connection.rs`
- Modify: `crates/provider-codex/src/lib.rs`
- Test: `crates/provider-codex/tests/notifications_pagination.rs`

**Interfaces:**

- Consumes: Codex special Notification、`model/list`、`mcpServer/list`、`thread/backgroundTerminals/list` cursor pages
- Produces: 登录/MCP/Pending/Goal 特殊状态更新和有界、去重、严格映射的统一分页结果

**Behavior:**

- 显式处理所有 special Notification；分页检测重复 cursor、最大页数和最大条目，逐页映射以减少复制；MCP 只暴露脱敏展示字段并合并 startup status，Terminals 对明确 thread-not-found 返回空页。

**Stop Conditions:**

- Codex Notification 分类全集与锁定 Schema 不一致时，先修正分类门禁，不得加入未知兼容分支。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test notifications_pagination --locked`

Expected: 特殊通知状态、完整分页、重复 cursor、畸形响应、脱敏和 thread-not-found 测试通过。

### Task 5: 补齐 unsubscribe 守卫与事件溢出语义

**Files:**

- Modify: `crates/core/src/ports.rs`
- Modify: `crates/provider-codex/src/project_provider.rs`
- Modify: `crates/provider-codex/src/project_provider/tasks.rs`
- Modify: `crates/provider-codex/src/task_state.rs`
- Modify: `crates/runtime/src/project_context.rs`
- Modify: `crates/runtime/src/event_stream.rs`
- Modify: `crates/runtime/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/commands/events.rs`
- Test: `crates/provider-codex/tests/provider.rs`
- Test: `crates/runtime/tests/event_stream.rs`
- Test: `crates/runtime/tests/runtime_integration.rs`

**Interfaces:**

- Consumes: Task 运行/Review/Pending/Terminal 状态、Provider subscription、Runtime `EventSubscription`
- Produces: 安全的 unsubscribe 拒绝语义、显式 Provider overflow/resync、准确最新 checkpoint

**Behavior:**

- running、review、pending 或存在后台 Terminal 时拒绝 unsubscribe；未知 Task 返回 `notLoaded`，状态严格校验。Provider 队列溢出不得静默断流，Runtime 必须向客户端发出一次 `resync.required` 并保留有界背压；Tauri 使用当前 checkpoint 而非初始序号。

**Stop Conditions:**

- 如果无法在不改变公共事件版本的前提下表达上游溢出，停止并提出最小 Protocol 版本变更。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex -p code-agent-runtime --locked`

Expected: 所有卸载守卫、上游溢出和 Tauri 最新 checkpoint 恢复测试通过。

### Task 6: 迁移 Node Provider 行为契约并完成验证

**Files:**

- Create: `crates/provider-codex/tests/contract_prompt.rs`
- Create: `crates/provider-codex/tests/contract_pending.rs`
- Create: `crates/provider-codex/tests/contract_runtime.rs`
- Create: `crates/provider-codex/tests/fixtures/contracts/`
- Modify: `crates/provider-codex/tests/bin/fake_codex.rs`
- Modify: `tests/fixtures/phase5/realtime-path.json`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`

**Interfaces:**

- Consumes: `packages/provider-codex/src/*.test.ts` 中仍适用于统一 Provider 契约的行为场景
- Produces: 与 Node 实现无关的 Rust 黑盒 contract tests 和共享实时 fixture

**Behavior:**

- 按功能契约迁移 Prompt、Pending、Goal/Review、特殊通知、分页、unsubscribe 和 overflow 场景；测试只断言公开行为、RPC 帧和生命周期，不复制 TypeScript 内部结构。删除被 Rust contract tests 替代后不再需要的重复 Rust 浅测试。

**Stop Conditions:**

- Node 测试若只约束 Fastify/JavaScript 实现细节则不迁移，并在测试映射说明中记录排除理由。

- [x] **Task Status:** completed

Run: `pnpm run tauri:phase5:check && pnpm check && pnpm test:e2e`

Expected: Rust contract tests、Phase 5 门禁、全仓检查和端到端测试全部通过，且无协议 drift、Clippy warning 或新增超 500 行生产文件。
