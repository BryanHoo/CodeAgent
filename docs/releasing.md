# 发布 npm 与 Desktop

本文面向仓库维护者，说明 npm 与 Desktop 制品的发布流程。三个系统的 Desktop 安装包当前统一以 Preview / Unsigned 发布；Desktop updater 制品继续使用独立密钥签名，并通过 GitHub Releases 分发。

## 发布范围

一个版本发布以下 npm 包：

- `@bryanhu/code-agent`：CLI 主包。
- `@bryanhu/code-agent-darwin-arm64`：macOS Apple Silicon addon。
- `@bryanhu/code-agent-linux-x64-gnu`：Linux x64 glibc addon。
- `@bryanhu/code-agent-win32-x64-msvc`：Windows x64 MSVC addon。

主包用精确版本 `optionalDependencies` 选择当前平台包，不包含本地 `.node`、安装脚本或 `node-gyp` fallback。Desktop 与 CLI 只支持 macOS 14+ Apple Silicon、Windows 10+ x64 和 Ubuntu 22.04+ x64 glibc；不发布 Intel macOS、Windows/Linux arm64 或 musl artifact。

每个平台的 Desktop 制品如下：

| 目标             | Desktop 制品                         | 系统签名状态       |
| ---------------- | ------------------------------------ | ------------------ |
| `darwin-arm64`   | `.dmg`、updater artifact、`.sig`     | Preview / Unsigned |
| `linux-x64-gnu`  | `.deb`、`.AppImage`                  | Preview / Unsigned |
| `win32-x64-msvc` | NSIS `.exe`、updater、`.sig`（SemVer prerelease 仅发布 NSIS，不含 `.msi`） | Preview / Unsigned |

## 发布前配置

GitHub 必须存在 `npm` Environment。工作流使用 OIDC 和 npm provenance，不保存长期 npm Token。另建受保护的 `release` Environment 并配置 Required reviewers；审批人只有在 macOS/Linux 最低系统 smoke 和自动 updater 验收全部通过后才能放行。

Windows Desktop 在 `windows-2022` hosted runner 上构建；`2.0.0-beta.1` 首发不将 Windows 10 x64 自托管 runner 安装 smoke 作为发布门禁。后续稳定版可恢复 `tools/release/register-windows-runner.ps1` 注册的 `self-hosted, Windows, X64, windows-10` runner 验收。

Repository Actions Secrets 只需要 updater 密钥：

| Secret                               | 用途                                             |
| ------------------------------------ | ------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Tauri updater 私钥完整内容，用于生成更新包签名。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；当前私钥无密码时可不配置。             |

公钥已提交到 `apps/desktop/src-tauri/tauri.conf.json`。私钥不得提交到仓库、Artifact 或日志；本地 updater 私钥固定使用 `~/.tauri/code-agent-updater.key`，必须另行存入受控密码库并保留离线备份。丢失私钥后，已安装版本将无法验证后续更新。

三个系统都不配置操作系统代码签名证书、签名命令或证书验收门禁。GitHub Release 标题必须包含 `Desktop: Preview / Unsigned`。操作系统可能阻止或警告用户运行安装包，用户步骤统一维护在 README 的 Desktop 章节。

Updater 签名只验证更新包来源，不等同于操作系统代码签名。需要继续设置 `TAURI_SIGNING_PRIVATE_KEY`，让 updater artifact 和 `.sig` 由内置公钥验证；不得为了发布无证书安装包而关闭 updater 验证。

本地执行 `pnpm build:desktop` 时，构建脚本优先使用当前环境的 `TAURI_SIGNING_PRIVATE_KEY`；未设置时自动使用 `~/.tauri/code-agent-updater.key`。无密码私钥会显式传递空的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，无需在本地 shell 重复配置。GitHub Actions Secret 只在工作流内生效，不会同步到本地环境。

## 发布步骤

1. 在 `main` 上更新版本、`CHANGELOG.md` 和文档，确保工作区干净。
2. 确认 updater 密钥已进入 GitHub Secrets，`release` Environment 已配置。
3. 运行版本与完整门禁：

   ```bash
   pnpm run release:version:check
   pnpm check:ci
   pnpm test:e2e
   ```

4. 创建并推送与根版本完全一致的 tag：

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

也可以从 Actions 手动运行 `Release` workflow，但 `tag` 必须是已存在且与根版本一致的 `vX.Y.Z`。

## Workflow 行为

`.github/workflows/release.yml` 按以下顺序执行：

