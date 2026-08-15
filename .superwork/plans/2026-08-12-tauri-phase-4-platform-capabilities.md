# Tauri Phase 4 Implementation Plan

**Goal:** 完成 `docs/tauri-migration-plan.md` Phase 4，将 SQLite、Project/Settings、文件、附件与 Git 宿主能力迁入 Rust Platform/Runtime，并通过 typed Tauri Commands 与 Tauri Transport 提供与现有 HTTP 契约一致的 Desktop 能力。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Rust Workspace、协议生成、验证和 Desktop 构建。
- `.superwork/spec/backend/directory-structure.md` — 约束 Platform、Runtime、Delivery 与旧 TypeScript Server 的职责。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束数据库线程、有界队列、取消和关闭顺序。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 SQLite、路径、子进程、错误和测试。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol/Core/Platform/Runtime 依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 TypeBox 单一来源、跨语言 fixtures 与公共契约。

**Architecture:** 扩展 TypeBox Rust Schema bundle 生成 Phase 4 DTO；`code-agent-core` 用领域化 ports 表达持久化、文件、附件和 Git；`code-agent-platform` 使用单 owner SQLite 线程与有界命令队列、Tokio 文件 API 和受控 Git 子进程实现 ports；`code-agent-runtime` 提供宿主无关 facade；Desktop 只注册 owned typed Commands，`@code-agent/transport-tauri` 静态映射 operation。旧 TypeScript 实现继续服务 Web/Node，待 Phase 7 两个宿主均切换 Runtime 后统一删除，不进行 SQLite 双写。

**Tech Stack:** Rust 2024、rusqlite bundled、Tokio、Serde、Tauri 2.11、TypeBox、TypeScript 6、Vitest、pnpm 11。

## Global Constraints

- TypeBox Schema 是 TS/Rust 公共 DTO 唯一来源；生成文件不得手工编辑，`protocol:rust:check` 必须拒绝 drift。
- SQLite connection 只由一个 dedicated OS thread 持有，Runtime 通过容量有限的队列访问；迁移前使用 SQLite Online Backup API 创建可恢复备份，失败不得创建空库掩盖原库。
- 保持 `journal_mode=WAL`、`foreign_keys=ON`、`synchronous=NORMAL`、`busy_timeout=5000` 和 `STRICT` tables；升级后同时通过 `integrity_check` 与 `foreign_key_check`。
- 所有路径先 canonicalize，再执行 Project root/Attachment root containment 校验；符号链接、目录、越界路径和超限内容必须拒绝。
- Tauri 普通 DTO 使用独立 typed Commands；附件上传使用 raw IPC body，附件/图片读取使用二进制响应或 opaque asset reference，不使用 base64、绝对路径或万能 dispatcher。
- Git 与文件操作不得阻塞 Tokio worker；子进程使用参数数组、`shell: false` 等价行为、超时和协作取消，错误转换为稳定 `CodeAgentError`。
- 每个切片使用现有 HTTP/TypeScript tests 和 fixtures 对照行为；不为兼容旧实现保留第二套 Rust 逻辑。

### Task 1: 建立 Phase 4 DTO、迁移 SQL 与数据库线程

**Files:**

- Modify: `packages/protocol/src/rust-runtime-schema.ts`
- Modify: `packages/protocol/src/rust-runtime-schema.test.ts`
- Modify: `schemas/code-agent-runtime.schema.json`
- Modify: `crates/protocol/src/generated.rs`
- Modify: `crates/core/src/ports.rs`
- Create: `crates/platform/src/database.rs`
- Create: `crates/platform/src/migrations.rs`
- Create: `crates/platform/migrations/001_create_local_state.sql`
- Create: `crates/platform/migrations/002_create_task_metadata.sql`
- Create: `crates/platform/migrations/003_add_sandbox_mode_settings.sql`
- Create: `crates/platform/migrations/004_add_project_sort_order.sql`
- Create: `crates/platform/migrations/005_add_approvals_reviewer_setting.sql`
- Create: `crates/platform/migrations/006_create_global_settings.sql`
- Create: `crates/platform/migrations/007_add_commit_message_settings.sql`
- Create: `crates/platform/migrations/008_add_follow_up_behavior_setting.sql`
- Create: `crates/platform/migrations/009_drop_task_metadata.sql`
- Create: `crates/platform/migrations/010_add_project_kind.sql`
- Create: `crates/platform/migrations/011_create_provider_connection.sql`
- Modify: `crates/platform/src/lib.rs`
- Modify: `crates/platform/Cargo.toml`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Test: `crates/platform/tests/database.rs`
- Test: `crates/platform/tests/fixtures.rs`

**Interfaces:**

- Consumes: `RustRuntimeProtocolSchema`、TypeScript `SQLITE_MIGRATIONS` versions 1-11、`RepositoryPort`
- Produces: `PlatformDatabase`、`DatabaseOptions`、版本化 Rust Phase 4 DTO 与 migration runner

**Behavior:**

