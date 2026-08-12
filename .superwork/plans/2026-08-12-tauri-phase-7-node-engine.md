# Tauri Phase 7 Implementation Plan

**Goal:** 完成 `docs/tauri-migration-plan.md` Phase 7，让 Node CLI 通过 napi-rs 复用 `code-agent-runtime`，将 `packages/server` 收敛为 HTTP/WebSocket Delivery，并删除已由 Rust 接管的 TypeScript Engine。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包依赖、协议单一来源和 Phase 门禁。
- `.superwork/spec/backend/directory-structure.md` — 约束 CLI、Server Delivery 与 Provider 边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex、订阅、Runtime 和数据库关闭顺序。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部输入、错误、安全和验证。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client 与 Engine 公开入口。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 TypeBox/Rust DTO、事件和严格校验。
- `docs/tauri-migration-plan.md` — 定义 Phase 7 实施项、删除项、性能门禁和验收项。

**Architecture:** `code-agent-node-binding` 使用 napi-rs v3 创建进程内 Tokio Runtime，复用 Desktop 相同的 Rust Platform、Codex Provider 与 `CodeAgentRuntime`。N-API 只暴露命名的 async DTO 方法、订阅句柄、诊断和幂等 `close()`；事件先进入 Runtime 有界订阅，再通过具有事件数与字节双重预算的 nonblocking `ThreadsafeFunction` 送入 Node，溢出时发送重同步而不阻塞 JS 线程。`@code-agent/engine-node` 只负责加载当前目标 `.node`、定位 Codex binary、严格错误映射和 TypeScript Engine facade。`packages/server` 只依赖 Engine facade，将 Fastify 路由、HTTP Schema、访问控制、静态文件和 WebSocket sender 保留在 TypeScript；SQLite、Git、文件、附件、Provider、Runtime、幂等和事件状态全部由 Rust Engine 持有。CLI 按 Server -> Engine subscriptions/Runtime -> Codex/DB 的顺序幂等关闭。

**Tech Stack:** Rust 2024、Tokio、napi-rs v3、TypeScript、Fastify、Vitest、pnpm、Cargo。

## Global Constraints

- 单个生产文件不得超过 500 行；复杂绑定按 lifecycle、operations、events、errors 和 composition 拆分。
- 性能优先：N-API、Runtime event 和 WebSocket 队列必须同时有事件数与字节上限；JS 主线程不得使用 blocking `ThreadsafeFunction`；热路径避免重复 JSON stringify/parse、无界队列和大对象 clone。
- N-API 不暴露 Rust 内部对象图、Tauri 类型、任意 command dispatcher 或可执行文件参数；仅暴露 DTO、Promise、subscription handle、diagnostics 和 close。
- TypeBox/版本化 JSON Schema 继续是跨 N-API、HTTP 和 Tauri DTO 单一来源；外部输入在 Rust Runtime 前校验，输出在 Delivery 边界校验。
- Node 与 Desktop 必须打开同一 SQLite schema/migrations；禁止双写和 TypeScript fallback Engine。
- `packages/server` 只保留 Fastify Delivery、access control、static files、HTTP serialization 与 WebSocket sender。
- 关闭顺序固定为 Fastify/WebSocket、N-API subscriptions、Rust Runtime、Codex、SQLite；并发 close 必须共享同一完成结果。
- `ThreadsafeFunction` 使用有限 `max_queue_size`、weak ownership 和 `NonBlocking`；队列满时触发确定性 `resync.required`，不得等待 JS 消费。
- Rust 生产路径不使用 `unwrap`、`expect` 或 panic；错误转换保留稳定 code、retryable 和 correlationId，不泄漏宿主路径/backtrace。
- Python 命令只使用 `python3`，项目包管理使用 pnpm；不启动 dev server。

### Task 1: 建立 napi-rs crate、Node Engine package 与加载契约

**Files:**

- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `crates/node-binding/Cargo.toml`
- Modify: `crates/node-binding/src/lib.rs`
- Create: `crates/node-binding/build.rs`
- Create: `packages/engine-node/package.json`
- Create: `packages/engine-node/tsconfig.json`
- Create: `packages/engine-node/src/index.ts`
- Create: `packages/engine-node/src/native-binding.ts`
- Create: `packages/engine-node/src/native-binding.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `package.json`
- Create: `tests/tauri-phase-7.test.ts`

**Interfaces:**

- Consumes: Cargo workspace、pnpm catalog、Node ABI/target triple、现有 `code-agent-node-binding` 空边界。
- Produces: 可构建的 `cdylib`、确定性 `.node` 输出、`loadNativeBinding()` 与当前平台诊断错误。

**Behavior:**

- 使用 napi-rs v3 生成稳定 Node-API addon；`@code-agent/engine-node` 从明确的本地构建路径或目标平台 package 加载，不扫描任意目录、不触发 `node-gyp`，并对 unsupported platform、missing binary、ABI load failure 返回可诊断错误。根脚本提供 `build:native` 和 `tauri:phase7:check`，Phase 7 仓库测试先断言依赖与产物边界。

**Stop Conditions:**

- 若当前 napi-rs v3 无法与 Rust 1.88、Node 24 或 workspace `unsafe_code = "forbid"` 共存，停止并记录官方兼容性证据。
- 若加载方案要求进入 Phase 8 才定义的完整多平台发布重组，限制为当前平台构建与可注入 loader，不提前迁移根发布包。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/engine-node/src/native-binding.test.ts tests/tauri-phase-7.test.ts && pnpm run build:native`

