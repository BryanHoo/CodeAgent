# Desktop 与 CLI 发布就绪设计

## Goal

为 CodeAgent Desktop 与 CLI 建立可审计的发布门禁，支持以下目标：

| 产品          | 最低系统      | 架构          | 交付物                                |
| ------------- | ------------- | ------------- | ------------------------------------- |
| Desktop / CLI | macOS 14+     | Apple Silicon | `.dmg`、updater、npm CLI              |
| Desktop / CLI | Windows 10+   | x64           | NSIS `.exe`、`.msi`、updater、npm CLI |
| Desktop / CLI | Ubuntu 22.04+ | x64 glibc     | `.deb`、`.AppImage`、npm CLI          |

未列出的 Intel macOS、Windows arm64、Linux arm64 和非 glibc Linux 不进入产品声明、构建矩阵或发布产物。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`：发布目标、版本、签名边界、artifact 和完整门禁约束。
- `.superwork/spec/shared/quality-guidelines.md`：跨平台契约测试、500 行限制和验证要求。
- `docs/tauri-migration-plan.md`：Phase 9、发布矩阵和 clean VM 完成定义。
- `docs/releasing.md`：npm、GitHub Release、Updater 和三端无证书发布手册。

## Existing Context

- 根 `package.json` 是唯一版本源，CLI 与三个 native package 使用精确版本关联。
- `.github/workflows/release.yml` 在 macOS、Ubuntu 和 Windows runner 构建 Desktop 与 npm artifacts，并创建 draft GitHub Release。
- 三平台 Desktop 暂以 Preview / Unsigned 发布，不使用操作系统代码签名证书。
- Updater 使用 HTTPS endpoint、内置公钥和私钥签名 artifact；该签名独立于操作系统证书。
- Linux 在 `ubuntu-22.04` 构建，以最低 glibc 基线生成制品。
- Windows Server runner 负责构建，Windows 10 自托管 clean runner 负责最低系统安装与启动验收。

## Recommended Approach

### 发布边界

`release.yml` 由符合 `v*.*.*` 的 tag 或显式 dispatch 触发，并按以下顺序执行：

```text
build Preview / Unsigned installers + signed updater artifacts
        |
        v
minimum-OS Desktop + CLI smoke
        |
        v
protected updater acceptance
        |
        v
publish native npm packages -> publish CLI -> promote GitHub Release
```

任一平台构建、安装、启动、CLI 诊断或 updater 验证失败时，GitHub Release 保持 draft，npm publish 和正式 Release 均不得执行。

### 平台与 artifact

- macOS build runner 固定为 `macos-14`，构建目标只允许 `darwin-arm64`。
- Linux build runner 固定为 `ubuntu-22.04`，确保 native addon、Desktop 和 AppImage 以最低 glibc 基线构建。
- Windows build runner 使用 `windows-2022` x64 生成兼容 Windows 10 的 MSVC 产物；最低系统行为由 Windows 10 runner 验收。
- Desktop bundle 限制为 macOS `.dmg`、Windows NSIS `.exe` 与 `.msi`、Ubuntu `.deb` 与 `.AppImage`。
- 三平台不读取系统证书或执行系统签名命令，Release 标题统一包含 `Desktop: Preview / Unsigned`。
- 每个平台继续生成 updater artifact 和 `.sig`；归档与 `SHA256SUMS` 覆盖 npm 与 Desktop 文件。

### Clean VM Smoke

每个平台 smoke 都下载当前 run 产生的 artifact，不重新构建：

- CLI：在临时 prefix 安装主 tarball 和当前平台 native tarball，执行 `code-agent --help` 与 `code-agent doctor`。
- macOS 14：挂载 `.dmg`，检查 `LSMinimumSystemVersion`，启动 `.app` 并验证进程在限定时间内存活。
- Ubuntu 22.04：通过 `apt` 安装 `.deb`，在 `xvfb-run` 中启动 Desktop；AppImage 单独检查可执行权限和启动。
- Windows 10：静默安装 NSIS 包，启动应用并等待主进程存活后终止，再卸载并清理。

Windows runner 必须带 `self-hosted, Windows, X64, windows-10` 标签，并在每次 job 前恢复干净快照。没有匹配 runner 时发布保持等待，不允许用 `windows-2022` smoke 结果替代 Windows 10 验收。

### Interfaces And Responsibilities

- `.github/workflows/release.yml`：编排构建、updater 签名、smoke、npm 发布和 GitHub Release promotion。
- `apps/desktop/src-tauri/tauri.conf.json`：声明最低系统、bundle 范围、Updater endpoint 与公钥。
- `tools/release/*`：提供短小、可本地调用的平台 smoke 脚本。
- `tests/tauri-phase-9.test.ts`：锁定平台矩阵、三端无证书、最低系统 smoke、发布依赖顺序和文档声明。
- `README.md`、`README.zh-CN.md`：面向用户说明 Desktop 与 CLI 的支持范围、安装方式和系统安全提示。
- `docs/releasing.md`：面向维护者记录 updater 密钥、runner、smoke、失败恢复和发布顺序。

## Verification Strategy

- 使用 `tests/tauri-phase-9.test.ts` 验证 workflow 不引用平台证书、系统签名命令或验收工具，并继续上传 updater `.sig`。
- 运行 `pnpm check`、`pnpm run release:version:check`、`pnpm run package:check` 和 `pnpm run desktop:artifact:check`。
- tag workflow 在三个最低系统完成真实安装启动 smoke；本地静态验证不能替代该证据。

## Non-Goals

- 不支持 Intel macOS、Windows arm64、Linux arm64、musl Linux 或 Ubuntu 22.04 之前的系统。
- 不引入 Microsoft Store、Mac App Store、Snap、Flatpak、Homebrew 或 Linux repository。
- 不在当前阶段引入任何操作系统代码签名证书。
- 不关闭、绕过或弱化 Tauri updater 的独立签名验证。
- 不把 Windows Server 版本声明为用户支持目标。

## Success Criteria

- README、发布指南、Tauri 配置和 workflow 对三个支持目标使用同一平台与架构集合。
- 三平台 Desktop 均无操作系统证书依赖，并明确标记为 Preview / Unsigned。
- macOS 14 Apple Silicon、Windows 10 x64 与 Ubuntu 22.04 x64 均完成 CLI 和 Desktop clean VM smoke。
- npm publish 与 GitHub Release promotion 都依赖三平台 smoke 和 updater 人工验收成功。
- 失败 release 保持 draft，未验收产物不会进入 npm 或 updater 的公开 `latest`。
