# 运行时生命周期

## Codex App Server

- 默认使用长驻 `codex app-server --listen stdio://`，不为每个 Turn 创建进程；允许 Codex 忽略其版本尚未识别的前向配置字段，避免 Desktop 与打包 CLI 的配置版本差异阻断启动。
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
- 每次 Runtime 创建唯一 Event Stream Session，由 Server 分配单调 `sequence` 并维护固定容量缓存；Provider 不分配传输序号。
- `/v1/events` 首帧发送 `connection.ready`，只补发 `afterSequence` 之后仍在缓存窗口内的事件；过期或超前序号发送 `resync.required`。
- Provider `readTask` Promise 完成前必须让返回 Snapshot 包含此前状态并同步交付对应通知；Task Snapshot 读取完成后再从当前 Event Stream 固定 checkpoint，避免丢失事件或重复补发已有内容。
- `resync.required` 发送后由 Server 主动关闭当前 WebSocket；客户端必须使用新 Snapshot checkpoint 建立新连接。
- Fastify 关闭时取消 Provider Event 订阅并关闭 WebSocket 资源。

## 关闭

- `SIGINT` 与 `SIGTERM` 进入同一幂等关闭路径。
- 停止接收请求、完成写入、处理活动 Turn、关闭子进程、数据库和 HTTP Server。
- 每一步都有明确超时；发送 `SIGKILL` 后仍执行有界等待，超时返回可诊断错误，不无限等待。
