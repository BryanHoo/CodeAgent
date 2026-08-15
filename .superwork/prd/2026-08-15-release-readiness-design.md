# Desktop 与 CLI 发布就绪设计

## Goal

为 CodeAgent Desktop 与 CLI 建立可审计的正式发布门禁，支持以下经过验证的目标：

| 产品          | 最低系统      | 架构          | 交付物                                |
| ------------- | ------------- | ------------- | ------------------------------------- |
| Desktop / CLI | macOS 14+     | Apple Silicon | `.dmg`、updater、npm CLI              |
| Desktop / CLI | Windows 10+   | x64           | NSIS `.exe`、`.msi`、updater、npm CLI |
| Desktop / CLI | Ubuntu 22.04+ | x64 glibc     | `.deb`、`.AppImage`、npm CLI          |

未列出的 Intel macOS、Windows arm64、Linux arm64 和非 glibc Linux 不进入产品声明、构建矩阵或发布产物。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`：发布目标、版本、签名、artifact 和完整门禁约束。
- `.superwork/spec/shared/quality-guidelines.md`：跨平台契约测试、500 行限制和验证要求。
- `docs/tauri-migration-plan.md`：Phase 9、发布矩阵和 clean VM 完成定义。
- `docs/releasing.md`：现有 npm、GitHub Release、Updater 和 macOS 公证运行手册。

## Existing Context

- 根 `package.json` 已是唯一版本源，CLI 与三个 native package 使用精确版本关联。
- `.github/workflows/release.yml` 已在 macOS、Ubuntu 和 Windows runner 构建 Desktop 与 npm artifact，并创建 draft GitHub Release。
- macOS 已设置 `minimumSystemVersion: "14.0"`，具备 Developer ID 签名、公证、stapling、Gatekeeper 和 App Sandbox entitlement 门禁。
- Updater 已使用 HTTPS endpoint、内置公钥和私钥签名 artifact。
- Linux 已在 `ubuntu-22.04` 构建，符合 Tauri 对最低 glibc 基线构建环境的要求。
- Windows artifact 当前只有 updater 签名，没有 Authenticode；当前托管 runner 也不能证明 Windows 10 的安装与启动行为。
- 当前 `publish` job 在各平台安装 smoke 之前发布 npm，且不会自动将通过验收的 draft Release 转为正式 Release。
- README 只描述 CLI 浏览器模式，没有清晰列出 Desktop 下载方式、平台与架构范围。

## Approaches

### 方案一：文档化人工发布检查

保留现有 workflow，只补充平台声明、签名和人工 smoke 清单。

优点是改动最少，不需要额外 runner。缺点是 npm 仍可能在安装验证前发布，Windows 未签名也无法由门禁阻止，不满足正式发布的可审计要求。

### 方案二：只使用 GitHub 托管 runner

在 `macos-14`、`ubuntu-22.04` 和 `windows-2022` 上完成构建、安装与 smoke。

优点是无需维护机器，macOS 14 Apple Silicon 和 Ubuntu 22.04 可直接覆盖。缺点是 GitHub 没有 Windows 10 托管 runner，Windows Server 2022 不能替代 Windows 10 Desktop、WebView2 和安装器验证。

### 方案三：托管构建加最低系统 smoke

使用托管 runner 构建、签名和检查 artifact；macOS 14 与 Ubuntu 22.04 直接在对应托管 clean VM smoke，Windows artifact 在带 `windows-10` 标签的 x64 自托管 clean runner 上安装和启动。所有 smoke 通过后才发布 npm，并将 GitHub draft Release 转为正式版本。

该方案是推荐方案。它保留可复现的托管构建，同时对无法由托管环境覆盖的 Windows 10 建立真实最低系统门禁。

## Recommended Approach

### 发布边界

`release.yml` 继续由符合 `v*.*.*` 的 tag 或显式 dispatch 触发，并拆为以下有向门禁：

```text
build signed artifacts
        |
        v
minimum-OS Desktop + CLI smoke
        |
        v
publish native npm packages -> publish CLI package
        |
        v
publish GitHub Release
```

任一平台构建、签名、安装、启动或 CLI 诊断失败时，GitHub Release 保持 draft，npm publish 和正式 Release 均不得执行。

### 平台与 artifact

- macOS build runner 固定为 `macos-14`，该标签是 Apple Silicon；构建目标只允许 `darwin-arm64`。
- Linux build runner 固定为 `ubuntu-22.04`，确保 native addon、Desktop 和 AppImage 以最低 glibc 基线构建。
- Windows build runner 使用 `windows-2022` x64 生成兼容 Windows 10 的 MSVC 产物；最低系统行为由 Windows 10 runner 验收。
- Desktop bundle 限制为 macOS `.dmg`，Windows NSIS `.exe` 与 `.msi`，Ubuntu `.deb` 与 `.AppImage`，不发布与支持范围无关的 RPM。
- 每个平台继续生成 updater artifact 和 `.sig`；归档与 `SHA256SUMS` 覆盖所有 npm 与 Desktop 文件。

### Windows Authenticode

Windows 使用 Azure Artifact Signing 和 Tauri `bundle.windows.signCommand` 在 bundler 内签名，保证内部 executable、安装器和最终 updater 文件的签名顺序正确。不得在 updater `.sig` 生成后修改安装器。

签名命令从 GitHub Secrets 读取以下值：

- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`
- `AZURE_ARTIFACT_SIGNING_ENDPOINT`
- `AZURE_ARTIFACT_SIGNING_ACCOUNT`
- `AZURE_ARTIFACT_SIGNING_PROFILE`

