# CodeAgent

CodeAgent 是一个通过 Web 操作本地 Coding Agent 的应用。`code-agent start` 会启动
Codex App Server、本地 HTTP API 和静态 Web 工作台。

## 环境要求

- Node.js 24 或更高版本
- pnpm 11.15.1
- 已使用官方 Codex CLI 在相同 `CODEX_HOME` 中完成 `codex login`

CodeAgent 不提供登录、退出或凭证管理，也不会读取或修改 `auth.json`。Runtime 不可用时，
请先在官方 Codex CLI 完成登录，再回到 Web 工作台重试。

## 开发命令

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test:e2e
```

`pnpm check` 依次执行格式、静态检查、架构依赖检查、单元测试、类型检查、构建和 npm 包内容校验。

## CLI 命令

```bash
code-agent start --project /path/to/project
code-agent doctor
code-agent version
```

`start` 支持 `--codex-bin`、`--codex-home` 和 `--project`。启动后浏览器会打开
`http://127.0.0.1:3210`，展示指定 Project 的真实 Codex Task 列表与结构化历史；收到
`SIGINT` 或 `SIGTERM` 后会依次关闭 HTTP Server 和长驻 Codex App Server。

在 Composer 起始位置输入 `/`，可执行代码审查、初始化、副任务、上下文压缩、反馈和在新任务中继续。代码审查、压缩、反馈与续接直接调用 Codex App Server 对应能力；初始化和副任务通过正常 Turn 提交。

## 仓库结构

```text
apps/web/                 React + Vite 浏览器应用
packages/protocol/        统一协议、Schema 和 API 描述
packages/core/            领域模型、用例和 Provider 端口
packages/provider-codex/  Codex App Server 适配器
packages/server/          Fastify、WebSocket、持久化和 Worker
packages/client/          Web 使用的 HTTP/WebSocket 客户端
src/cli.ts                唯一公开 npm 包的 CLI 入口
tools/                    构建与发布校验脚本
```

内部 Workspace 包均为 `private: true`。发布产物只来自根包的 `dist/`，用户只安装 `code-agent`。

架构决策见 [docs/architecture-design.md](docs/architecture-design.md)，工程约束见 [docs/project-structure.md](docs/project-structure.md)。
