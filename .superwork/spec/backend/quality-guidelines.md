# 后端质量规范

## 边界与安全

- Fastify 使用 JSON Schema 验证输入并序列化输出。
- Project 路径每次操作都执行绝对路径、`realpath` 和允许根目录包含关系校验。
- 默认只监听 `127.0.0.1`；WebSocket 校验 Origin，远程模式必须增加认证和 TLS 边界。
- Approval 同时校验用户、Runtime、Task、Turn、Request 身份与状态。

## 日志与错误

- 使用结构化字段记录请求和生命周期，不记录 Prompt 全文、完整命令输出、文件内容或 Secret。
- 未知 Provider 事件记录告警；Approval、Error 和 Terminal State 不得丢弃。
- 错误在所属边界翻译，保留可诊断原因但不向 Web 暴露内部敏感数据。

## 测试

- JSONL 分帧测试覆盖多字节 UTF-8 字符跨 Buffer 边界；RPC 关联、服务端请求响应、超时、审批状态机和事件映射使用 Vitest 单元测试。
- Binary 定位测试必须确认包内路径落到当前平台的原生可执行文件，避免 Windows 启动失败或关闭时遗留 launcher 子进程。
- 子进程关闭测试覆盖发送 `SIGKILL` 后仍未退出的路径，并验证关闭 Promise 在截止时间内失败。
- Provider 集成使用 Fake App Server，不依赖真实账号完成默认 CI。
- Fastify 路由优先使用 `inject`；完整浏览器链路使用 Playwright。
