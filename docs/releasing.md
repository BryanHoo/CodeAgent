# 发布 CodeAgent

本文面向仓库维护者，说明 npm 与带签名 Updater 的 Desktop 制品发布流程。Desktop 更新检查和下载统一使用 GitHub Releases。

## 发布目标

根 `package.json` 是产品版本源且保持 `private: true`。公开 npm 包位于 `apps/node-cli`：

- `@bryanhu/code-agent`：CLI、Web 静态资源、Server Delivery 和 native loader。
- `@bryanhu/code-agent-darwin-arm64`：macOS Apple Silicon addon。
- `@bryanhu/code-agent-darwin-x64`：macOS Intel addon。
- `@bryanhu/code-agent-linux-x64-gnu`：Linux x64 glibc addon。
- `@bryanhu/code-agent-win32-x64-msvc`：Windows x64 MSVC addon。

主包用精确版本 `optionalDependencies` 选择当前平台包，不包含本地 `.node`、安装脚本或 `node-gyp` fallback。Windows/Linux arm64 在目标环境完成验证前不发布。

## 发布前配置

在 npm 的每个公开包中配置相同的 GitHub Actions Trusted Publisher：

| 配置项               | 值            |
| -------------------- | ------------- |
| Organization or user | `BryanHoo`    |
| Repository           | `CodeAgent`   |
| Workflow filename    | `release.yml` |
| Environment name     | `npm`         |
| Allowed actions      | `npm publish` |

GitHub 必须存在 `npm` Environment。工作流使用 OIDC 和 npm provenance，不保存长期 npm Token。

在 GitHub Repository Actions Secrets 中配置：

| Secret                               | 用途                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Tauri updater 私钥完整内容，只用于 CI 生成更新包签名。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；当前私钥无密码时可不配置。                   |

公钥已提交到 `apps/desktop/src-tauri/tauri.conf.json`。私钥不得提交到仓库、Artifact 或日志；当前生成文件位于 `/Users/bryanhu/.tauri/code-agent-updater.key`，必须另行存入受控密码库并保留离线备份。丢失私钥后，已安装版本将无法验证后续更新。

Updater 签名只验证更新包来源，不替代 macOS Developer ID/notarization 或 Windows Authenticode。公开正式 Release 前仍需配置并验证对应系统签名材料。

本地执行 `pnpm build:desktop` 时，构建脚本优先使用当前环境的 `TAURI_SIGNING_PRIVATE_KEY`；未设置时自动使用 `~/.tauri/code-agent-updater.key`。无密码私钥会显式传递空的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，无需在本地 shell 重复配置。GitHub Actions Secret 只在工作流内生效，不会同步到本地环境。

## 准备版本

1. 同时更新根 `package.json`、`apps/node-cli/package.json` 和四个平台 `package.json` 的版本。
2. 更新 `CHANGELOG.md`，将 `Unreleased` 内容移入对应版本并填写日期。
3. 确认 updater 私钥已进入 GitHub Secrets，并运行版本与完整门禁：

```bash
pnpm check:ci
pnpm check:rust
pnpm test:e2e
pnpm --filter @code-agent/desktop build
pnpm run desktop:artifact:check
```

4. 提交发布准备并创建同版本标签：

```bash
RELEASE_VERSION=x.y.z
git tag -a "v${RELEASE_VERSION}" -m "发布 v${RELEASE_VERSION}"
git push origin main
git push origin "v${RELEASE_VERSION}"
```

## 自动流程

`.github/workflows/release.yml` 在四个原生 runner 上并行执行以下步骤：

1. 校验 tag、根版本、CLI、native packages、Cargo workspace 和 Tauri 版本一致。
2. 通过固定 SHA 的 `tauri-action` 在四个原生 runner 上各构建一次 Desktop bundle，使用 `TAURI_SIGNING_PRIVATE_KEY` 生成 updater artifact 和 `.sig`。
3. 将各平台安装包、updater artifact、签名和合并后的 `latest.json` 上传到同一个 draft GitHub Release。
4. 生成名称带版本与 target 的 npm tarball 和 Desktop 归档，汇总后生成 `SHA256SUMS`。
5. 先发布四个 native packages，再发布主 CLI 包，最后向已有 draft Release 补充 Desktop 归档和校验和。

Desktop 固定从 `https://github.com/BryanHoo/CodeAgent/releases/latest/download/latest.json` 检查更新。`latest.json` 中包含平台下载 URL 和 `.sig` 内容；`tauri-plugin-updater` 下载后使用内置公钥验证签名，验证成功才安装并重启应用。

GitHub 的 `/releases/latest/` 不返回 draft。发布 draft 前必须在各目标平台完成安装、启动、篡改签名拒绝和上一正式版本升级 smoke；通过后再将 Release 改为公开正式版本，客户端才会发现该更新。

## 处理失败

- 版本检查失败：修正所有 manifest；不得靠工作流动态改写版本。
- 某个平台构建失败：修复后重跑同一 tag；不得用其他平台 binary 代替。
- native packages 只发布了一部分：保持现有版本和相同构建输入，重跑工作流补齐缺失包。npm 发布不可原子回滚。
- native packages 已齐全但主包失败：重跑工作流；已存在 native 版本会跳过，主包继续发布。
- 主包已发布但平台包缺失：立即补发同版本缺失平台包；无法补齐时弃用主包版本并发布新版本。
- GitHub Release 创建失败：不修改制品，重跑 publish Job；工作流会复用已发布 npm 版本。
- updater 签名失败：确认 `TAURI_SIGNING_PRIVATE_KEY` 内容完整且与仓库公钥匹配；不得生成或替换新密钥后直接发布。
- `latest.json` 缺少平台：保持 Release 为 draft，重跑缺失平台的 build Job；四个平台齐全前不得公开。
- updater 安装拒绝签名：下载对应 Release artifact 和 `.sig` 复验构建输入，禁止关闭签名验证或改用 HTTP endpoint。
- `EUNSUPPORTEDPROTOCOL`：确认发布的是 `pnpm pack` 产生的 tarball，并运行 `pnpm run package:check`。

发布记录以 [npm 的 @bryanhu/code-agent 页面](https://www.npmjs.com/package/@bryanhu/code-agent)和 [GitHub Releases](https://github.com/BryanHoo/CodeAgent/releases) 为准。
