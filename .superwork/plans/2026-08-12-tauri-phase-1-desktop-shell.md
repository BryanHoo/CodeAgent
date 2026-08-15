# Tauri Phase 1 Implementation Plan

**Goal:** 完成 `docs/tauri-migration-plan.md` Phase 1，建立 Rust/Cargo workspace、空 Runtime crates、Tauri Desktop 壳和互不覆盖的 Web/Desktop UI 构建产物，同时保持现有 npm 发布结果不变。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束根脚本、发布产物和项目验证命令。
- `.superwork/spec/backend/directory-structure.md` — 约束根 CLI、Server 与新 Rust Runtime 的职责边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束未来 Runtime 生命周期边界，Phase 1 不引入业务生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束错误、测试和安全配置。
- `.superwork/spec/frontend/directory-structure.md` — 约束唯一 React/Vite UI 和 Composition Root。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Web 构建、测试与浏览器边界。
- `.superwork/spec/shared/directory-structure.md` — 约束 TypeScript/Rust package 依赖方向。
- `docs/tauri-migration-plan.md` — 定义 Phase 1 实施项、验收项和不得提前实现的后续阶段。

**Architecture:** 根目录新增 virtual Cargo workspace；`apps/desktop/src-tauri` 作为最小 Tauri v2 Delivery 壳，只负责 Builder 和窗口装配；`crates/*` 仅建立无 I/O 的可编译边界。`apps/web` 继续作为唯一 UI，由显式 Vite mode 选择 `dist/web` 或 `dist/desktop`，Desktop 构建通过 Tauri hook 调用同一 UI 构建。

**Tech Stack:** Rust 2024、Cargo resolver 3、Tauri v2、TypeScript 6、React 19、Vite 8、pnpm 11、Vitest 4。

## Global Constraints

- Desktop 不得启动 Node、Fastify、localhost HTTP Server 或 WebSocket；Phase 1 只显示现有 UI。
- `main.rs` 只调用 `code_agent_desktop_lib::run()`，Builder 和注册逻辑必须位于 `lib.rs`。
- Capability 只绑定 `main` 窗口并只授予最小 `core:default` 权限，不引入 plugin、shell、fs 或 remote capability。
- Web 与 Desktop UI 必须输出到 `dist/web`、`dist/desktop`，构建时各自清理目标目录且互不覆盖。
- 根现有 `build`、npm `files` 和 `package:check` 行为不得包含 Desktop artifact、Cargo `target` 或 Rust crates。
- 不实现 Phase 2 Transport、不添加 `@tauri-apps/api` 到 Web、不使用 `window.__TAURI__` 产品分支。
- 项目命令使用 pnpm，Python 命令使用 `python3`；关键非显然配置添加简短中文注释。

### Task 1: 固定 Phase 1 配置契约

**Files:**

- Create: `tests/tauri-phase-1.test.ts`

**Interfaces:**

- Consumes: `docs/tauri-migration-plan.md` Phase 1 验收约束、Node filesystem API。
- Produces: `Phase1RepositoryContract` 静态配置测试契约。

**Behavior:**

- 验证 root Cargo manifest、全部预定 crates、Tauri thin main/lib、最小 capability、Desktop package scripts、双输出目录和根 scripts；先以缺失文件失败，为后续切片提供确定性回归门禁。

**Stop Conditions:**

