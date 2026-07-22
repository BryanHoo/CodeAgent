# `@code-agent-window/server`

维护 Fastify 应用装配、HTTP/WebSocket 交付、持久化适配和 Worker 生命周期。

路由只负责输入输出适配，领域规则必须留在 Core；浏览器不得直接访问 Provider。
