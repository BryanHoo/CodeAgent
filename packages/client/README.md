# `@code-agent/client`

维护宿主无关的 `CodeAgentClient` facade、领域 operation、结构化错误、Protocol Schema 校验、request ID 与显式取消协调。

HTTP/WebSocket 实现位于 `@code-agent/transport-http`，Tauri IPC 实现位于 `@code-agent/transport-tauri`。该包只依赖 Protocol，不得导入任一 Transport、Server、Core 或具体 Provider 实现。