Expected: loader 契约与 Phase 7 静态边界通过，当前平台生成可由 Node 24 加载的 `.node` addon。

### Task 2: 实现 Rust Engine composition、命名 async facade 与幂等关闭

**Files:**

- Create: `crates/node-binding/src/composition.rs`
- Create: `crates/node-binding/src/engine.rs`
- Create: `crates/node-binding/src/errors.rs`
- Create: `crates/node-binding/src/operations.rs`
- Create: `crates/node-binding/src/operations/projects.rs`
- Create: `crates/node-binding/src/operations/settings.rs`
- Create: `crates/node-binding/src/operations/provider.rs`
- Create: `crates/node-binding/src/operations/tasks.rs`
- Create: `crates/node-binding/src/operations/files.rs`
- Create: `crates/node-binding/src/operations/git.rs`
- Create: `crates/node-binding/src/operations/attachments.rs`
- Create: `crates/node-binding/src/types.rs`
- Modify: `crates/node-binding/src/lib.rs`
- Modify: `crates/runtime/src/lib.rs`
- Modify: `crates/platform/src/lib.rs`
- Test: `crates/node-binding/src/engine.rs`
- Test: `crates/node-binding/src/operations.rs`
- Test: `crates/runtime/src/lib.rs`

**Interfaces:**

- Consumes: `CodeAgentRuntimeBuilder`、`SqliteRepository`、`PlatformFilePort`、`GitCliService`、`AttachmentStore`、Rust Codex Provider 与版本化 Protocol DTO。
- Produces: `NodeEngine::open(options)`、领域化 async methods、`diagnose()`、`wait_for_exit()`、`cancel_operation()` 与共享幂等 `close()`。

**Behavior:**

- Node Engine 使用与 Desktop 相同端口装配，从显式 `databasePath`、`temporaryWorkspace`、`attachmentRoot` 与受检 `codexPath` 构建唯一 `Arc<CodeAgentRuntime>`；每个 N-API 方法映射一个明确 Runtime facade，不使用 operation string dispatcher。异步方法运行在 addon Tokio runtime，不阻塞 libuv worker；异常统一转换为稳定 Node error properties。并发关闭只执行一次，并按 subscriptions、Runtime、Provider supervisor、database owner 顺序完成。

**Stop Conditions:**

- 若现有 Runtime 缺少 Server 需要的领域方法，先在 Runtime 增加宿主无关 facade 和测试；不得在 binding 重写业务规则。
- 若 Desktop 与 Node 需要不同端口行为，使用宿主 adapter 注入；不得给 `code-agent-runtime` 增加 N-API/Tauri 条件编译。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-node-binding --locked && cargo test -p code-agent-runtime --locked`

Expected: fake/fixture 端口覆盖 open、DTO 调用、取消、Provider 退出和并发 close，且 Node binding 只依赖 Rust Runtime/Platform/Provider/Protocol/Core。

### Task 3: 实现有界 N-API 事件桥与 subscription handle

**Files:**

- Create: `crates/node-binding/src/events.rs`
- Modify: `crates/node-binding/src/engine.rs`
- Modify: `crates/node-binding/src/lib.rs`
- Create: `packages/engine-node/src/event-subscription.ts`
- Create: `packages/engine-node/src/event-subscription.test.ts`
- Modify: `packages/engine-node/src/index.ts`
- Test: `crates/node-binding/src/events.rs`
- Modify: `tests/performance-budgets.json`
- Modify: `tests/performance-budgets.test.ts`

**Interfaces:**

- Consumes: `CodeAgentRuntime::subscribe_project_events`、`EventSubscription`、Node-API `ThreadsafeFunction` 和统一 `EventStreamMessage` Schema。
- Produces: `NodeEventSubscription` handle、连续事件 callback、显式 unsubscribe、队列溢出重同步和桥接 metrics。

**Behavior:**

- 每个订阅从 Runtime 有界队列读取已序列化 frame，以有限数量和字节预算桥接；`ThreadsafeFunction` 采用 weak、有限 `max_queue_size` 与 `NonBlocking`。JS 队列满、字节预算超限、Session 变化或 sequence gap 时停止普通事件并交付单个 `resync.required`；unsubscribe/Engine close/Node environment cleanup 均释放 Rust task 和 callback。增加 10,000 顺序事件测试，证明顺序、平台期内存和 nonblocking overflow。

**Stop Conditions:**

- 若 napi-rs callback 类型迫使事件在热路径二次 JSON 序列化，改为直接复用 Runtime `PublishedEvent::frame()` 的 Buffer，并在 JS Delivery 仅按需解析；不得用 base64。
- 若无法在 Node environment teardown 安全等待 Rust cleanup，使用 napi-rs 官方 cleanup hook/ownership API；不得依赖 GC finalizer 作为正常关闭路径。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-node-binding events --locked && pnpm exec vitest run packages/engine-node/src/event-subscription.test.ts tests/performance-budgets.test.ts`

