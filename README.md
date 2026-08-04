# CodeAgent

CodeAgent 是一个通过 Web 操作本地 Coding Agent 的应用。`code-agent start` 会启动 Codex App Server、本地 HTTP API 和静态 Web 工作台。

## 安装与启动

直接运行最新版本：

```bash
npx --package @bryanhu/code-agent@latest code-agent start
```

也可以全局安装：

```bash
npm install --global @bryanhu/code-agent
code-agent start
```

运行前需要：

- Node.js 24 或更高版本
- 已使用官方 Codex CLI 在相同 `CODEX_HOME` 中完成 `codex login`

CodeAgent 不提供登录、退出或凭证管理，也不会读取或修改 `auth.json`。Runtime 不可用时，请先在官方 Codex CLI 完成登录，再回到 Web 工作台重试。

支持 Windows 10/11 和主流 Linux 桌面发行版的 x64、arm64 环境。Linux 目录选择依次尝试 `zenity`、`kdialog`；无桌面会话时可在终端输入绝对路径。系统浏览器或外部应用启动失败时，CLI 会输出本地访问地址供手动打开。

Web 工作台支持 Chrome/Chromium 116+、Firefox 124+ 和 Safari 17.4+。生产构建按这些最低版本转译语法，但不为 `AbortSignal.timeout()`、`AbortSignal.any()`、`toSorted()` 或 `toSpliced()` 注入运行时 polyfill；更早版本不在支持范围内。

## 本地开发

开发环境使用 pnpm 11.15.1：

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test:e2e
```

`pnpm check` 依次执行格式、静态检查、架构依赖检查、单元测试、类型检查、构建和 npm 包内容校验。

需要从源码启动 LAN 模式时，使用 pnpm 的参数分隔符传递 CLI 选项：

```bash
pnpm run start -- --lan --session-ttl 12h
```

## CLI 命令

```bash
code-agent start
code-agent doctor
code-agent version
```

`start` 支持 `--codex-bin` 和 `--codex-home`。默认只监听 `127.0.0.1:3210`，启动后浏览器会打开 `http://127.0.0.1:3210`。首次启动项目列表为空，通过 Projects 标题右侧的 `+` 使用系统目录选择器添加文件夹；Project、Project 新 Task 默认模型设置和 Task 完整设置写入 `CODEX_HOME/code-agent/state.sqlite3`。收到 `SIGINT` 或 `SIGTERM` 后会依次关闭 HTTP Server、数据库 Worker 和全局长驻 Codex App Server。

可信局域网内可显式运行 `code-agent start --lan [--session-ttl <duration>]`。LAN 模式监听 `0.0.0.0:3210`，终端显示可访问 IPv4 URL 和本次启动的配对码；配对码不会进入 URL 或持久化存储。Session 默认绝对有效 `24h` 且请求不会续期，可设置 `1m` 至 `30d` 的整数分钟、小时或天数，例如 `30m`、`12h`、`7d`。该模式使用明文 HTTP，只适用于可信局域网，不提供传输加密或互联网暴露保护；进程重启后配对码和全部 Session 立即失效。

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

内部 Workspace 包均为 `private: true`。发布产物只来自根包的 `dist/`，用户只安装 `@bryanhu/code-agent`。

架构决策见 [docs/architecture-design.md](docs/architecture-design.md)，工程约束见 [docs/project-structure.md](docs/project-structure.md)，维护者发布步骤见 [docs/releasing.md](docs/releasing.md)。版本变化记录在 [CHANGELOG.md](CHANGELOG.md)。
