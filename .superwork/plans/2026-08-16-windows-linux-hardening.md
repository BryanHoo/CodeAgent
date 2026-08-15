# Feature Implementation Plan

**Goal:** 消除 Windows Codex 关闭的无效等待，并让 Windows/Linux release smoke 完整验证安装器与进程清理。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束支持平台、子进程、发布 artifact 和验证门禁。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束协作关闭、有界等待和任务回收。
- `.superwork/spec/shared/quality-guidelines.md` — 约束跨平台契约、Desktop Delivery 和错误保真。
- `.superwork/prd/2026-08-16-windows-linux-hardening-design.md` — 固定本轮边界、方案和成功条件。

**Architecture:** 保持现有依赖和 release workflow，在 Rust supervisor 中按平台选择关闭升级阶段，并强化 Windows/Linux 原生 smoke 脚本的真实安装与进程回收。

**Tech Stack:** Rust、Tokio、PowerShell、Bash、Vitest、GitHub Actions

## Global Constraints

- 仅支持 Windows 10+ x64 与 Ubuntu 22.04+ x64 glibc，不新增架构或发行版。
- 子进程必须使用参数数组、无 Shell 拼接、有界等待和确定性清理。
- Rust 与脚本关键平台差异添加简短中文注释，单文件不得超过 500 行。
- 不引入 Windows Job Object、新依赖或三平台 Desktop IPC E2E。
- 不启动开发服务器，不修改用户已有的 `packages/engine-node/native/code-agent-node-binding.node`。

### Task 1: 固化跨平台关闭与发布 smoke 契约

**Files:**

- Modify: `tests/tauri-phase-9.test.ts`
- Modify: `crates/provider-codex/src/process.rs`

**Interfaces:**

- Consumes: 当前 `CodexAppServerProcess::escalate`、Windows/Linux release smoke 文本契约
- Produces: 平台关闭阶段选择测试、MSI/NSIS 双安装验证契约、Linux 进程组清理契约

**Behavior:**

- 用失败测试锁定 Windows 只执行一次强制终止等待、错误消息平台中立、Windows smoke 同时执行 MSI 与 NSIS、Linux smoke 创建并清理独立进程组。

**Stop Conditions:**

- 如果无法把关闭阶段选择提取为无系统调用的纯逻辑，则停止并改用当前平台集成测试，不引入平台模拟全局状态。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts && cargo test -p code-agent-provider-codex --lib --locked`

Expected: 新契约在实现前准确失败，且失败只指向缺失的跨平台行为。

### Task 2: 优化 Windows Codex 关闭状态机

**Files:**

- Modify: `crates/provider-codex/src/process.rs`
- Test: `crates/provider-codex/tests/process.rs`

**Interfaces:**

- Consumes: `SupervisorCommand`、`shutdown_timeout`、`wait_for_exit`
- Produces: Unix `Terminate -> Kill` 与 Windows `Kill` 的平台特定升级序列

**Behavior:**

- stdin 关闭超时后，Unix 保持 SIGTERM 再 SIGKILL；Windows 直接请求 `start_kill` 并只等待一次，超时错误统一描述为 `forced termination`。

**Stop Conditions:**

- 如果变更会减少 stdin 优雅关闭等待或破坏 Unix SIGTERM 阶段，则停止并收紧平台分支。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test process --locked`

Expected: 进程握手、异常退出、幂等关闭和强制关闭测试全部通过。

### Task 3: 加固 Windows 与 Linux release smoke

**Files:**

- Modify: `tools/release/smoke-desktop-windows.ps1`
- Modify: `tools/release/smoke-desktop-linux.sh`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: `code-agent-desktop-win32-x64-msvc.tar.gz`、`code-agent-desktop-linux-x64-gnu.tar.gz`
- Produces: MSI/NSIS 双安装启动卸载门禁、DEB/AppImage 进程组启动清理门禁

**Behavior:**

- Windows 为 MSI 与 NSIS 使用隔离目录，分别安装、启动、请求主窗口关闭、等待并卸载；Linux 为 DEB 与 AppImage 启动独立 session/process group，使用 TERM、超时 KILL 和幂等 cleanup 回收整组进程。

**Stop Conditions:**

- 如果 MSI 不接受当前 Tauri/WiX 静默安装属性，则停止并根据真实 MSI 元数据调整，不得退回仅检查文件存在。
- 如果 Ubuntu 22.04 缺少 `setsid`，则停止并在 workflow 显式安装提供该命令的系统包。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts && bash -n tools/release/smoke-desktop-linux.sh`

Expected: 发布契约与 Bash 语法通过，PowerShell 脚本保持参数化、无命令字符串拼接且单文件少于 500 行。

### Task 4: 执行最终验证

**Files:**

- Modify: `.superwork/plans/2026-08-16-windows-linux-hardening.md`
- Test: `tests/tauri-phase-9.test.ts`
- Test: `crates/provider-codex/tests/process.rs`

**Interfaces:**

- Consumes: Tasks 1-3 的完整改动与仓库验证配置
- Produces: 快速基线、Rust 全量门禁、格式与工作区边界证据

**Behavior:**

- 运行定向测试、`pnpm check`、`pnpm check:rust`、脚本语法和 diff 检查；确认仅剩真实 Windows 10/Ubuntu 22.04 release runner 安装验收。

**Stop Conditions:**

- 如果失败来自本次修改则修复后重跑；如果仅来自用户已有 `.node` 二进制修改则保留该修改并明确记录。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm check:rust && bash -n tools/release/smoke-desktop-linux.sh && git diff --check`

Expected: 全部门禁退出码为 0，改动文件不超过 500 行，用户已有二进制修改保持不变。