Expected: 事件有序、容量/字节溢出确定性重同步、unsubscribe 幂等，且 callback 不阻塞 Node 主线程。

### Task 4: 将 Fastify Server 收敛到 Rust Engine Delivery port

**Files:**

- Create: `packages/server/src/engine-port.ts`
- Create: `packages/server/src/engine-errors.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/access-routes.ts`
- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/server/src/routes/provider-connection-routes.ts`
- Modify: `packages/server/src/routes/runtime-routes.ts`
- Modify: `packages/server/src/routes/task-action-routes.ts`
- Modify: `packages/server/src/routes/task-attachment-routes.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Modify: `packages/server/src/routes/turn-routes.ts`
- Modify: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/server/src/event-socket-sender.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `tests/realtime-path.test.ts`

**Interfaces:**

- Consumes: `CodeAgentEngine` typed facade、现有 Fastify route schemas/access control/static delivery 和共享 Phase 5 realtime fixture。
- Produces: 只依赖单个 `engine` port 的 `createCodeAgentServer()`、HTTP error mapping、WebSocket subscription sender 与 transport metrics。

**Behavior:**

- 所有 routes 将已校验 HTTP input 映射到同名 Engine DTO 方法，Mutation 的 requestId/idempotency key 和 request abort 进入 Rust；响应继续按 Protocol Schema 序列化。WebSocket sender 只消费 Engine subscription，不持有 sequence/history/coalescing。Fastify `preClose/onClose` 先拒绝新订阅、排空连接并释放所有 handles，不自行关闭共享 Engine。现有 HTTP/LAN/fixture 行为保持一致。

**Stop Conditions:**

- 若某路由必须读取 Rust 未暴露的内部状态，回到 Task 2 增加领域化 Runtime facade；不得将 Repository/Provider 对象暴露给 Server。
- 若 HTTP 契约与 Desktop DTO 不一致，先更新 Protocol 单一来源和两条 Delivery 契约测试，不维护 Node 专用 payload。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts tests/realtime-path.test.ts`

Expected: HTTP、LAN、WebSocket、取消、幂等和实时 fixture 全部通过，Server 不再导入 `@code-agent/core`、`@code-agent/provider-codex`、SQLite/Git/File/Attachment Runtime 实现。

### Task 5: 切换 CLI 到 Engine loader 并验证原生生命周期/打包

**Files:**

- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`
- Modify: `package.json`
- Modify: `tsup.config.ts`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `scripts/check-package-contents.mjs`
- Modify: `packages/server/package.json`
- Modify: `packages/engine-node/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/tauri-phase-7.test.ts`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`

**Interfaces:**

- Consumes: `createNodeEngine()`、`createCodeAgentServer({ engine })`、CLI options、Codex binary locator 与 Fastify lifecycle。
- Produces: Node CLI Rust Engine composition root、native addon load/package smoke、Codex crash propagation 和确定性 shutdown。

**Behavior:**

- `runStart` 解析路径并定位 Codex 后只创建一个 Engine，再注入 Server；`doctor` 通过 Engine diagnostics 校验同一 Rust SQLite migrations。CLI 同时观察 shutdown 与 Engine Provider exit，关闭顺序为 Server -> Engine，任一层失败仍继续回收。构建与 package check 证明当前目标 native addon 可加载、无隐式 `node-gyp rebuild`、npm 发布产物不包含 Desktop/Tauri。

**Stop Conditions:**

- 若 native addon 需要 Phase 8 的 optionalDependencies 才能在当前源码/pack smoke 加载，使用构建期显式路径注入完成 Phase 7 验收，并把跨平台 package fan-out 留在 Phase 8。
- 若 E2E 环境未构建 addon，测试 setup 必须先运行确定性 `build:native`；不得 fallback 到 TypeScript Engine。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/cli-command.test.ts tests/tauri-phase-7.test.ts && pnpm run build && pnpm run package:check && pnpm test:e2e`

