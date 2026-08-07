# 发布 CodeAgent

本文面向仓库维护者，说明如何通过版本标签自动发布 npm 包和 GitHub Release。仓库只发布根包 `@bryanhu/code-agent`，内部 Workspace 包保持私有。

## 发布前配置

在 npm 的 `@bryanhu/code-agent > Settings > Trusted Publisher` 中配置 GitHub Actions Publisher：

| 配置项               | 值            |
| -------------------- | ------------- |
| Organization or user | `BryanHoo`    |
| Repository           | `CodeAgent`   |
| Workflow filename    | `release.yml` |
| Environment name     | `npm`         |
| Allowed actions      | `npm publish` |

GitHub 仓库必须存在名为 `npm` 的 Environment。发布工作流通过 OIDC 获取短期凭证并生成 npm provenance，不使用长期 npm Token；禁止在仓库、Environment、`.npmrc` 或工作流中保存发布 Token。

## 发布版本

1. 更新 `package.json` 中的版本号。
2. 将版本变化从 `CHANGELOG.md` 的 `Unreleased` 移到对应版本标题，并填写发布日期。
3. 运行完整校验：

```bash
pnpm check
pnpm test:e2e
```

`package:check` 会检查真实 tarball 的 `package.json`。工作流先使用 `pnpm pack` 将 `catalog:` 和 `workspace:` 转换为 npm 可安装版本，再通过 `npm publish <tarball>` 完成 Trusted Publisher OIDC 认证与发布。

4. 提交发布准备，并用实际版本号创建匹配的标签：

```bash
RELEASE_VERSION=x.y.z
git tag -a "v${RELEASE_VERSION}" -m "发布 v${RELEASE_VERSION}"
git push origin main
git push origin "v${RELEASE_VERSION}"
```

`.github/workflows/release.yml` 会依次执行以下操作：

1. 校验 `v<version>` 标签与 `package.json` 中的版本一致。
2. 安装锁定依赖并运行 `pnpm check`。
3. 使用 pnpm 生成协议已转换的 tarball，并通过 npm CLI 发布带 provenance 的公开 npm 包。
4. 根据提交记录创建 GitHub Release。

已推送标签的发布失败时，可从 GitHub Actions 手动运行 `Release` workflow，并将 `tag` 设置为现有发布标签。工作流会精确检出并校验该标签，不会从 `main` 直接发布未标记提交。

GitHub Release 只会在 npm 发布成功后创建，避免 npm 失败时产生已完成发布的错误信号。

## 处理失败

- 版本校验失败：确认标签对应版本尚未发布，再修正 `package.json` 或错误标签；不得复用已经发布的 npm 版本。
- `ENEEDAUTH`：检查 npm Publisher 的仓库、`release.yml`、`npm` Environment 是否完全匹配，并确认工作流具有 `id-token: write`。
- npm 发布成功但 GitHub Release 创建失败：不要修改版本；重新运行失败 Job，工作流会跳过已经存在的 npm 版本并继续创建 GitHub Release。
- npm 拒绝重复版本：提升 `package.json` 版本并重新更新 `CHANGELOG.md`，然后创建新标签。
- `EUNSUPPORTEDPROTOCOL`：确认工作流使用 `pnpm pack` 生成发布 tarball，并检查 `package:check` 已验证 tarball 内没有 `catalog:` 或 `workspace:`。
- OIDC token exchange 失败：确认 Trusted Publisher 的仓库、`release.yml`、`npm` Environment 和 `npm publish` 权限完全匹配；发布 tarball 必须由 npm CLI 执行。

发布记录以 [npm 的 @bryanhu/code-agent 页面](https://www.npmjs.com/package/@bryanhu/code-agent)和 [GitHub Releases](https://github.com/BryanHoo/CodeAgent/releases) 为准。
