# Codex 0.153.4 运行时契约

## 版本与分发

- 应用私有 Codex 运行时固定为 `0.153.4`，全局安装提示使用 `npm install -g @openai/codex@0.153.4`
- 外部运行时仅接受精确版本 `0.153.4`；拒绝其他 patch、预发行版和构建元数据版本
- 私有下载仅使用 npm 官方的 Darwin arm64、Linux arm64/x64、Windows arm64/x64 五个平台包，并对完整内容校验官方 SHA-512 integrity
- 项目启用了 `experimentalApi`，未经源码和契约验证不得扩大兼容版本范围
- CI 使用 `codex-cli 0.153.4` 生成带 `--experimental` 的 JSON Schema bundle，并与已提交快照执行字节级差异检查

## 线程协议

- 每个 `thread/start`、`thread/resume`、`thread/fork` 请求必须在 `config` 中传入 `tools.update_plan.enabled: true`
- 只使用请求级覆盖，不得改写用户全局 `config.toml`
- `thread/resume` 不传 `cwd`，由 Codex 从已保存线程恢复工作目录；恢复响应新增字段必须保持可解析
- Project 任务列表必须使用 `thread/list` 的 `recency_at` 倒序；Codex 在 `TurnStarted` 时单调推进该字段，确保用户再次发送消息后任务回到左栏首位
- `project/list` 接受项目的 `recencyAt` 字段，但不得请求 `recencyAt` 排序，产品顺序继续由 `position` 决定

## Provider 配置

- Codex `config.toml` 只写入标准 Provider 字段：内置 OpenAI 覆盖使用 `openai_base_url`，自定义 Provider 使用 `model_provider` 与 `model_providers.<id>`
- CodeAgent 自有的模型目录不得写入 `desktop.codeagent.provider`；应原子保存到应用数据目录，并按 `providerId` 与 `baseUrl` 精确匹配，防止跨端点复用模型
- 重新连接未提交模型列表时复用当前端点的本地目录；旧 `desktop.codeagent.provider.customModels` 仅允许作为一次性迁移来源，成功保存后清理整个旧配置段

## 新增通知与请求

- `agentMessage.questions` 通过官方 `text` 展示完整问题与选项，沿用普通消息回复；异步提问的 `item/completed` 不得结束 Turn 或进入阻塞审批队列，暂不提供结构化选项控件
- `Thread.model` 与 `Thread.reasoningEffort` 接受空值和实际值；它们是线程配置元数据，不是逐回合遥测。任务设置仍由应用私有配置管理，不为读取这些字段额外 resume 或轮询线程
- `plugin/reconcile`、App 按账户审批配置及运行中 `approvalsReviewer` 更新暂不新增产品入口；使用官方运行时现有行为，不在事件热路径主动同步插件
- `ResponseUsageMetadata.metadata` 不进入 WebView；上下文占用继续使用 `thread/tokenUsage/updated` 的有界摘要
- `modelProvider/authRecoveryStarted` 和 `modelProvider/authRecoveryCompleted` 必须校验 `threadId`、`turnId`、`provider`、`message` 后显式消费；当前不投影到 UI
- MCP elicitation 的 `openaiForm` 与旧 `openai/form` 均映射为 `unsupported`，不得按标准 `form` 渲染或提交
- 不启用 `omit_app_server_notification_media`，生成图片链路仍依赖通知中的媒体数据落盘

## 验证要求

- 覆盖精确版本门禁、五个平台 URL 与 SHA-512、安装命令和前端恢复提示
- 覆盖所有线程创建路径、恢复与 Fork 的计划工具配置，并断言恢复请求不携带 `cwd`
- 覆盖 Project 任务 `recency_at` 排序、项目 `recencyAt` 兼容、认证恢复通知结构和 `openaiForm` 降级
- 覆盖 Provider 重连、端点隔离、旧模型目录迁移及 `desktop.codeagent.provider` 清理
- 使用本机 `codex-cli 0.153.4` 运行真实 App Server 生命周期冒烟，并运行 `pnpm check`
- 运行 `pnpm codex:protocol:check` 验证实验协议 schema 未发生漂移
- 覆盖异步问题在历史与实时 Item 中的文本完整性，以及空值/非空线程模型元数据的轻量任务投影