Workflow 固定安装已审核版本的 `Microsoft.ArtifactSigning.Client` 与 `Microsoft.Windows.SDK.BuildTools`。签名 wrapper 只接受 Tauri 提供的单一 artifact 路径，以结构化 metadata 和参数数组调用 `SignTool + Azure.CodeSigning.Dlib.dll`，固定使用 SHA-256 与 Microsoft RSA 时间戳；endpoint、account、profile、Azure 环境凭据、.NET 8 runtime 或签名工具缺失时立即失败。构建后使用 Windows Authenticode API 检查 CodeAgent 主程序、NSIS `.exe` 和 `.msi` 均为 `Valid`，并确认时间戳存在；bundled Codex 内第三方 executable 不作为 CodeAgent 证书身份断言对象。

### Clean VM Smoke

每个平台 smoke 都下载当前 run 产生的 artifact，不重新构建：

- CLI：在临时 prefix 安装主 tarball 和当前平台 native tarball，执行 `code-agent --help` 与 `code-agent doctor`，覆盖入口、native addon、bundled Codex、SQLite migration 和基础进程生命周期。
- macOS 14：挂载 `.dmg`，再次执行 Gatekeeper 检查，启动 `.app`，等待主进程存活后协作终止。
- Ubuntu 22.04：通过 `apt` 安装 `.deb`，在 `xvfb-run` 中启动 Desktop，等待主进程存活后协作终止；AppImage 单独检查可执行权限和启动。
- Windows 10：静默安装签名 NSIS 包，复验安装器和已安装 executable 的 Authenticode，启动应用并等待主进程存活后终止；再卸载，避免 runner 状态污染。

Windows runner 必须带 `self-hosted, Windows, X64, windows-10` 标签，并在每次 job 前恢复干净快照。没有匹配 runner 时发布保持等待，不允许把 `windows-2022` smoke 结果视为 Windows 10 验收。

### Interfaces And Responsibilities

- `.github/workflows/release.yml`：编排构建、签名、smoke、npm 发布和 GitHub Release 转正式的依赖顺序。
- `apps/desktop/src-tauri/tauri.conf.json`：声明支持范围对应的 Desktop bundles 与 Windows custom sign command。
- `tools/release/*`：提供短小、可本地调用的平台签名与 smoke 脚本；每个脚本负责解析唯一 artifact、执行命令、限时等待和清理。
- `tests/tauri-phase-9.test.ts`：锁定平台矩阵、Windows 签名、最低系统 smoke、发布依赖顺序和文档声明。
- `README.md`、`README.zh-CN.md`：面向用户说明 Desktop 与 CLI 的支持系统、架构、安装方式和不支持目标。
- `docs/releasing.md`：面向维护者记录 Azure、Windows runner、最小系统 smoke、失败恢复和发布顺序。
- `.superwork/spec/guides/index.md` 与 `docs/tauri-migration-plan.md`：在门禁完成后固化发布约束并更新 Phase 9 状态。

### Error Handling

- 缺少任何签名 secret、签名状态非 `Valid`、缺少时间戳或 artifact 集不完整时，build 失败。
- 安装器数量不唯一、安装失败、进程未在限定时间内启动、CLI doctor 失败或清理失败时，smoke 失败。
- 所有脚本使用显式路径、无交互参数和有界等待；失败输出 artifact 路径、命令退出码与平台信息，但不得输出 secret。
- npm 发布保持可重入：已存在的同版本 package 跳过，缺失 package 按 native 在前、CLI 在后的顺序补齐。
- 只有 `publish` 成功后才能执行 `gh release edit --draft=false`；promotion 失败时 npm 版本保留，Release 继续为 draft 并可重试。

## Verification Strategy

- 先扩展 `tests/tauri-phase-9.test.ts`，使新平台、签名、smoke 和发布顺序契约在实现前失败。
- 对跨平台脚本提取纯解析函数或 dry-run 输入，使用 Vitest 覆盖缺失 artifact、重复 artifact、超时和失败签名。
- 运行 `pnpm exec vitest run tests/tauri-phase-9.test.ts`、`pnpm check`、`pnpm check:rust`、`pnpm run release:version:check` 和 `pnpm run package:check`。
- Desktop 配置与发布资源改动运行 `pnpm run build:desktop` 和 `pnpm run desktop:artifact:check`。
- Workflow 的真实签名和最低系统 smoke 只能由带 secrets 与目标 runner 的 tag dry run 最终确认；本地验证不得宣称替代该证据。

## Non-Goals

- 不支持或发布 Intel macOS、Windows arm64、Linux arm64、musl Linux 或 Ubuntu 22.04 之前的系统。
- 不引入 Microsoft Store、Mac App Store、Snap、Flatpak、Homebrew 或 Linux repository。
- 不主动修改 Runtime、Provider、IPC、Web UI 或数据模型；若发布前完整门禁暴露真实崩溃，只修复阻断发布的最小运行时边界并补回归测试。
- 不在仓库保存 updater、Apple 或 Azure 私钥。
- 不把 Windows Server 版本声明为用户支持目标。

## Success Criteria

- README、发布指南、Tauri 配置和 workflow 对三个支持目标使用同一平台与架构集合。
- Windows Desktop 所有可执行 artifact 具备有效且带时间戳的 Authenticode 签名。
- macOS 14 Apple Silicon、Windows 10 x64 与 Ubuntu 22.04 x64 均完成 CLI 和 Desktop clean VM smoke。
- npm publish 与 GitHub Release promotion 都依赖三平台 smoke 成功。
- 失败 release 保持 draft，未验收产物不会进入 npm 或 updater 的公开 `latest`。
- `pnpm check`、Rust、package、Desktop artifact 和 Phase 9 契约测试全部通过。
