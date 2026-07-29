# 后端目录结构

## 包职责

- `src/cli.ts`：唯一公开 CLI 入口，只负责命令解析、配置装配和进程退出码。
- `packages/server`：Fastify 插件、HTTP/WebSocket、持久化适配和 Database Worker。
- `packages/provider-codex`：Codex Binary 定位、App Server 子进程、JSONL/RPC 和事件映射。
- `packages/core`：Provider 接口、领域状态机和用例；不得导入 Fastify、SQLite 或 Codex 实现。
- `packages/protocol`：Provider 无关的 Schema、类型和 API 版本。

## 规则

- Fastify 路由只做 Schema 校验、身份与 Project 校验、用例调用和响应映射。
- Project Git 状态只通过固定的只读端点暴露，不接受浏览器传入的命令或文件路径；优先读取已配置 Project 根目录并同时返回当前分支和去重的本地/远端基础分支候选，远端默认分支可解析时必须排在首位。根目录不是 Git 仓库时仅聚合其直属子目录中的 Git 仓库，以子目录名作为变更路径前缀，并返回空分支上下文。
- Core、Protocol 和 Server 公开使用 Project/Task；Codex 原生 Thread 命名只允许出现在 `provider-codex` 适配边界。
- 基础设施通过 Core 端口接入，不让同步 SQLite 或子进程细节进入领域层。
- 每个包只从 `src/index.ts` 暴露公共入口。
- 不提供任意 JSON-RPC、文件系统或命令执行透传接口。