- 若测试必须依赖启动 GUI、系统 WebView 或网络服务才能表达配置契约，则停止并改为纯文件/配置断言。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-1.test.ts`

Expected: 初始 RED 明确报告 Phase 1 文件或配置缺失；后续任务完成后全部断言通过。

### Task 2: 建立 Cargo workspace 与 Rust crate 边界

**Files:**

- Create: `Cargo.toml`
- Create: `Cargo.lock`
- Create: `crates/protocol/Cargo.toml`
- Create: `crates/protocol/src/lib.rs`
- Create: `crates/core/Cargo.toml`
- Create: `crates/core/src/lib.rs`
- Create: `crates/provider-codex/Cargo.toml`
- Create: `crates/provider-codex/src/lib.rs`
- Create: `crates/platform/Cargo.toml`
- Create: `crates/platform/src/lib.rs`
- Create: `crates/runtime/Cargo.toml`
- Create: `crates/runtime/src/lib.rs`
- Create: `crates/node-binding/Cargo.toml`
- Create: `crates/node-binding/src/lib.rs`
- Create: `crates/protocol-gen/Cargo.toml`
- Create: `crates/protocol-gen/src/main.rs`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: Rust virtual workspace 规范、Rust 2024 edition、`workspace.package`/`workspace.dependencies`/`workspace.lints` inheritance。
- Produces: `code-agent-protocol <- code-agent-core <- provider/platform <- runtime <- node-binding` 的可编译 crate 边界和开发期 `protocol-gen` binary。

**Behavior:**

- 建立 `resolver = "3"` 的 virtual workspace；每个空 crate 只通过公开边界表达计划中的依赖方向，不包含 I/O、Tauri、N-API 或业务占位实现；workspace lint 对 unsafe 和常见质量问题设为拒绝或警告。

**Stop Conditions:**

- 若 crates.io 当前 Tauri/Cargo 版本要求高于项目可声明的 Rust toolchain，停止并记录明确版本约束，不放宽依赖或 lint 规避编译。

- [x] **Task Status:** completed

Run: `cargo check --workspace --locked`

Expected: 所有 Rust workspace members 通过锁文件编译，且 Runtime 不依赖 Tauri/N-API/Fastify。

### Task 3: 创建最小 Tauri Desktop 壳

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/main.json`
- Create: `apps/desktop/src-tauri/icons/*`
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Modify: `Cargo.toml`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `@tauri-apps/cli` catalog dependency、Tauri `Builder`、`generate_context!`、现有 Vite dev server `http://127.0.0.1:5173`。
- Produces: `@code-agent/desktop` workspace package、`code-agent-desktop` Tauri application crate 和包含 Desktop member 的完整 Cargo workspace。

**Behavior:**

- Desktop package 仅提供 `dev`、`build`、`tauri` scripts；Tauri 生产构建嵌入 `dist/desktop`，开发复用现有 Vite server；`main.rs` 保持薄入口，`lib.rs` 持有 Builder；窗口仅获得 `core:default`。

**Stop Conditions:**

- 若最小壳需要 Node sidecar、localhost Server、业务 Command、任意文件/命令权限或远程 Tauri API，立即停止，因为已超出 Phase 1。

- [x] **Task Status:** completed

Run: `pnpm --filter @code-agent/desktop tauri info`

Expected: Tauri CLI 识别 v2 配置、Rust application crate 和当前平台 WebView 依赖，不报告 schema 或 capability 错误。

### Task 4: 接入 Vite 双产物与根级验证

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/vite.config.test.ts`
- Modify: `package.json`
- Modify: `tests/tauri-phase-1.test.ts`

**Interfaces:**

- Consumes: Vite `mode`/`build.outDir`、pnpm catalog、Tauri `beforeBuildCommand`、根 npm 发布脚本。
- Produces: `build:web`、`build:desktop-ui`、`build:desktop`、`check:rust` 和独立 `dist/web`/`dist/desktop` 产物。

**Behavior:**

- 以显式 `--mode web|desktop` 选择唯一输出目录；根 `build` 继续只构建 Web 与 Node npm 产物；Rust 检查单独运行 fmt/check/clippy/test；验证顺序构建两种 UI 后两边文件均存在，并保证现有 bundle/package 门禁只读取 `dist/web` 和 npm 发布清单。

**Stop Conditions:**

- 若现有 Web bundle、LAN/E2E 入口或 npm tarball 清单发生变化，停止并修复输出隔离，不通过扩大发布清单兼容。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/vite.config.test.ts tests/tauri-phase-1.test.ts && pnpm run build:web && pnpm run build:desktop-ui && pnpm run package:check`

Expected: 配置契约与 Vite 测试通过，`dist/web/index.html`、`dist/desktop/index.html` 同时存在，npm 发布清单不包含 Desktop/Rust artifact。
