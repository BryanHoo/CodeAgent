# CodeAgent 工程指南

## Scope

适用于根发布包、`apps/web` 和所有 `packages/*` 的持久工程约束。

## Naming

- 产品展示名称统一使用 `CodeAgent`。
- 根 npm 包和唯一 CLI 命令统一使用 `code-agent`，不提供额外兼容别名。
- 内部私有 Workspace 包统一使用 `@code-agent/*` 作用域。

## Pre-Development Checklist

- 读取 `.superwork/config.json` 和相关层的 `index.md`。
- 读取 `docs/architecture-design.md` 与 `docs/project-structure.md` 中相关章节。
- 用 `rg` 搜索已有入口、类型与实现，确认改动所属包。
- 检查 `dependency-cruiser.config.cjs`，避免反向依赖或跨包深层导入。

## Verification Checklist

- 所有改动运行 `pnpm check`。
- 涉及浏览器装配或用户流程时运行 `pnpm test:e2e`。
- 涉及发布结构时确认 `pnpm run package:check` 通过。
- `.agents/**` 属于代理技能资产，不进入产品 Prettier 与 ESLint 门禁；相关改动使用技能自身校验。
- 长时间命令使用非交互模式和明确超时。

## Update Triggers

- 新增或调整跨包依赖规则。
- 协议、Provider 能力或运行时生命周期形成稳定约束。
- 验证命令、构建产物或发布清单发生变化。
