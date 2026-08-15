# Windows 与 Linux 跨平台加固设计

## Goal

修复 Windows Desktop 关闭阶段的无效等待，并让 Windows/Linux 发布 smoke 真实覆盖全部安装包与进程树清理，避免损坏制品或残留子进程进入公开 Release。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`：约束支持矩阵、跨平台子进程、发布 artifact 与验证门禁。
- `.superwork/spec/backend/runtime-lifecycle.md`：约束协作取消、受跟踪任务和有界关闭。
- `.superwork/spec/shared/quality-guidelines.md`：约束 Desktop Delivery、错误保真和跨平台契约测试。
- `.superwork/plans/2026-08-15-unsigned-desktop-releases.md`：提供三平台 Preview / Unsigned 发布与 smoke 基线。

## Existing Context

- 产品只支持 Windows 10+ x64 与 Ubuntu 22.04+ x64 glibc，不扩展 arm64、musl 或其他 Linux 发行版。
- 最新 `feat/tauri` CI 已通过 Windows 与 Linux 的质量、Rust 和浏览器门禁。
- Windows release smoke 当前只安装 NSIS，MSI 仅验证文件存在，无法拒绝不可安装的 MSI。
- Windows Codex 关闭序列在 stdin 优雅关闭失败后执行一次无动作的 `Terminate`，仍等待完整 `shutdown_timeout` 才强制终止。
- Linux smoke 只终止 `xvfb-run` 包装进程 PID，未显式约束其 Desktop/Codex 子进程组。

## Approaches

### A. 只增加静态契约

通过 Vitest 检查脚本文本包含 MSI、NSIS 和清理命令。实现最小，但无法证明安装器能安装、应用能启动或子进程能退出，不满足发布门禁目标。

### B. 强化现有运行时与 release smoke（推荐）

保持现有依赖和 workflow 结构：修正 Rust 平台关闭分支；Windows smoke 分别安装、启动、优雅关闭并卸载 MSI 与 NSIS；Linux smoke 为 `xvfb-run` 建立独立进程组并有界终止整组。改动集中，能直接消除已确认风险。

### C. 引入 Windows Job Object 与三平台 Desktop IPC 矩阵

用 Job Object 统一托管 Codex/MCP 进程树，并在 Windows/Linux 运行完整 WebDriver IPC E2E。隔离最强，但需要新增 Windows API 封装、驱动与 CI 维护，本轮问题没有足够证据支持该复杂度。

## Recommended Approach

采用方案 B。生产代码只调整 `crates/provider-codex/src/process.rs` 的平台关闭状态机；发布脚本只调整 Windows 与 Linux smoke；契约测试锁定两个安装器都被执行以及 Linux 进程组清理。

## Component Responsibilities And Interfaces

### Codex process supervisor

- 输入：`shutdown_timeout`、子进程退出通知、`Terminate | Kill` 控制消息。
- Unix：维持 `stdin close -> SIGTERM -> SIGKILL`。
- Windows：执行 `stdin close -> terminate process`，不再经过无动作等待。
- 输出：平台中立的超时错误，不在 Windows 错误中声称发送 `SIGKILL`。

### Windows release smoke

- 输入：包含唯一 MSI 与 NSIS 的 Desktop archive。
- 为 MSI 和 NSIS 使用独立安装目录，分别执行静默安装、定位唯一产品 executable、启动、请求主窗口关闭、等待退出和卸载。
- 超时后强制停止仅作为清理兜底，正常路径必须验证 Tauri 生命周期关闭。
- 任一安装器失败都阻止 release approval。

### Linux release smoke

- 输入：包含唯一 DEB 与 AppImage 的 Desktop archive。
- 继续分别启动 DEB 与 AppImage。
- 每次启动使用独立 session/process group；存活验证结束后先发送 `TERM`，超时再发送 `KILL`，并回收包装进程。
- cleanup 对当前活动进程组幂等执行，避免异常路径残留 Desktop/Codex。

## Error Handling

- Windows 安装、启动、优雅关闭、卸载均检查退出状态并报告具体 artifact 类型。
- Windows 关闭超时后强制清理，再以失败结束 smoke，不能把兜底清理当作通过。
- Linux 进程提前退出时输出对应日志；进程组清理忽略“进程已退出”，但不吞掉启动失败。
- Rust 关闭超时消息统一使用 `forced termination`，避免平台语义错误。

## Verification Strategy

- 先增加失败契约，要求 Windows smoke 同时调用 `msiexec.exe` 与 NSIS，并要求 Linux 使用 session/process group 清理。
- 增加 Rust 单元测试覆盖 Windows/Unix 关闭阶段选择的纯状态决策，避免依赖当前宿主平台才能断言。
- 运行 `pnpm exec vitest run tests/tauri-phase-9.test.ts`。
- 运行 `cargo test -p code-agent-provider-codex --test process --locked`。
- 运行 `bash -n tools/release/smoke-desktop-linux.sh` 和 PowerShell parser 检查（宿主可用时）。
- 最终运行 `pnpm check` 与 `pnpm check:rust`；真实安装仍由对应 release runner 执行。

## Non-Goals

- 不新增支持平台或架构。
- 不引入 Windows Job Object、系统签名或新的 Rust 依赖。
- 不把 Desktop IPC E2E 扩展到 Windows/Linux。
- 不启动开发服务器，不执行真实发布或安装本机 Desktop artifact。

## Success Criteria

- Windows 关闭不再消耗一次必然无效的 `shutdown_timeout`。
- Windows release approval 同时依赖 MSI 与 NSIS 的安装、启动、关闭和卸载成功。
- Linux smoke 的所有 Desktop/Codex 子进程在成功与失败路径都受到有界进程组清理。
- 定向测试、`pnpm check` 和 `pnpm check:rust` 全部通过，用户已有 `.node` 改动保持不变。
