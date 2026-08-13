# Main Merge Implementation Plan

**Goal:** 将 `main` 的 `1.10.0` 发布与跨磁盘文件系统根目录能力完整合并到 `feat/tauri`，保留 Rust/Tauri 新架构并通过项目门禁。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Workspace、协议生成、版本一致性与验证命令。
- `.superwork/spec/backend/directory-structure.md` — 约束目录浏览能力归属 Rust Platform，不恢复旧 Node Server 实现。
- `.superwork/spec/backend/quality-guidelines.md` — 约束严格协议、跨平台路径与 Rust 验证。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束选择器行为、测试与性能。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client 与 Transport 依赖方向。

**Architecture:** 以 `main` 的协议和交互行为为准，将文件系统根目录枚举下沉至 Rust Platform，通过现有 Runtime `Value` 边界、Node N-API 和 Tauri Command 透传；Web 只消费统一 Protocol，不恢复当前分支已删除的 Node 文件系统实现。

**Tech Stack:** Git、TypeScript、React、Vitest、Rust、Tokio、Tauri v2、pnpm。

## Global Constraints

- 保留 `feat/tauri` 的 Rust Runtime、Tauri Transport、Workspace 发布结构和单一 Protocol Schema 来源。
- 采用 `main` 的 `1.10.0` 发布基线，并保持根包、Workspace 包、Cargo Workspace 与 Tauri 配置版本一致。
- 生产文件不得超过 500 行；文件系统遍历必须异步、有界并跳过符号链接。
- 不恢复已删除的 `packages/server` 文件系统业务实现；新能力只进入 Rust Platform。

### Task 1: 合并 main 并解决架构冲突

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Modify: `package.json`
- Modify: `packages/server/src/app.test.ts`
- Delete: `packages/server/src/host-file-browser.ts`
- Delete: `packages/server/src/host-file-browser.test.ts`
- Delete: `packages/server/src/filesystem-roots.ts`
- Delete: `packages/server/src/filesystem-roots.test.ts`
- Delete: `packages/server/src/project-directory-browser.ts`
- Delete: `packages/server/src/project-directory-browser.test.ts`

**Interfaces:**

- Consumes: `main` at `47dd2f33` and current `feat/tauri` HEAD
- Produces: conflict-free Git index preserving Rust/Tauri ownership boundaries

**Behavior:**

- 合并 `main`，保留 Workspace 新架构与删除旧 Node 实现的决策，同时接收 `main` 的发布记录、协议、Web 交互和测试。

**Stop Conditions:**

- 如果工作区不再干净、`main` 在合并前发生变化，或冲突揭示无法同时满足的公开契约，则停止并重新确认基线。

- [x] **Task Status:** completed

Run: `git diff --check && test -z "$(git diff --name-only --diff-filter=U)"`

Expected: 不存在冲突标记或空白错误，Git 索引中没有未合并路径。

### Task 2: 在 Rust/Tauri 新架构实现文件系统根目录能力

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `schemas/code-agent-runtime.schema.json`
- Modify: `crates/protocol/src/generated.rs`
- Modify: `crates/platform/src/host_file_browser.rs`
- Test: `crates/platform/tests/files.rs`
- Modify: `apps/web/src/shared/lib/filesystem-roots.ts`
- Test: `apps/web/src/shared/lib/filesystem-roots.test.ts`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Test: `apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`

**Interfaces:**

- Consumes: `ProjectDirectoryListingSchema`, `HostFileListingSchema`, `FilePort::browse_directories`, `FilePort::browse_host_files`
- Produces: `FilesystemRoot`, listing `roots`, platform-specific root enumeration, root switching UI

**Behavior:**

- POSIX 返回 `/` 根目录，Windows 返回当前可访问盘符；两类目录浏览响应均携带稳定根目录列表，选择器可在多个根之间切换并清空旧展开/选择状态。

**Stop Conditions:**

- 如果生成协议无法表达跨平台绝对路径、Rust 根目录枚举需要新增不受控系统命令，或 UI 必须绕过统一 Client 契约，则停止并修正设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts apps/web/src/shared/lib/filesystem-roots.test.ts apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx apps/web/src/features/workbench/components/host-attachment-picker-dialog.test.tsx && cargo test -p code-agent-platform --test files --locked`

Expected: 协议、根目录选择和 Rust Platform 定向测试全部通过。

### Task 3: 同步发布版本并完成全量验证

**Files:**

- Modify: `package.json`
- Modify: `apps/node-cli/package.json`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `packages/*/package.json`
- Modify: `.superwork/plans/2026-08-13-merge-main-filesystem-roots.md`

**Interfaces:**

- Consumes: root `version` as the product version source and Superwork verification policy
- Produces: consistent `1.10.0` release metadata and passing TypeScript/Rust/package gates

**Behavior:**

- 所有发布单元使用 `1.10.0`，生成协议无漂移，格式、架构、Rust、Tauri、构建和包结构验证通过。

**Stop Conditions:**

- 如果门禁暴露与本次合并无关的既有失败，记录精确命令和错误；如果失败来自合并或版本同步，必须修复后再完成。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm check:rust`

Expected: 两个完整门禁均以退出码 0 完成。
