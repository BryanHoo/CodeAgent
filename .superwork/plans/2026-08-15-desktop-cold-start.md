# Desktop Cold Start Implementation Plan

**Goal:** 让 Tauri `setup` 不再等待 SQLite 备份/迁移/完整性检查、附件目录 I/O 和最长 3 秒的 login shell 探测，使主窗口创建不受数据库大小、磁盘速度或 shell 配置直接阻塞。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Desktop SQLite owner thread、性能优先和验证命令
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Desktop 数据库、宿主环境、Codex supervisor 与关闭顺序
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Tauri Platform 回归测试和进程环境安全

**Architecture:** 保留单一 SQLite owner thread 和有界 `sync_channel`，新增立即返回句柄的延迟打开入口，由 owner thread 完成目录创建、备份、迁移和完整性检查，首个请求在原有超时内等待结果；附件 Store 改为无 I/O 构造并在首次写入时通过 `OnceCell` 完成受管根目录创建与 canonicalize；Desktop 先使用有界的即时 PATH 快照装配 Runtime，再在 Tauri 异步任务中探测 login shell、原子更新共享 `ProcessEnvironment` 并启动 Codex，使 Git、Project Open 与 Codex 最终共享同一解析结果。

**Tech Stack:** Rust、Tauri v2、rusqlite、Tokio、Cargo、pnpm

## Global Constraints

- 单文件不得超过 500 行，启动关键路径以性能优先。
- SQLite 继续由唯一 owner thread 和有界 `sync_channel` 持有，初始化失败必须原样传播给首个及后续请求。
- Desktop Composition Root 最终只解析一次 login shell，并向 Codex、Git 与 Project Open 注入同一 PATH 快照。
- 所有 Python 命令使用 `python3`，项目命令使用 `pnpm`。
- 不保留冗余旧启动路径，不启动开发服务器。

### Task 1: 延迟 SQLite owner 初始化

**Files:**

- Modify: `crates/platform/src/database.rs`
- Modify: `crates/platform/tests/database.rs`

**Interfaces:**

- Consumes: `PlatformDatabase::open(DatabaseOptions) -> Result<PlatformDatabase, PlatformError>`、`DatabaseJob` 有界队列
- Produces: `PlatformDatabase::open_deferred(DatabaseOptions) -> Result<PlatformDatabase, PlatformError>`

**Behavior:**

- `open_deferred` 只验证纯内存参数并启动 owner thread，目录创建、连接打开、备份、迁移和完整性检查全部留在 owner thread；同步 `open` 复用该入口并等待初始化，保持 Node 和测试调用方的就绪语义。
- owner 初始化失败时执行已排队和后续任务并返回稳定 Worker 错误，关闭仍断开队列并 join 唯一线程。

**Stop Conditions:**

- 若延迟句柄无法在不引入第二数据库线程或无界队列的前提下传播初始化失败，停止并重新设计任务消息契约。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --test database`

Expected: 同步打开、延迟打开、迁移备份、初始化失败传播和关闭测试全部通过。

### Task 2: 按需初始化附件受管目录

**Files:**

- Create: `crates/platform/src/attachment_root.rs`
- Modify: `crates/platform/src/lib.rs`
- Modify: `crates/platform/src/attachments.rs`
- Modify: `crates/platform/tests/attachments.rs`
- Modify: `crates/platform/tests/performance_budgets.rs`
- Modify: `crates/node-binding/src/composition.rs`

**Interfaces:**

- Consumes: `AttachmentStore::new(root)`、`AttachmentStore::add`
- Produces: 无文件系统 I/O 的 `AttachmentStore::new(root)` 与首次写入时单次异步初始化的 canonical 受管根目录

**Behavior:**

- 构造阶段只校验绝对路径并保存配置，不创建或 canonicalize 目录；首次附件写入通过共享异步一次性单元创建并解析目录，并发写入只执行一次初始化。
- Node 与测试调用方切换到新的同步构造契约，附件容量、归属和清理语义保持不变。

**Stop Conditions:**

- 若无法保持删除前 canonical 根目录包含关系校验，停止并保留当前安全边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --test attachments`

Expected: 构造不触发目录 I/O，首次写入完成单次目录初始化，原有附件读写、归属和清理测试全部通过。

### Task 3: 从 Tauri setup 移出数据库和 shell 阻塞

**Files:**

- Modify: `crates/platform/src/process.rs`
- Modify: `crates/platform/src/project_open.rs`
- Modify: `crates/platform/src/project_open_tests.rs`
- Modify: `apps/desktop/src-tauri/src/process_environment.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `tests/tauri-phase-4.test.ts`
- Modify: `tests/tauri-phase-5.test.ts`

**Interfaces:**

- Consumes: `PlatformDatabase::open_deferred(DatabaseOptions) -> Result<PlatformDatabase, PlatformError>`
- Consumes: `resolved_process_path()`、`ProcessEnvironment`
- Produces: 可原子更新 PATH 的共享 `ProcessEnvironment`，以及只在后台任务调用 `resolved_process_path()` 和启动 Codex 的非阻塞 Desktop setup

**Behavior:**

- Desktop setup 使用 `open_deferred`，同步装配使用即时 PATH 快照和无 I/O 附件 Store；后台任务完成唯一一次 login shell 探测后更新共享环境，再以同一结果启动 Codex supervisor。
- Git 每次执行读取最新快照；Project Open 在能力查询和打开时从最新环境解析命令，避免构造期缓存旧 PATH。
- 静态架构测试明确拒绝在 `setup` 中出现数据库同步打开、`block_on(resolved_process_path())` 或 `block_on(AttachmentStore::new(...))`。

**Stop Conditions:**

- 若共享环境更新不能同时作用于 Git 和 Project Open，或 Codex 启动使用了不同 PATH，停止并修复 Composition Root 单一快照约束。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --lib process::tests && cargo test -p code-agent-platform --lib project_open::tests && cargo test -p code-agent-desktop process_environment::tests && pnpm exec vitest run tests/tauri-phase-4.test.ts tests/tauri-phase-5.test.ts`

Expected: PATH 热更新、Project Open 动态解析和 Desktop 非阻塞启动结构测试通过，login shell 仍只探测一次。

### Task 4: 完成 Rust 与仓库门禁

**Files:**

- Test: `apps/desktop/src-tauri/src/lib.rs`
- Test: `crates/platform/src/database.rs`
- Test: `crates/platform/src/attachments.rs`
- Test: `crates/platform/src/process.rs`

**Interfaces:**

- Consumes: 完成后的 Desktop 冷启动装配与 Platform 契约
- Produces: Rust Workspace 与仓库快速基线验证证据

**Behavior:**

- 运行 Rust 专项门禁和仓库快速基线，确认格式、Clippy、依赖边界、类型、Vitest 及 Rust 测试无回归，并检查所有修改后的生产文件不超过 500 行。

**Stop Conditions:**

- 若门禁暴露与本改动相关的失败，停止交付并修复；仅对明确无关且已有的工作区失败记录证据。

- [x] **Task Status:** completed

Run: `pnpm check:rust && pnpm check`

Expected: `pnpm check` 以退出码 0 完成；`pnpm check:rust` 的格式、Workspace check、Clippy 与功能测试通过。当前机器上的既有 Git 压测为 2.068 s，超过 2.000 s 门槛，按 Stop Conditions 记录且不放宽预算。修改后的生产文件均不超过 500 行。
