# Tauri Phase 8 Release Workspace Implementation Plan

**Goal:** 将 npm CLI 发布包迁入 `apps/node-cli`，建立按平台分发的 N-API 包、单一版本门禁和可复现发布流程，同时保持根 Workspace 仅负责编排。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Workspace、发布包、Rust Runtime 和验证边界。
- `.superwork/spec/backend/directory-structure.md` — 约束 Node CLI composition root 与 Server Delivery 的归属。
- `.superwork/spec/backend/quality-guidelines.md` — 约束发布包、CI、native addon 与性能门禁。
- `docs/tauri-migration-plan.md` — 定义 Phase 8 实施项、删除项和验收项。

**Architecture:** 根 `package.json` 作为 private 编排器和唯一产品版本源；`apps/node-cli` 成为唯一公开 npm 包并产出自包含 JS/Web 资源；四个已验证目标平台包只承载 `.node` 文件，主包通过精确版本 `optionalDependencies` 做安装期平台选择；Tauri 版本从根版本源读取，Cargo crates 继续使用 `version.workspace = true`。

**Tech Stack:** pnpm Workspace、TypeScript、tsup、napi-rs v3、Cargo、Tauri v2、Vitest、GitHub Actions。

## Global Constraints

- 单文件不超过 500 行；高性能优先，native loader 使用常量映射直接解析，不扫描文件系统、不运行安装脚本或 `node-gyp`。
- 公开 npm 包只包含 CLI、Web 静态资源、Server Delivery bundle、N-API loader 和必要声明/文档；Desktop artifact 不包含 Node/Fastify/WebSocket Server/N-API addon。
- 所有内部 `@code-agent/*` Workspace 包保持 `private: true`，平台 native 包除外；平台包仅通过 `os`、`cpu`、`libc` 和精确文件白名单表达兼容范围。
- 根版本、Node CLI、native packages、Cargo workspace 与 Tauri config 必须由自动门禁验证一致。
- Phase 9 的签名、notarization、Updater key/endpoint 和正式公开发布不在本计划实现。
- Python 命令只使用 `python3`，包管理使用 pnpm；不启动开发服务器。

### Task 1: 锁定 Phase 8 Workspace、版本和平台包契约

**Files:**

- Create: `tests/tauri-phase-8.test.ts`
- Create: `tools/verify-release-versions.mjs`
- Create: `apps/node-cli/package.json`
- Create: `packages/node-binding-darwin-arm64/package.json`
- Create: `packages/node-binding-darwin-x64/package.json`
- Create: `packages/node-binding-linux-x64-gnu/package.json`
- Create: `packages/node-binding-win32-x64-msvc/package.json`
- Modify: `package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: 根产品版本、Cargo `[workspace.package].version`、Tauri config、Workspace package manifests。
- Produces: `tauri:phase8:check` 和 `release:version:check`，确保唯一公开 CLI 包与所有发布版本一致。

**Behavior:**

- 根包设置 `private: true` 并移除公开包字段；建立 CLI 与四个已验证目标平台发布 manifest；Tauri config 的 `version` 直接引用根 `package.json`；版本脚本读取并严格比较根、CLI、平台包、Cargo workspace 和 Tauri 版本源。Phase 8 测试同时禁止内部包意外公开。

**Stop Conditions:**

- 若当前 Tauri v2 不接受相对 JSON 版本源，则保留显式版本并由同一门禁比较，不引入构建期文本替换。
- 若平台目标集合与迁移文档不一致，停止并更新计划，不静默增加未验证平台。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-8.test.ts && pnpm run release:version:check`

Expected: 根编排器、CLI、native packages、Cargo 和 Tauri 的版本与发布边界全部通过。

### Task 2: 迁移 Node CLI 发布包和自包含构建产物

**Files:**