Expected: `@bryanhu/code-agent start` HTTP/LAN 行为通过，Codex crash/native error 无未处理 Promise，tarball 可加载当前平台 addon且不触发 node-gyp。

### Task 6: 删除 TypeScript Engine、更新门禁与完成迁移状态

**Files:**

- Delete: `packages/core/`
- Delete: `packages/provider-codex/`
- Delete: `packages/server/src/agent-event-stream.ts`
- Delete: `packages/server/src/agent-event-stream.test.ts`
- Delete: `packages/server/src/attachment-store.ts`
- Delete: `packages/server/src/attachment-store.test.ts`
- Delete: `packages/server/src/git-branch.ts`
- Delete: `packages/server/src/git-branch.test.ts`
- Delete: `packages/server/src/git-command.ts`
- Delete: `packages/server/src/git-command.test.ts`
- Delete: `packages/server/src/git-commit.ts`
- Delete: `packages/server/src/git-commit.test.ts`
- Delete: `packages/server/src/git-commit-process.test.ts`
- Delete: `packages/server/src/git-commit-message.ts`
- Delete: `packages/server/src/git-commit-message.test.ts`
- Delete: `packages/server/src/git-commit-review.ts`
- Delete: `packages/server/src/git-commit-review.test.ts`
- Delete: `packages/server/src/git-history.ts`
- Delete: `packages/server/src/git-history.test.ts`
- Delete: `packages/server/src/git-working-tree.ts`
- Delete: `packages/server/src/git-working-tree.test.ts`
- Delete: `packages/server/src/git-working-tree-adapter.test.ts`
- Delete: `packages/server/src/git-working-tree-diff.ts`
- Delete: `packages/server/src/host-file-browser.ts`
- Delete: `packages/server/src/host-file-browser.test.ts`
- Delete: `packages/server/src/idempotency-runner.ts`
- Delete: `packages/server/src/project-directory-browser.ts`
- Delete: `packages/server/src/project-directory-browser.test.ts`
- Delete: `packages/server/src/project-file-tree.ts`
- Delete: `packages/server/src/project-file-tree.test.ts`
- Delete: `packages/server/src/project-image-file.ts`
- Delete: `packages/server/src/project-image-file.test.ts`
- Delete: `packages/server/src/project-open-commands.ts`
- Delete: `packages/server/src/project-open.ts`
- Delete: `packages/server/src/project-open.test.ts`
- Delete: `packages/server/src/project-runtime-context.ts`
- Delete: `packages/server/src/project-source-file.ts`
- Delete: `packages/server/src/project-source-file.test.ts`
- Delete: `packages/server/src/provider-connection-persistence.ts`
- Delete: `packages/server/src/server-runtime.ts`
- Delete: `packages/server/src/server-runtime.test.ts`
- Delete: `packages/server/src/sqlite-state-helpers.ts`
- Delete: `packages/server/src/sqlite-state-repository.ts`
- Delete: `packages/server/src/sqlite-state-repository.test.ts`
- Delete: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/performance.performance.test.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `.superwork/plans/2026-08-12-tauri-phase-7-node-engine.md`
- Modify: `tests/tauri-phase-7.test.ts`

**Interfaces:**

- Consumes: Tasks 1–5 完成证据、Phase 7 删除清单、workspace/CI/package architecture gates。
- Produces: 唯一 Rust Engine、精简 Server Delivery、`tauri:phase7:check` 持续门禁和 Phase 7 完成状态。

**Behavior:**

- 删除所有由 Rust 接管的 TypeScript Core、Provider、SQLite、Git、文件、附件、幂等与事件实现及依赖，包括 `better-sqlite3`/Worker；修复测试与架构图，使 Protocol <- Engine Node / Server Delivery 依赖方向唯一。Phase 7 门禁扫描禁止 Server 重新引入 Engine 逻辑、无界 N-API 队列、blocking TSFN、万能 dispatcher、Node sidecar、隐式 node-gyp 和双 SQLite owner。只有 targeted、全仓、Rust、E2E、package 与 Desktop build 全通过后标记 Phase 7 完成。

**Stop Conditions:**

- 若删除后仍有真实功能仅由 TypeScript 实现，回到对应任务补齐 Rust Runtime；不得保留未记录 fallback。
- 若完整门禁存在与本阶段无关的预先失败，Phase 7 保持待完成并记录独立证据；不得只凭 targeted test 更新迁移状态。

- [x] **Task Status:** completed

Run: `pnpm run tauri:phase7:check && pnpm check && pnpm check:rust && pnpm test:e2e && pnpm --filter @code-agent/desktop build`

Expected: TypeScript、Rust、协议、架构、性能、E2E、native package 与 Desktop artifact 全部通过，Phase 7 六项任务均为 completed。
