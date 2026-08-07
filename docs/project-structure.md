# 项目结构与工程约束

> 状态：Accepted  
> 更新日期：2026-08-06

## 1. 目标

本基础架构定义模块边界、构建链路、质量门禁和发布约束；具体能力必须遵循这些依赖方向实现。

## 2. 依赖方向

```text
protocol <- core <- provider-codex <- server <- root CLI
    ^          ^            ^
    |          |            |
    +------- client ------ web
```

准确规则如下：

| 模块             | 允许依赖的内部模块                   |
| ---------------- | ------------------------------------ |
| `protocol`       | 无                                   |
| `core`           | `protocol`                           |
| `provider-codex` | `core`、`protocol`                   |
| `server`         | `core`、`protocol`、`provider-codex` |
| `client`         | `protocol`                           |
| `web`            | `client`、`protocol`                 |

`dependency-cruiser.config.cjs` 将这些约束作为 CI 错误执行，并同时检查循环依赖。跨包代码只能通过包根入口导入，禁止直接引用另一个包的内部目录。

## 3. TypeScript

- 根 `tsconfig.json` 是 solution-style 配置，只维护 Project References。
- `tsconfig.base.json` 统一启用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax` 和 `noUncheckedSideEffectImports`。
- Node 模块采用 `NodeNext`；Vite 浏览器模块采用 `Bundler`。
- 每个 Workspace 包独立拥有 `tsconfig.json`，避免编辑器和 CI 将整个仓库视为一个无边界工程。

## 4. 包管理与发布

- `pnpm-workspace.yaml` 的 Catalog 集中锁定共享版本。
- 内部依赖必须使用 `workspace:*`，外部共享依赖必须使用 `catalog:`。
- 根 `package.json` 固定 `packageManager`，CI 使用 `pnpm install --frozen-lockfile`。
- 内部包全部私有且不会发布；根包通过 `tsup` 汇总 Node 产物，通过 Vite 输出 `dist/web`。
- `tools/verify-package.mjs` 使用 `pnpm pack --dry-run --json` 校验发布包至少包含 CLI、Server 和 Web 入口，并拒绝发布任何 `.map` 源码映射。
- 发布工作流由 `v*.*.*` 标签触发，校验标签与根包版本一致后发布 npm 包并创建 GitHub Release。
- 首个版本使用 GitHub `npm` Environment 中的一次性 Token 初始化包；后续版本使用 npm Trusted Publisher、OIDC 和 provenance，不保留长期 npm Token。

## 5. 质量门禁

`pnpm check` 是本地与 CI 的统一入口，包含：

1. Prettier 格式检查。
2. ESLint 严格类型检查。
3. 依赖方向和循环依赖检查。
4. Vitest 单元测试。
5. TypeScript Project References 类型检查。
6. Node 与 Web 生产构建。
7. Codex App Server TypeScript 与 JSON Schema 漂移校验。
8. npm 发布内容校验。

Playwright 独立执行浏览器装配冒烟测试，后续业务 E2E 不与单元测试混跑。

Codex Schema 基线按锁定版本保存在 `schemas/codex-app-server/<version>.schema-baseline.json`。`pnpm run codex:schema:check` 使用当前 `@openai/codex` 和 `--experimental` 重新生成两类协议产物并比较路径与内容摘要；升级 Codex 时必须运行 `pnpm run codex:schema:update`，审查基线差异并同步 Adapter 契约测试。

## 6. 配置来源

- Codex App Server 使用官方推荐的 `stdio` JSONL 传输；不把实验 WebSocket 作为 Provider 主链路：[Codex App Server](https://learn.chatgpt.com/docs/app-server#protocol)。
- pnpm Workspace 使用 Catalog 和 `workspace:` 协议集中依赖版本与内部包解析：[pnpm Workspaces](https://pnpm.io/workspaces)、[pnpm Catalogs](https://pnpm.io/catalogs)。
- TypeScript 使用严格配置和 solution-style Project References：[Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)、[TSConfig](https://www.typescriptlang.org/tsconfig/)。
- Fastify 后续按封装插件、JSON Schema、生命周期钩子和 `inject` 测试组织：[Fastify Plugins](https://fastify.dev/docs/latest/Reference/Plugins/)、[Fastify Testing](https://fastify.dev/docs/latest/Guides/Testing/)。
- 版本发布保持单一公开包，避免内部模块形成额外公共兼容面；社区发布流程参考 [Changesets](https://github.com/changesets/changesets)，但当前根包发布模型不引入多包版本工具。

## 7. 后续实现原则

- 新功能先选择所属模块，再添加依赖；禁止为方便而反向依赖交付层。
- 新依赖只添加到实际使用它的包；数据库 Driver 只属于 `server` Adapter，Web 和 Core 不得直接依赖。
- Provider 专有字段留在 Adapter，不泄漏到 Web；统一能力通过 Protocol 和 Core 表达。
- Project 与 Agent 设置的 Repository 端口定义在 Core；`better-sqlite3` 的所有同步调用只在独立数据库 Worker 中执行。
- App Server RPC、子进程、数据库和 WebSocket 都必须拥有明确生命周期与超时。
- 业务代码到来后再提高覆盖率阈值，避免空架构使用虚假测试制造通过率。

## 8. 临时 Task 边界

- `protocol` 只声明稳定的 temporary scope 与公开 API 前缀；`client` 根据 scope 选择 `/v1/temporary`，不得拼出隐藏 Project 路由。
- `server` 将公开 temporary 白名单映射到固定内部 Project，完整保留普通 Task 的审批、Sandbox、Skill、MCP 与后台终端能力；Git、文件、Project defaults、目录打开和其他 Project Mutation 不得进入该边界。
- `root CLI` 负责安全创建 `${CODEX_HOME}/code-agent/temporary-workspace`；`server` 的 SQLite Worker 负责幂等维护 `kind = temporary` 记录并从用户 Project 查询和 Mutation 中隔离。
- `web` 复用 Task Runtime 和 Query Cache，但不把 temporary scope 加入 `projects`；路由、侧栏分组和工作台能力必须显式识别该 scope。
