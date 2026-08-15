# `@code-agent/server`

维护 Fastify 应用装配、HTTP/WebSocket 交付和静态资源生命周期。

路由只负责输入输出适配，所有领域、Provider、SQLite、Git、文件与附件操作均通过具名 `CodeAgentEngine` port 进入 Rust Runtime。WebSocket 直接转发 native bridge 生成的序列化 frame，避免重复序列化。
