# 发布 CodeAgent

本文面向仓库维护者，说明 Phase 8 的 npm 与未签名 Desktop 制品发布流程。签名、notarization、Updater 和公开正式 Release 属于 Phase 9。

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

## 准备版本

1. 同时更新根 `package.json`、`apps/node-cli/package.json` 和四个平台 `package.json` 的版本。
2. 更新 `CHANGELOG.md`，将 `Unreleased` 内容移入对应版本并填写日期。
3. 运行版本与完整门禁：

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
2. 构建并测试当前平台 addon、主 CLI 和未签名 Desktop bundle。
3. 生成名称带版本与 target 的 npm tarball 和 Desktop 归档。
4. 汇总并检查四个 native tarball、一个主 tarball 和四个 Desktop 归档，生成 `SHA256SUMS`。
5. 先发布四个 native packages，再发布主 CLI 包。
6. 创建包含 Desktop 归档与 checksum 的 draft GitHub Release。

Phase 9 完成签名、安装 smoke 和 Updater 验证后，才能公开 draft Release。

## 处理失败

- 版本检查失败：修正所有 manifest；不得靠工作流动态改写版本。
- 某个平台构建失败：修复后重跑同一 tag；不得用其他平台 binary 代替。
- native packages 只发布了一部分：保持现有版本和相同构建输入，重跑工作流补齐缺失包。npm 发布不可原子回滚。
- native packages 已齐全但主包失败：重跑工作流；已存在 native 版本会跳过，主包继续发布。
- 主包已发布但平台包缺失：立即补发同版本缺失平台包；无法补齐时弃用主包版本并发布新版本。
- GitHub Release 创建失败：不修改制品，重跑 publish Job；工作流会复用已发布 npm 版本。
- `EUNSUPPORTEDPROTOCOL`：确认发布的是 `pnpm pack` 产生的 tarball，并运行 `pnpm run package:check`。

发布记录以 [npm 的 @bryanhu/code-agent 页面](https://www.npmjs.com/package/@bryanhu/code-agent)和 [GitHub Releases](https://github.com/BryanHoo/CodeAgent/releases) 为准。