- Create: `apps/node-cli/tsconfig.json`
- Create: `apps/node-cli/tsup.config.ts`
- Move: `src/*.ts` to `apps/node-cli/src/*.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.node.json`
- Modify: `vitest.config.ts`
- Modify: `vitest.performance.config.ts`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `tools/clean.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `@code-agent/engine-node`、`@code-agent/server`、Web build、现有 CLI contracts。
- Produces: `@bryanhu/code-agent` Workspace 包、`dist/cli.js`、`dist/server/*`、`dist/web/*` 和原 CLI 行为。

**Behavior:**

- CLI 源码和公开 manifest 归属 `apps/node-cli`；构建继续将内部 Workspace 源 bundle 为自包含 Node 产物，避免发布私有包；CLI 使用包内 manifest 和 `dist/web` 相对路径。根 scripts 通过 filter 编排，不持有 bin/files/publishConfig/dependencies。

**Stop Conditions:**

- 若任一内部 Workspace package 必须成为运行时 dependency，停止并修复 bundle 边界，不公开内部包。
- 若移动导致 CLI 行为变化，先恢复原有单测/E2E，不增加兼容转发入口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/node-cli/src && pnpm run typecheck && pnpm run build:node`

Expected: CLI 单测、类型检查和 Node bundle 通过，入口与 Web 资源均来自 `apps/node-cli`。

### Task 3: 建立 napi-rs 平台包和 O(1) native loader

**Files:**

- Modify: `packages/engine-node/src/native-binding.ts`
- Modify: `packages/engine-node/src/native-binding.test.ts`
- Modify: `tools/build-native-addon.mjs`
- Modify: `apps/node-cli/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `process.platform`、`process.arch`、Linux glibc 目标、四个精确版本 optional packages。
- Produces: 当前平台 package name 映射、可诊断 unsupported/missing addon 错误和无安装脚本的 native packages。

**Behavior:**

- loader 使用静态 `platform-arch` 映射直接 `require()` 对应 optional package；仅源码开发态回退 `packages/engine-node/native`。构建脚本将当前目标产物复制到对应平台 package，平台 manifest 用 `os`/`cpu`/`libc` 限制安装且只发布 `.node`、README、LICENSE。

**Stop Conditions:**

- 若 Linux musl 被当前范围要求，先扩展迁移范围与 CI 验证；不得将 GNU binary 标为 musl 兼容。
- 若 optional package 缺失时 loader 会触发目录扫描或动态下载，停止并保持确定性错误。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/engine-node/src/native-binding.test.ts && pnpm run build:native`

Expected: 支持目标常量时间解析，当前平台 addon 从开发产物和平台 package 均可加载。

### Task 4: 验证真实 tarball、Desktop 隔离和版本一致性

**Files:**

- Modify: `tools/verify-package.mjs`
- Create: `tools/verify-desktop-artifact.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `tests/tauri-phase-8.test.ts`

**Interfaces:**

- Consumes: `pnpm --filter @bryanhu/code-agent pack`、native platform packages、Tauri bundle、版本门禁。
- Produces: tarball allowlist、安装后 native smoke、Desktop forbidden-content scan 和可重放 CI artifacts。

**Behavior:**

- package check 从 `apps/node-cli` 生成真实 tarball，验证主包无源码/本地 `.node`/Tauri 内容、依赖协议已转换、optionalDependencies 使用精确产品版本，并用当前平台包完成 CLI/native smoke。Desktop 检查扫描 bundle，禁止 Node、Fastify、WebSocket Server 和 N-API addon。CI 上传命名含版本/target 的制品并在发布前验证全集。

**Stop Conditions:**

- 若真实跨平台 binary 尚未由对应 runner 生成，则 CI 只验证当前 runner 目标并保留 artifact 汇总门禁，不伪造其他平台文件。
- 若 Desktop 平台格式无法直接扫描，使用 Tauri 官方 bundle 列表/解包方式；不得跳过隔离校验。

- [x] **Task Status:** completed

Run: `pnpm run package:check && pnpm run desktop:artifact:check && pnpm run tauri:phase8:check`

Expected: npm tarball、当前 native package、Desktop 隔离和 Phase 8 持续门禁全部通过。

### Task 5: 更新发布指南、架构规范和迁移状态

**Files:**

- Modify: `docs/releasing.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `.superwork/plans/2026-08-13-tauri-phase-8-release-workspace.md`

**Interfaces:**

- Consumes: Tasks 1–4 的通过证据、npm/Tauri/napi-rs 官方分发约束和失败恢复语义。
- Produces: 面向维护者的 Phase 8 发布操作指南、持久架构约束和完成状态。

**Behavior:**

- 发布指南说明单一版本更新、四个平台构建、先 native 后主包、不可原子回滚、可重跑策略、Desktop artifacts 与 Phase 9 待办。迁移文档仅在全量门禁通过后标记 Phase 8 完成，并保持 Phase 9 待开始。

**Stop Conditions:**

- 若任一 targeted、全仓、Rust、E2E、package 或 Desktop build 门禁失败，Phase 8 保持待完成并记录证据。
- 不在文档中声称尚未验证的签名、notarization 或 Updater 能力。

- [x] **Task Status:** completed

Run: `pnpm run tauri:phase8:check && pnpm check && pnpm check:rust && pnpm test:e2e && pnpm --filter @code-agent/desktop build`

Expected: TypeScript、Rust、架构、性能、E2E、npm tarball、native package 和 Desktop artifact 全部通过，Phase 8 五项任务均为 completed。
