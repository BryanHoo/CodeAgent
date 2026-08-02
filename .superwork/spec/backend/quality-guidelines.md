# 后端质量规范

## 边界与安全

- Fastify 使用 JSON Schema 验证输入并序列化输出。
- 生产静态资源必须协商 Brotli 或 Gzip 响应压缩；`/assets/*` 内容哈希资源固定返回一年 `immutable` 公共缓存，HTML 与 SPA 回退入口保持 `max-age=0` 重新验证。
- Project 路径每次操作都执行绝对路径、`realpath` 和允许根目录包含关系校验。
- 默认只监听 `127.0.0.1`；WebSocket 校验 Origin，远程模式必须增加认证和 TLS 边界。
- Approval 同时校验用户、Runtime、Task、Turn、Request 身份与状态。

## 日志与错误

- 使用结构化字段记录请求和生命周期，不记录 Prompt 全文、完整命令输出、文件内容或 Secret。
- Fastify 创建时默认启用 JSON Pino，CLI 与 Provider 的默认日志级别固定为 `warn`；正常启动和正常请求不写终端日志，服务端 `5xx` 请求完成日志固定记录 `requestId`、method、route、statusCode 与 `durationMs`。所有日志脱敏 Authorization、Cookie、API Key 和 Set-Cookie 字段；测试可在创建阶段显式关闭 Logger，运行时不得从 Null Logger 切换。
- 实时事件链路必须提供可按 Project 读取的非负累计计数，至少覆盖 Provider 输入、合并、发布、保留淘汰、软背压和慢客户端断开；指标 Schema 拒绝额外字段和负数。
- 未知或字段映射失败的 Provider 事件记录结构化告警；只允许包含诊断代码、原生方法、固定 Provider 版本、Project ID 和可提取的 Task ID，不得记录原始参数正文。Approval、Error 和 Terminal State 不得丢弃。
- 错误在所属边界翻译，保留可诊断原因但不向 Web 暴露内部敏感数据。

## 测试

- JSONL 分帧测试覆盖多字节 UTF-8 字符跨 Buffer 边界；RPC 关联、服务端请求响应、超时、审批状态机和事件映射使用 Vitest 单元测试。
- Binary 定位测试必须确认包内路径落到当前平台的原生可执行文件；Windows 只接受 `.exe`，不得把 `.cmd`、`.bat` 或 JS launcher 当作受管 App Server 进程。
- 根 CLI 的系统集成测试必须覆盖 Windows UTF-8 目录、平台取消与真实失败的区分，以及 Linux 目录选择器和浏览器启动器的缺失回退；CI 质量门禁至少在 Ubuntu 与 Windows 上运行。
- Project 宿主打开测试必须覆盖 Windows Explorer 成功转交后不误报失败，以及 Windows Terminal 强制在目标目录打开独立新窗口。
- 子进程关闭测试覆盖发送 `SIGKILL` 后仍未退出的路径，并验证关闭 Promise 在截止时间内失败。
- Provider 集成使用 Fake App Server，不依赖真实账号完成默认 CI。
- Fastify 路由优先使用 `inject`；完整浏览器链路使用 Playwright。
- 附件上传路由测试必须覆盖 `multipart/form-data` 流式成功路径、旧 JSON 请求拒绝、按类型执行单文件限制，以及声明长度明显超限时在解析文件数据前返回 `413`。
- 静态资源 `inject` 测试必须覆盖 Brotli/Gzip 解压后的正文、哈希资源长期缓存头和 SPA HTML 重新验证头。
- Event Stream 单元测试使用 fake timers 覆盖普通与软背压合并窗口、完整 Delta key 隔离、关键事件冲刷、环形覆盖、连续 Sequence 和窗口外 resync；WebSocket 路由测试验证合并后帧数与指标响应。
- 发布包校验必须从构建产物打开并关闭 `SqliteStateRepository`，真实启动 Worker 以验证 `import.meta.url` 相对路径和文件清单一致。
