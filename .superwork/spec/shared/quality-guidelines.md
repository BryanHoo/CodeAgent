# 共享契约质量规范

## Purpose

确保统一协议和领域边界可验证、可版本化且不泄漏 Provider 实现。

## Rules

- Project、Task 等 Protocol 类型必须有对应 JSON Schema 或明确生成来源，运行时边界不得只依赖 TypeScript 类型。
- `Project.rootPath` 由本地 Runtime 校验后随 Project 契约返回，用于当前工作台展示，并由 `ProjectSchema` 校验为非空字符串。
- Agent Event 保持版本字段、单调 `sequence` 和可判别事件类型。
- Provider 只发布不含 `sessionId`、`sequence`、`timestamp` 和 `version` 的统一事件；Server Event Stream 统一分配这些传输字段。
- Project 级 Provider 只发布已通过 Project 归属验证的 Task 事件，未知或其他目录的 `threadId` 不得进入 Event Stream。
- Task Snapshot HTTP 响应必须同时返回同一 Event Stream 的 `{ sessionId, sequence }` checkpoint，Client 不得猜测恢复序号。
- WebSocket 控制帧使用 `connection.ready` 和 `resync.required`；恢复原因只使用 Protocol 定义的判别值。
- Provider 专有数据只进入诊断字段或 `extensions`，未知事件记录告警但不破坏事件循环。
- Task Snapshot 必须保留归一化的 Turn 与 Tool 错误；Command Output 最多保留最新 `10,000` 行或 `1 MiB`，并携带截断状态。
- Project 源文件预览必须返回 Project 相对路径、文本内容和截断状态；Server 必须解析真实路径并拒绝越界路径、越界符号链接、目录和二进制文件，单次预览最多读取 `256 KiB`、最多返回 `4,000` 行。
- Agent 写入必须由 Protocol 提供结构化 `AgentPromptInput`、Task/Turn Mutation 请求响应、能力和错误 Schema；Client 与 Server 都必须执行运行时校验。
- 模型目录使用统一 `AgentModelPage` 并保留每个模型的默认与可用思考量；图片上传返回不含 Data URL 和本地路径的 `AgentAttachment`，Turn 只接收附件 ID、`AgentApprovalPolicy`、非空模型 ID 和该模型支持的思考量。
- Task Snapshot 使用 `contextUsage` 保存最近一轮上下文用量，实时链路使用 `usage.updated` 同步更新；占用值必须来自 Provider 的最近一轮 Token Usage 与模型上下文窗口。
- 运行能力至少独立声明 Task 的 `list`、`read`、`start` 与 Turn 的 `start`、`interrupt`，消费者不得通过 Provider 名称推断能力。
- `POST /v1/projects/:projectId/tasks`、`POST /v1/tasks/:taskId/turns` 和 `POST /v1/turns/:turnId/interrupt` 必须携带 `Idempotency-Key`，并使用统一错误码表达缺失 Key、冲突、资源不存在和 Provider 失败。
- Pending Request 使用 `command_approval`、`file_change_approval`、`user_input` 判别联合；命令审批将受管网络目标归一化为可空的 `networkAccess`，保留 Host 与协议；Snapshot 只返回未解决请求，实时链路使用 `pending_request.created`、`pending_request.resolved`、`pending_request.expired` 同步生命周期。
- Pending Request 生命周期事件必须分别携带 `pending`、`resolved`、`expired` 状态；固定选项问题至少提供一个选项，无选项 Choice 只有在允许自定义回答时才合法。
- `POST /v1/pending-requests/:requestId/resolve` 必须携带 `Idempotency-Key`，并校验 `projectId + taskId + turnId + itemId + requestId`、请求类型、可用决策、User Input 单值与固定选项和当前状态。
- 变更按新协议逻辑实现并删除冗余旧路径；破坏性变更明确升级 API 或事件版本。
- 更新所有消费者、契约测试和架构文档后运行 `pnpm check`。
