# Feature Implementation Plan

**Goal:** 让 macOS、Windows 和 Linux Desktop 先以 Preview / Unsigned 方式发布，并提供三端可执行的下载安装说明。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 发布矩阵、签名边界和验证门禁
- `docs/tauri-migration-plan.md` — Phase 9 发布目标与 clean VM 验收范围
- `docs/releasing.md` — 维护者发布流程和失败恢复方式

**Architecture:** 删除操作系统证书、macOS 公证和系统签名门禁，统一发布三端无证书安装包；继续使用独立 Tauri updater 密钥签名更新制品，并保留三端最低系统安装启动 smoke。

**Tech Stack:** GitHub Actions YAML、Tauri v2 JSON、Bash、Vitest、Markdown

## Global Constraints

- Desktop 仅支持 macOS 14+ Apple Silicon、Windows 10+ x64 和 Ubuntu 22.04+ x64 glibc。
- 操作系统代码签名与 Tauri updater 制品签名必须明确区分，后者不得删除或降级。
- 项目命令使用 `pnpm`，Python 命令使用 `python3`，单文件不得超过 500 行。

### Task 1: 固化三端无证书发布契约

**Files:**

- Modify: `tests/tauri-phase-9.test.ts`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: 当前 Tauri 配置、release workflow、平台 smoke 和文档字符串契约
- Produces: 三端 Preview / Unsigned、无 Apple/Windows/Linux 系统证书配置且 updater 继续签名的测试契约

**Behavior:**

- 测试拒绝 Apple certificate、公证、`codesign`、`stapler`、`spctl` 和平台系统签名门禁，同时要求统一 Preview / Unsigned 标识、最低系统检查、三端安装启动 smoke 与 updater `.sig`。

**Stop Conditions:**

- 如果 Tauri updater 必须依赖操作系统证书才能生成更新制品，则停止并重新界定签名边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts`

Expected: 新增契约在旧实现上失败，并准确指出 Apple 签名、公证或文档声明仍存在。

### Task 2: 实现三端无证书构建与 smoke

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Delete: `apps/desktop/src-tauri/Entitlements.plist`
- Modify: `tools/release/smoke-desktop-macos.sh`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: `TAURI_SIGNING_PRIVATE_KEY` updater 密钥、三平台 Tauri bundle 和最低系统 runner
- Produces: 无操作系统证书依赖的 DMG、DEB/AppImage、MSI/NSIS，以及继续带 `.sig` 的 updater artifacts

**Behavior:**

- release workflow 不读取 Apple 或其他平台证书，不执行 macOS 公证和系统签名验证；macOS 配置只保留 `minimumSystemVersion: "14.0"`，smoke 直接挂载并启动构建制品。

**Stop Conditions:**

- 如果删除系统证书配置会阻止 Tauri 生成目标 bundle 或 updater artifact，则停止并记录具体 bundler 限制。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts -t "macOS minimum|signed updater metadata|all Desktop installers|smokes CLI" && pnpm exec prettier --check .github/workflows/release.yml apps/desktop/src-tauri/tauri.conf.json tests/tauri-phase-9.test.ts && bash -n tools/release/smoke-desktop-macos.sh`

Expected: 三端无证书发布契约、workflow 格式和最低系统 smoke 静态检查通过。

### Task 3: 更新三端下载安装与发布说明

**Files:**

- Modify: `README.zh-CN.md`
- Modify: `README.md`
- Modify: `docs/releasing.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/prd/2026-08-15-release-readiness-design.md`
- Modify: `CHANGELOG.md`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: GitHub Releases 三端安装包、macOS Gatekeeper、Windows SmartScreen、Ubuntu package/AppImage 行为
- Produces: 面向用户的三端下载安装 How-to 和面向维护者的无证书发布运行手册

**Behavior:**

- 中英文 README 分别说明 macOS 被拦截后的“隐私与安全性 > 仍要打开”、Windows 的“更多信息 > 仍要运行”、Ubuntu 的 `.deb` 与 `.AppImage` 使用步骤；维护文档统一声明三端 Preview / Unsigned，且 updater 仍做独立加密签名校验。

**Stop Conditions:**

- 如果文档步骤与当前支持的安装包格式或系统版本不一致，则停止并先修正发布矩阵。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts && pnpm exec prettier --check README.md README.zh-CN.md docs/releasing.md docs/tauri-migration-plan.md .superwork/spec/guides/index.md .superwork/prd/2026-08-15-release-readiness-design.md CHANGELOG.md .superwork/plans/2026-08-15-unsigned-desktop-releases.md && git diff --check`

Expected: 三端下载、安装、安全提示和维护者发布边界完整一致，Markdown 格式及差异检查通过。

### Task 4: 完成全量验证

**Files:**

- Test: `tests/tauri-phase-9.test.ts`
- Test: `.github/workflows/release.yml`
- Test: `apps/desktop/src-tauri/tauri.conf.json`

**Interfaces:**

- Consumes: 所有实现与文档修改
- Produces: 仓库快速门禁、发布版本检查和 Desktop artifact 静态验证证据

**Behavior:**

- 运行项目快速门禁与发布专项检查，确认无遗留 Apple 证书/公证逻辑、三端系统签名声明或格式错误。

**Stop Conditions:**

- 如果失败来自与本次改动无关的既有工作区变更，则保留原改动并报告具体失败；如果与本次改动相关则修复后重跑。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm run release:version:check && pnpm run desktop:artifact:check`

Expected: 所有命令退出码为 0，且 `rg` 未发现遗留 Apple 证书和公证发布依赖。
