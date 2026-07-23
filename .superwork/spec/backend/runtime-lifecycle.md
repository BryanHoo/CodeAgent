# 运行时生命周期

## Codex App Server

- 默认使用长驻 `codex app-server --listen stdio:// --strict-config`，不为每个 Turn 创建进程。
- 包内 Codex 必须解析平台可选依赖中的原生 `codex`/`codex.exe`，不得把会再次派生子进程的 JS launcher 作为受管 App Server 进程。
- 使用参数数组、`shell: false` 和经过控制的环境变量；Secret 不进入参数或日志。
- 所有 RPC 设置超时；子进程退出时统一 Reject Pending RPC，并清理 Listener。
- JSONL 字节流必须跨 Buffer 分片保留 UTF-8 解码状态，不得逐块独立转码。
- JSONL 中同时包含 `id` 与 `method` 的合法帧按服务端请求分发，并使用原 `id` 返回结果；不得将审批请求误判为协议损坏。
- 过载错误使用带 jitter 的有上限指数退避，不做同步密集重试。

## Server 与持久化

- Fastify 资源通过插件封装，并在 `onClose` 中释放。
- 同步 SQLite 写入放入专用 Worker，主事件循环不执行持久化批处理。
- WebSocket 客户端使用独立有界队列，慢客户端不能阻塞 Provider。

## 关闭

- `SIGINT` 与 `SIGTERM` 进入同一幂等关闭路径。
- 停止接收请求、完成写入、处理活动 Turn、关闭子进程、数据库和 HTTP Server。
- 每一步都有明确超时；发送 `SIGKILL` 后仍执行有界等待，超时返回可诊断错误，不无限等待。