1. 校验 tag 与根版本一致，构建并检查 npm artifacts。
2. 通过固定 SHA 的 `tauri-action` 分别构建 DMG、DEB/AppImage 和 MSI/NSIS；三端都不读取操作系统证书，统一生成 Preview / Unsigned 安装包。
3. 使用 `TAURI_SIGNING_PRIVATE_KEY` 生成 updater artifact 和 `.sig`，将安装包、更新器 metadata 与签名上传到同一个 draft GitHub Release。
4. 在 macOS 14 Apple Silicon 与 Ubuntu 22.04 x64 clean runner 安装 CLI 与 Desktop，执行 CLI doctor 和有界启动 smoke。macOS 额外检查 `LSMinimumSystemVersion` 为 `14.0`。Windows 安装包在 `windows-2022` 构建，首发 Beta 不在 Windows 10 自托管 runner 上执行安装 smoke。
5. 自动验证 `latest.json` 三平台覆盖、内置公钥合法签名，以及 artifact/signature 篡改均被拒绝。
6. 等待 `release` Environment 审批，按 native packages 在前、CLI 主包在后的顺序发布 npm。SemVer prerelease 只进入 npm `beta`，不得移动 `latest`，随后执行：

   ```bash
   gh release edit "${RELEASE_TAG}" --draft=false
   ```

GitHub 的 `/releases/latest/` 不返回 draft 或 prerelease。因为 Desktop 当前固定使用该 endpoint，`2.0.0-beta.1` 的 GitHub Release 在完成验收后保持 `prerelease=false`，Beta 身份由 SemVer、标题和 npm `beta` channel 表达。自动最低系统 smoke 与 updater 验收完成前，npm publish 和 Release promotion 都不会执行。

## Updater 验证边界

Desktop 固定从 `https://github.com/BryanHoo/CodeAgent/releases/latest/download/latest.json` 检查更新。`latest.json` 中包含平台下载 URL 和 `.sig` 内容；`tauri-plugin-updater` 下载后使用内置公钥验证签名，验证成功才安装并重启应用。

`v2.0.0-beta.1` 是首个公开 Desktop updater 基线，没有可用于原位升级的上一 Desktop Release，因此本次执行 `bootstrap` 验收：

- macOS、Windows 和 Linux 的目标版本、URL 与签名均存在于 `latest.json`。
- 仓库内置公钥可验证每个平台的合法 updater artifact。
- 任意修改 updater artifact 或 `.sig` 后，签名验证会被拒绝。
- 三个平台的实际安装与有界启动由最低系统 smoke 负责。

从下一个 Desktop 版本开始，除上述自动校验外，还必须在 clean runner 从上一公开版本执行原位升级、重启并确认目标版本；不得把首发 `bootstrap` 结果复用为后续升级证据。

## 处理失败

- 版本检查失败：修正所有 manifest；不得靠工作流动态改写版本。
- 某个平台构建失败：修复后重跑同一 tag；不得用其他平台 binary 代替。
- native packages 只发布了一部分：保持现有版本和相同构建输入，重跑工作流补齐缺失包。npm 发布不可原子回滚。
- native packages 已齐全但主包失败：重跑工作流；已存在 native 版本会跳过，主包继续发布。
- 主包已发布但平台包缺失：立即补发同版本缺失平台包；无法补齐时弃用主包版本并发布新版本。
- GitHub Release 创建失败：不修改制品，重跑 publish Job；工作流会复用已发布 npm 版本。
- macOS Preview 安装被系统阻止：确认 DMG 来自当前 GitHub Release，再按 README 的“隐私与安全性 > 仍要打开”步骤复验；不得将此结果误报为系统签名通过。
- Windows Preview 安装被 SmartScreen 拦截：确认安装包来自当前 GitHub Release，再按 README 的“更多信息 > 仍要运行”步骤复验；受组织策略管理的 runner 必须先调整发布验收策略。
- Linux 安装失败：在 Ubuntu 22.04 clean runner 分别复验 `.deb` 依赖安装和 `.AppImage` 执行权限，不得用更高版本发行版替代最低系统验收。
- Windows 10 自托管 runner 不在线：首发 Beta 不依赖该门禁；后续恢复 runner 后可重新启用 `smoke-windows-10` job。
- `release` Environment 验收失败：拒绝审批并保持 draft，修复后使用同 tag 重新构建和验收；不得先发布 npm。
- GitHub Release promotion 失败：npm 包保持原版本，Release 保持 draft；确认同 tag Release 唯一存在后重跑 publish Job。
- updater 签名失败：确认 `TAURI_SIGNING_PRIVATE_KEY` 内容完整且与仓库公钥匹配；不得生成或替换新密钥后直接发布。
- `latest.json` 缺少平台：保持 Release 为 draft，重跑缺失平台的 build Job；三个支持平台齐全前不得公开。
- updater 安装拒绝签名：下载对应 Release artifact 和 `.sig` 复验构建输入，禁止关闭签名验证或改用 HTTP endpoint。
- `EUNSUPPORTEDPROTOCOL`：确认发布的是 `pnpm pack` 产生的 tarball，并运行 `pnpm run package:check`。

发布记录以 [npm 的 @bryanhu/code-agent 页面](https://www.npmjs.com/package/@bryanhu/code-agent)和 [GitHub Releases](https://github.com/BryanHoo/CodeAgent/releases) 为准。
