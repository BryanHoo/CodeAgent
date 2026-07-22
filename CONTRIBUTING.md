# 贡献指南

## 开发环境

```bash
pnpm install --frozen-lockfile
pnpm check
```

提交前必须保证 `pnpm check` 通过。涉及浏览器装配时另行执行：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## 变更约束

- 遵守 [docs/project-structure.md](docs/project-structure.md) 中的依赖方向。
- 只在实际使用依赖的 Workspace 包中声明依赖。
- 公共协议变更必须同步更新 Schema、契约测试和版本说明。
- 不提交构建产物、覆盖率报告、本地配置或 Secret。

## Commit Message

使用 Conventional Commits，格式为：

```text
<type>(<scope>): <subject>
```

`scope` 必填，`subject` 使用简体中文祈使句，首行不超过 72 个字符。