- 将现有 1-11 号 SQL 按原顺序提取到 Rust；数据库首次迁移前通过 SQLite backup API 创建唯一备份，单 owner thread 用 bounded `sync_channel` 串行处理命令；启动验证 pragmas、完整性、外键和 migration version，关闭排空请求并 join thread；从每个历史版本 fixture 原位升级且保留 rows。

**Stop Conditions:**

- 若任一现有 SQL 无法在 bundled SQLite 上原样升级、备份无法在迁移前完成，或数据库命令需要在 Tokio worker 上直接执行，则停止并修复数据库边界。

- [x] **Task Status:** completed

Run: `pnpm run protocol:rust:check && cargo test -p code-agent-platform --test database --test fixtures --locked`

Expected: 生成 DTO 无 drift，空库与 1-11 各历史 fixture 升级、备份、pragma、完整性、外键、失败回滚和有界关闭测试通过。

### Task 2: 迁移 Project registry、排序与临时 Project

**Files:**

- Modify: `crates/core/src/ports.rs`
- Create: `crates/platform/src/repository.rs`
- Modify: `crates/platform/src/lib.rs`
- Modify: `crates/runtime/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/commands/projects.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Test: `crates/platform/tests/repository_projects.rs`
- Test: `crates/runtime/tests/platform_projects.rs`
- Test: `apps/desktop/src-tauri/src/commands/projects.rs`
- Test: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `PlatformDatabase`、`ProjectRepositoryPort`、Project TypeBox DTO、`CodeAgentRequestContext`
- Produces: `SqliteRepository`、Runtime Project facade、`project_list|project_add|project_rename|project_remove|project_reorder` Commands

**Behavior:**

- Rust 实现与 HTTP 相同的 Project ID、按 `sort_order/created_at/id` 排序、完整集合原子重排、临时 Project 隔离、root identity conflict 和级联本地状态清理；Tauri Transport 支持对应 operation 并传递 `requestId`、idempotency key 与取消。

**Stop Conditions:**

- 若相同 root 生成不同 ID、临时 Project 出现在用户列表、重排可部分提交，或 Command 承载数据库逻辑，则停止并修正职责边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --test repository_projects --locked && cargo test -p code-agent-runtime --test platform_projects --locked && pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: Project fixture 与现有 HTTP 结果一致，typed Commands/Transport 完成增删改查、排序、冲突、取消和结构化错误覆盖。

### Task 3: 迁移 Global/Project/Task settings 与 Provider connection 持久化

**Files:**

- Modify: `crates/core/src/ports.rs`
- Modify: `crates/platform/src/repository.rs`
- Modify: `crates/runtime/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/commands/settings.rs`
- Create: `apps/desktop/src-tauri/src/commands/provider.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Test: `crates/platform/tests/repository_settings.rs`
- Test: `apps/desktop/src-tauri/src/commands/settings.rs`
- Test: `apps/desktop/src-tauri/src/commands/provider.rs`
- Test: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `SqliteRepository`、Settings/Provider TypeBox DTO、Runtime operation/idempotency registry
- Produces: `SettingsRepositoryPort`、`ProviderConnectionRepositoryPort`、settings/provider Runtime facade 与 typed Commands

**Behavior:**

- 原子读写完整 Global settings、Project defaults、Task settings 和 Provider connection record；Rust 边界严格拒绝非法枚举、空模型和无效 auto-review 组合，Provider custom models JSON 以同一 Schema 往返，Tauri Transport 映射既有 operation。

**Stop Conditions:**

- 若 Rust 需要维护独立宽松设置类型、部分更新会留下混合状态，或 Provider secret/path 被返回 Renderer，则停止并收紧协议与存储边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --test repository_settings --locked && cargo test -p code-agent-desktop settings provider --locked && pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: 所有设置与 Provider connection 在 SQLite round-trip、冲突、外键级联、Command payload 和响应 Schema 测试中通过。

### Task 4: 迁移目录、源文件、图片与系统打开能力

**Files:**

- Modify: `crates/core/src/ports.rs`
- Create: `crates/platform/src/path_policy.rs`
- Create: `crates/platform/src/files.rs`
- Modify: `crates/platform/src/lib.rs`
- Modify: `crates/runtime/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/commands/files.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Test: `crates/platform/tests/files.rs`
- Test: `crates/platform/tests/path_policy.rs`
- Test: `apps/desktop/src-tauri/src/commands/files.rs`
- Test: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `FilePort`、Project root lookup、Project/Host file TypeBox DTO、`PortRequestContext`
- Produces: `PlatformFileService`、`CanonicalPathPolicy`、文件 Runtime facade 与 typed Commands

**Behavior:**

- 支持 Project directory、host file browsing、file tree/search、UTF-8 源文件按字节 cursor 渐进读取、受检 PNG/JPEG/WebP/GIF 图片读取和 system open；相对路径限制在 Project root，显式绝对路径按既有契约只允许普通可读文件，所有循环、符号链接越界、二进制伪装、非法 cursor、超限和取消均返回稳定错误。

**Stop Conditions:**

- 若路径授权只依赖字符串前缀、分页切断 UTF-8、图片只信任扩展名，或同步文件/进程操作阻塞 Tokio worker，则停止并修正平台实现。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --test path_policy --test files --locked && cargo test -p code-agent-desktop files --locked && pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: macOS/Windows/Linux 路径 fixture、traversal/symlink、分页、媒体签名、大小预算、取消和 typed IPC tests 全部通过。

### Task 5: 迁移附件二进制存储、读取、打开与清理

**Files:**

- Modify: `crates/core/src/ports.rs`
- Create: `crates/platform/src/attachments.rs`
- Modify: `crates/platform/src/lib.rs`
- Modify: `crates/runtime/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/commands/attachments.rs`
- Create: `apps/desktop/src-tauri/src/asset_protocol.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Test: `crates/platform/tests/attachments.rs`
- Test: `apps/desktop/src-tauri/src/commands/attachments.rs`
- Test: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `AttachmentPort`、raw `tauri::ipc::Request`、`tauri::ipc::Response`、Agent attachment TypeBox DTO
- Produces: `AttachmentStore`、opaque asset reference、raw upload/import/read/open/cleanup Commands

