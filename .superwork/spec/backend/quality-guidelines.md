# 后端质量规范

## 边界与安全

- 默认启动只能监听 Loopback；LAN 监听必须由显式 `--lan` 启用，并使用可信局域网配对认证。该模式是明文 HTTP，禁止描述为加密或安全远程访问。
- LAN 模式的匿名范围只能是静态 SPA、`GET /v1/health`、`GET /v1/access` 和 `POST /v1/access/pair`；其余 `/v1/*` 和 WebSocket Upgrade 必须由根级 Hook 认证。Cookie 写请求与所有 WebSocket 必须严格校验 `Origin` 和 `Host` 同源。
- 配对码至少 128 bit 熵，Session ID 至少 256 bit；二者不得进入 URL、环境变量、日志或持久层。Session 与按 IP 配对失败窗口必须有界，关闭时清空；失败每分钟最多 5 次且响应不得泄漏匹配细节。
- LAN Cookie 使用 `HttpOnly; SameSite=Strict; Path=/` 和固定绝对 `Max-Age`，明文 HTTP 不设置 `Secure`。所有 `/v1/*` 使用 `no-store`，应用响应设置 CSP、Frame、MIME、Referrer 与 Permissions 安全头，不为 HTTP 设置 HSTS。
- Fastify 使用 JSON Schema 验证输入并序列化输出。
- 生产静态资源必须协商 Brotli 或 Gzip 响应压缩；`/assets/*` 内容哈希资源固定返回一年 `immutable` 公共缓存，HTML 与 SPA 回退入口保持 `max-age=0` 重新验证。
- Project 相对路径每次操作都执行绝对路径、`realpath` 和允许根目录包含关系校验；AI 回复中的显式绝对文件引用允许访问 Project 外目标，但必须通过认证并校验 `realpath`、可读性、目标类型和预览上限。
- 默认只监听 `127.0.0.1`；WebSocket 校验 Origin，远程模式必须增加认证和 TLS 边界。
- Approval 同时校验用户、Runtime、Task、Turn、Request 身份与状态。

## 日志与错误

- 使用结构化字段记录请求和生命周期，不记录 Prompt 全文、完整命令输出、文件内容或 Secret。
- Fastify 创建时默认启用 JSON Pino，CLI 与 Provider 的默认日志级别固定为 `warn`；正常启动和正常请求不写终端日志，服务端 `5xx` 请求完成日志固定记录 `requestId`、method、route、statusCode 与 `durationMs`。所有日志脱敏 Authorization、Cookie、API Key 和 Set-Cookie 字段；测试可在创建阶段显式关闭 Logger，运行时不得从 Null Logger 切换。
- CLI 用户提示统一使用中文 `信息`、`成功`、`警告`、`错误` 标签，并分别使用青、绿、黄、红色；仅在交互式终端且未设置 `NO_COLOR` 时输出 ANSI 颜色，重定向输出不得包含控制符。警告和错误写入 stderr，普通信息和成功状态写入 stdout。
- 实时事件链路必须提供可按 Project 读取的非负累计计数，至少覆盖 Provider 输入、合并、发布、保留淘汰、软背压和慢客户端断开；指标 Schema 拒绝额外字段和负数。
- 未知或字段映射失败的 Provider 事件记录结构化告警；只允许包含诊断代码、原生方法、固定 Provider 版本、Project ID 和可提取的 Task ID，不得记录原始参数正文。Approval、Error 和 Terminal State 不得丢弃。
- 错误在所属边界翻译，保留可诊断原因但不向 Web 暴露内部敏感数据。

## 测试

- JSONL 分帧测试覆盖多字节 UTF-8 字符跨 Buffer 边界；RPC 关联、服务端请求响应、超时、审批状态机和事件映射使用 Vitest 单元测试。
- Codex App Server 协议必须使用锁定的 `@openai/codex` 和 `--experimental` 生成 TypeScript 与 JSON Schema，并由 `pnpm run codex:schema:check` 比较版本化规范基线；依赖升级必须显式更新基线并同步 Adapter 契约测试。
- Binary 定位测试必须确认包内路径落到当前平台的原生可执行文件；Windows 只接受 `.exe`，不得把 `.cmd`、`.bat` 或 JS launcher 当作受管 App Server 进程。
- Server 目录浏览测试必须覆盖 POSIX 路径规范化、Windows UTF-8 绝对路径契约、非目录与相对路径拒绝、符号链接省略和稳定排序；根 CLI 系统集成测试继续覆盖浏览器启动器的缺失回退。CI 质量门禁至少在 Ubuntu 与 Windows 上运行。
- 根 CLI 参数测试必须覆盖 `pnpm run start -- ...` 转发的单个 `--` 分隔符；只忽略命令后的首个分隔符，后续未知或重复选项仍必须拒绝。
- Project 宿主打开测试必须覆盖 Windows Explorer 成功转交后不误报失败，以及 Windows Terminal 强制在目标目录打开独立新窗口。
- 子进程关闭测试覆盖发送 `SIGKILL` 后仍未退出的路径，并验证关闭 Promise 在截止时间内失败。
- Provider 集成使用 Fake App Server，不依赖真实账号完成默认 CI。
- Fastify 路由优先使用 `inject`；完整浏览器链路使用 Playwright。
- 附件上传路由测试必须覆盖 `multipart/form-data` 流式成功路径、旧 JSON 请求拒绝、按类型执行单文件限制，以及声明长度明显超限时在解析文件数据前返回 `413`。
- 静态资源 `inject` 测试必须覆盖 Brotli/Gzip 解压后的正文、哈希资源长期缓存头和 SPA HTML 重新验证头。
- Event Stream 单元测试使用 fake timers 覆盖普通与软背压合并窗口、完整 Delta key 隔离、关键事件冲刷、环形覆盖、连续 Sequence 和窗口外 resync；WebSocket 路由测试验证合并后帧数与指标响应。
- `pnpm test:performance` 必须使用固定离线负载覆盖高频 Delta 合并、慢 WebSocket 软/硬背压、50 MiB 流式附件、数百 Git 变更和重复 Event Stream 生命周期 Heap；规模与阈值只维护在 `tests/performance-budgets.json`，压力文件不得混入普通 `pnpm test`。
- 发布包校验必须从构建产物打开并关闭 `SqliteStateRepository`，真实启动 Worker 以验证 `import.meta.url` 相对路径和文件清单一致。
