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

版本发布、npm Trusted Publisher 和标签规则见 [docs/releasing.md](docs/releasing.md)。

## 变更约束

- 遵守 [.superwork/spec/guides/index.md](.superwork/spec/guides/index.md) 及相关分层规范中的依赖方向。
- 只在实际使用依赖的 Workspace 包中声明依赖。
- 公共协议变更必须同步更新 Schema、契约测试和版本说明。
- 不提交构建产物、覆盖率报告、本地配置或 Secret。

## 文档维护

- `README.md` 与 `README.zh-CN.md` 面向用户，功能、命令和限制必须同步。
- 本文件维护贡献流程，`docs/releasing.md` 只维护当前发布流程。
- `.superwork/spec/**` 维护当前工程约束；带日期的 PRD 与计划保留当时的设计和执行记录，不作为当前实现的唯一依据。
- 优先链接已有事实来源，不在多个文档中复制实现细节、版本号或完整检查清单。

## Commit Message

使用 Conventional Commits，格式为：

```text
<type>(<scope>): <subject>
```

`scope` 必填，`subject` 使用简体中文祈使句，首行不超过 72 个字符。
