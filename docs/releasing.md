# 发布 CodeAgent

本文面向仓库维护者，说明如何通过版本标签自动发布 npm 包和 GitHub Release。仓库只发布根包 `code-agent`，内部 Workspace 包保持私有。

## 发布前配置

### 首次发布

npm Trusted Publisher 需要先进入一个已存在包的 Settings 页面配置，因此 `0.0.1` 使用一次性 npm Token 完成初始化。

1. 在 npm 创建允许发布公开包并可绕过发布 2FA 的 Granular Access Token。
2. 在 GitHub 仓库的 `Settings > Environments` 中创建 `npm` Environment。
3. 在该 Environment 中添加名为 `NPM_TOKEN` 的 Secret。
4. 确认 npm 账号已启用发布所需的双重认证策略。

Token 只用于首个版本，禁止写入仓库、`.npmrc` 或工作流文件。

### 后续发布

`0.0.1` 发布成功后，在 npm 的 `code-agent > Settings > Trusted Publisher` 中添加 GitHub Actions Publisher：

| 配置项               | 值            |
| -------------------- | ------------- |
| Organization or user | `BryanHoo`    |
| Repository           | `CodeAgent`   |
| Workflow filename    | `release.yml` |
| Environment name     | `npm`         |
| Allowed actions      | `npm publish` |

保存后删除 GitHub `npm` Environment 中的 `NPM_TOKEN`。后续工作流通过 OIDC 获取短期凭证，并自动生成 npm provenance。

## 发布版本

1. 更新 `package.json` 中的版本号。
2. 将版本变化从 `CHANGELOG.md` 的 `Unreleased` 移到对应版本标题，并填写发布日期。
3. 运行完整校验：

```bash
pnpm check
pnpm test:e2e
```

4. 提交发布准备并创建与包版本一致的标签：

```bash
git tag -a v0.0.1 -m "发布 v0.0.1"
git push origin main
git push origin v0.0.1
```

`.github/workflows/release.yml` 会依次执行以下操作：

1. 校验标签 `v0.0.1` 与 `package.json` 的 `0.0.1` 一致。
2. 安装锁定依赖并运行 `pnpm check`。
3. 发布带 provenance 的公开 npm 包。
4. 根据提交记录创建 GitHub Release。

GitHub Release 只会在 npm 发布成功后创建，避免 npm 失败时产生已完成发布的错误信号。

## 处理失败

- 版本校验失败：删除错误的远端标签，修正版本后创建新标签。不得复用已经发布的 npm 版本。
- `ENEEDAUTH`：检查 npm Publisher 的仓库、`release.yml`、`npm` Environment 是否完全匹配，并确认工作流具有 `id-token: write`。
- npm 发布成功但 GitHub Release 创建失败：不要修改版本；重新运行失败 Job，工作流会跳过已经存在的 npm 版本并继续创建 GitHub Release。
- npm 拒绝重复版本：提升 `package.json` 版本并重新更新 `CHANGELOG.md`，然后创建新标签。

发布记录以 [npm 的 code-agent 页面](https://www.npmjs.com/package/code-agent)和 [GitHub Releases](https://github.com/BryanHoo/CodeAgent/releases) 为准。
