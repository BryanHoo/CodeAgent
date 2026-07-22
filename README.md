# CodeAgent

CodeAgent 是一个通过 Web 操作本地 Coding Agent 的应用。本仓库当前只包含基础项目架构，不包含业务功能。

## 环境要求

- Node.js 24 或更高版本
- pnpm 11.15.1

## 开发命令

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test:e2e
```

`pnpm check` 依次执行格式、静态检查、架构依赖检查、单元测试、类型检查、构建和 npm 包内容校验。

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
