# Feature Implementation Plan

**Goal:** 直接发布未签名的 Windows Desktop，并在所有发布入口明确标记为 Preview / Unsigned。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 发布矩阵、签名与验证规则需要同步更新。

**Architecture:** 移除 Windows Authenticode 构建与验证链路，保留 Tauri updater 的独立签名；发布工作流继续构建和 smoke Windows 安装包，并通过 Release 标题与文档明确其预览及未签名状态。

**Tech Stack:** GitHub Actions YAML、Tauri JSON、PowerShell、Vitest、Markdown

## Global Constraints

- Windows Desktop 不依赖任何证书或 Azure Artifact Signing 配置即可发布。
- Tauri updater artifact 继续使用 `TAURI_SIGNING_PRIVATE_KEY` 签名。
- macOS 签名、公证和 Gatekeeper 门禁保持不变。

### Task 1: 固化 Windows Preview / Unsigned 发布契约

**Files:**

- Modify: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: 当前 Tauri 配置、Release workflow、Windows smoke 与发布文档
- Produces: Windows 无 Authenticode 门禁且有 Preview / Unsigned 标识的仓库契约

**Behavior:**

- 测试要求 Windows 配置、workflow 和 smoke 不再引用签名脚本或 Azure，并要求 Release 与中英文说明明确标记 Preview / Unsigned。

**Stop Conditions:**

- 如果 updater 签名与系统 Authenticode 无法独立配置则停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts`

Expected: 新契约在实现前因现有 Authenticode 配置而失败。

### Task 2: 发布未签名 Windows Desktop

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `tools/release/smoke-desktop-windows.ps1`
- Delete: `apps/desktop/scripts/sign-windows.ps1`
- Delete: `tools/release/verify-windows-signatures.ps1`

**Interfaces:**

- Consumes: Tauri bundler、`TAURI_SIGNING_PRIVATE_KEY`、Windows 10 smoke runner
- Produces: 无证书依赖的 Windows MSI/NSIS 与带 Preview / Unsigned 标识的 GitHub Release

**Behavior:**

- Windows runner 直接构建未签名 MSI/NSIS，不执行 Azure 配置、工具安装或 Authenticode 复验；smoke 仍验证安装、启动与卸载。

**Stop Conditions:**

- 如果移除 `signCommand` 会同时禁用 updater 签名则停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts -t "publishes Windows Desktop|smokes CLI and Desktop"`

Expected: Windows 构建与 smoke 的 Preview / Unsigned 契约通过。

### Task 3: 同步用户说明与工程约束

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/releasing.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `.superwork/spec/guides/index.md`

**Interfaces:**

- Consumes: 更新后的 Windows 发布行为
- Produces: 一致的支持矩阵、风险提示、维护者流程和长期工程规范

**Behavior:**

- 所有用户与维护者文档明确 Windows Desktop 是 Preview / Unsigned，可能触发 SmartScreen，且不宣称通过正式系统签名门禁。

**Stop Conditions:**

- 如果文档仍存在 Windows 已签名或正式签名门禁声明则停止。

- [x] **Task Status:** completed

Run: `rg -n -i 'Azure Artifact Signing|Authenticode|sign-windows|verify-windows-signatures' README.md README.zh-CN.md docs/releasing.md docs/tauri-migration-plan.md .superwork/spec/guides/index.md .github/workflows/release.yml apps/desktop tools/release`

Expected: 不存在过时的 Windows 正式签名声明或实现引用。

### Task 4: 执行最终验证

**Files:**

- Test: `tests/tauri-phase-8.test.ts`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: 完整变更集与仓库校验脚本
- Produces: 发布契约、格式、Lint、类型与测试通过证据

**Behavior:**

- 验证发布矩阵仍完整、Windows 无签名依赖、Updater 签名保留且仓库快速基线通过。

**Stop Conditions:**

- 如果失败来自本任务文件则修复后重跑；如果仅来自用户已有修改则记录并停止扩大修改范围。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 所有快速基线检查通过。
