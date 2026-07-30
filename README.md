# CodeAgent

CodeAgent 是一个通过 Web 操作本地 Coding Agent 的应用。`code-agent start` 会启动 Codex App Server、本地 HTTP API 和静态 Web 工作台。

## 安装与启动

直接运行最新版本：

```bash
npx code-agent@latest start
```

也可以全局安装：

```bash
npm install --global code-agent
code-agent start
```

运行前需要：

- Node.js 24 或更高版本
- 已使用官方 Codex CLI 在相同 `CODEX_HOME` 中完成 `codex login`

CodeAgent 不提供登录、退出或凭证管理，也不会读取或修改 `auth.json`。Runtime 不可用时，请先在官方 Codex CLI 完成登录，再回到 Web 工作台重试。

## 本地开发

开发环境使用 pnpm 11.15.1：

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test:e2e
```

`pnpm check` 依次执行格式、静态检查、架构依赖检查、单元测试、类型检查、构建和 npm 包内容校验。

## CLI 命令

```bash
code-agent start
code-agent doctor
code-agent version
```

`start` 支持 `--codex-bin` 和 `--codex-home`。启动后浏览器会打开 `http://127.0.0.1:3210`。首次启动项目列表为空，通过 Projects 标题右侧的 `+` 使用系统目录选择器添加文件夹；Project、Project 新 Task 默认模型设置和 Task 完整设置写入 `CODEX_HOME/code-agent/state.sqlite3`。收到 `SIGINT` 或 `SIGTERM` 后会依次关闭 HTTP Server、数据库 Worker 和全局长驻 Codex App Server。

`doctor` 会检查数据库可写性、Migration 版本、`PRAGMA integrity_check`、WAL 和运行所需的 SQLite PRAGMA。

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

架构决策见 [docs/architecture-design.md](docs/architecture-design.md)，工程约束见 [docs/project-structure.md](docs/project-structure.md)，维护者发布步骤见 [docs/releasing.md](docs/releasing.md)。版本变化记录在 [CHANGELOG.md](CHANGELOG.md)。