**Behavior:**

- 按 Project/Task 随机 opaque ID 存储附件，验证 kind、媒体类型、内容签名、声明/实际长度和单项/总量限制；raw IPC 上传不经过 JSON/base64，host import 拒绝 symlink 并重新校验，读取和 asset protocol 不暴露绝对路径，清理只删除受管根内条目。

**Stop Conditions:**

- 若 10 MiB payload 进入 JSON/base64、Renderer 获得绝对路径、opaque ID 可跨 Project/Task 读取，或清理可越过 Attachment root，则停止并修复安全边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --test attachments --locked && cargo test -p code-agent-desktop attachments --locked && pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: 上传、host import、受控读取/打开、签名/预算、归属、traversal、清理和 10 MiB 非 base64 IPC tests 通过。

### Task 6: 迁移 Git status、diff、history、branch、commit 与 review

**Files:**

- Modify: `crates/core/src/ports.rs`
- Create: `crates/platform/src/process.rs`
- Create: `crates/platform/src/git.rs`
- Modify: `crates/platform/src/lib.rs`
- Modify: `crates/runtime/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/commands/git.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Test: `crates/platform/tests/git.rs`
- Test: `apps/desktop/src-tauri/src/commands/git.rs`
- Test: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `GitPort`、Project Git TypeBox DTO、canonical Project root、`PortRequestContext`
- Produces: `GitCliService`、Git Runtime facade、`git_status|git_history|git_commit_files|git_commit_diff|git_branch_switch|git_branch_create|git_commit` Commands

**Behavior:**

- 在 canonical Project root 内通过参数数组调用 Git，解析 porcelain/status/diff/log，支持分页 history、branch switch/create、按文件提交和 review diff；命令有输出预算、超时、协作取消和受跟踪子进程清理，错误不泄漏环境变量或任意命令执行能力。

**Stop Conditions:**

- 若任一参数经过 shell 拼接、Git 可在 Project root 外执行、输出无界读取、取消后遗留进程，或解析结果偏离现有 fixture，则停止并修复进程边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --test git --locked && cargo test -p code-agent-desktop git --locked && pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: status/diff/history/branch/commit fixture、参数注入、超时、取消、输出上限、结构化错误和 typed IPC tests 全部通过。

### Task 7: 完成 Desktop 装配、Phase 4 门禁与迁移状态

**Files:**

- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/capabilities/main.json`
- Create: `tests/tauri-phase-4.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `docs/tauri-migration-plan.md`

**Interfaces:**

- Consumes: `CodeAgentRuntime`、全部 Platform ports、Tauri managed state/lifecycle、Phase 4 contract tests
- Produces: 可关闭的 Desktop Runtime composition root、`tauri-phase-4` repository gate 与完成状态

**Behavior:**

- Desktop setup 从 app data/Codex home 解析现有数据库与附件目录，只 manage 一个 `Arc<CodeAgentRuntime>`，退出时按 subscription/Runtime/database 顺序有界关闭；能力文件保持最小权限且 Renderer 无任意 fs/shell；CI 检查 migration drift、禁止 unbounded channel/base64/万能 dispatcher 和 Runtime 宿主依赖，迁移文档仅在全部验证通过后标记 Phase 4 completed。

**Stop Conditions:**

- 若 Desktop 需要 Node/Fastify/localhost、存在第二个数据库 owner、capability 出现 wildcard fs/shell，或完整门禁发现 Web/Node 回归，则停止并修复，不能放宽门禁或提前标记完成。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e && pnpm check:rust && pnpm --filter @code-agent/desktop build`

Expected: TypeScript、Rust、协议 drift、历史数据库、架构、安全、E2E 与当前平台未签名 Desktop artifact 全部通过，Phase 4 七项状态均为 completed。

Verification: `pnpm check`（124 files / 991 tests）、`pnpm check:rust`、`pnpm test:e2e`（135 passed）与 `pnpm --filter @code-agent/desktop build` 全部通过。
