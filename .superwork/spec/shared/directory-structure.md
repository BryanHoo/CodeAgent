# 共享包目录与依赖方向

## Purpose

内部包位于 `packages/*`，只通过各包 `src/index.ts` 暴露稳定入口。

## Rules

- `protocol` 不依赖其他内部包，维护统一类型、Schema 和 API 描述。
- `core` 只依赖 `protocol`，维护领域模型、用例和 Provider 端口。
- `provider-codex` 只依赖 `core` 与 `protocol`，维护 Codex 进程和协议适配。
- `server` 可以依赖 `core`、`protocol`、`provider-codex`，负责交付与基础设施装配。
- `client` 只依赖 `protocol`，维护宿主无关 facade、operation 契约、Schema 校验、结构化错误与取消协调，不得导入 HTTP、WebSocket 或 Tauri API。
- `transport-http` 依赖 `client` 与 `protocol`，维护 Web/LAN 的 HTTP route、附件 URL 和 WebSocket 事件交付。
- `transport-tauri` 依赖 `client` 与 Tauri API，维护 Desktop IPC 交付；两个 Transport 不得互相依赖。
- `web` 通过 `apps/web/src/app/create-host-client.ts` 唯一 Composition Root 依赖 `client` 与一个构建期 Transport alias，Feature 和组件不得直接导入 Transport。
- 新依赖添加到实际使用它的包；跨包导入必须使用包名，不得引用 `../other-package/src/*`。
