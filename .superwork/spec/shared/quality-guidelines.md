# 共享契约质量规范

## Purpose

确保统一协议和领域边界可验证、可版本化且不泄漏 Provider 实现。

## Rules

- Project、Task 等 Protocol 类型必须有对应 JSON Schema 或明确生成来源，运行时边界不得只依赖 TypeScript 类型。
- 代码审查请求使用携带严格 `AgentReviewTarget` 的 `AgentReviewItem` 进入 Snapshot 和实时事件，禁止用普通用户消息或 Provider 原生 Prompt 表达审查模式。
- `Project.rootPath` 由本地 Runtime 校验后随 Project 契约返回，用于当前工作台展示，并由 `ProjectSchema` 校验为非空字符串。
- Project 重命名只允许更新本地 `projects.name` 展示名，必须保持 `id`、`rootPath`、`createdAt` 和磁盘目录不变；Project 删除只移除 CodeAgent 注册及级联的本地设置/元数据，并释放对应 Web/Server Runtime，不得删除磁盘文件或归档 Provider Task。两种操作均使用独立严格 Mutation Schema 和 `Idempotency-Key`。
- `ProjectGitStatus` 必须同时返回可空的当前 `branch`、无重复的 `baseBranches`、`staged` 和 `unstaged`；Client 与 Fastify 响应边界必须使用同一严格 Schema 校验，Web 不得硬编码分支名称。
- `ProjectFileTree` 必须返回目标 Project 相对目录 `path` 及其直接目录/文件条目，不包含 `truncated` 或条目数量上限；可选目录查询必须拒绝绝对路径、点路径、反斜杠和额外字段。Server 必须沿已注册 Project 根目录逐层应用任意层级的 `.gitignore`，不依赖根目录是否为 Git 仓库或是否存在根级规则；同时跳过符号链接、`.git`、`node_modules`、构建与覆盖率目录，并将目录深度限制为 `20` 层，Client 与 Fastify 必须使用同一严格 Schema。
- Project 排序使用携带 `Idempotency-Key` 的 `PUT /v1/projects/order`，请求必须包含无重复的完整 Project ID 集合；Server 校验集合后在 SQLite 事务中原子替换顺序，新注册 Project 追加到末尾。
- Agent Event 保持版本字段、单调 `sequence` 和可判别事件类型。
- `EventStreamMetricsResponse` 使用版本化严格 Schema，按 Project 只返回非负累计计数和当前活动量；字段覆盖 Provider 输入、合并、发布、pending Delta、保留淘汰、软背压、活动客户端与慢客户端断开，不得携带 Prompt、命令输出、文件内容或额外字段。
- Provider 只发布不含 `sessionId`、`sequence`、`timestamp` 和 `version` 的统一事件；Server Event Stream 统一分配这些传输字段。结构化 Item 的开始与完成分别使用 `item.started` 和 `item.completed`，并携带同一统一 Item 载荷供客户端按 ID 替换。
- Project 级 Provider 只发布已通过 Project 归属验证的 Task 事件，未知或其他目录的 `threadId` 不得进入 Event Stream。
- Task Snapshot HTTP 响应必须同时返回同一 Event Stream 的 `{ sessionId, sequence }` checkpoint，Client 不得猜测恢复序号。
- WebSocket 控制帧使用 `connection.ready` 和 `resync.required`；恢复原因只使用 Protocol 定义的判别值。
- Provider 专有数据只进入诊断字段或 `extensions`，未知事件记录告警但不破坏事件循环。
- Task Snapshot 必须保留归一化的 Turn 与 Tool 错误；Command Output 最多保留最新 `10,000` 行或 `1 MiB`，并携带截断状态。
- Project 源文件预览必须返回 Project 相对路径、文本内容和截断状态；Server 必须解析真实路径并拒绝越界路径、越界符号链接、目录和二进制文件，单次预览最多读取 `256 KiB`、最多返回 `4,000` 行。
- Agent 写入必须由 Protocol 提供结构化 `AgentPromptInput`、Task/Turn Mutation 请求响应、能力和错误 Schema；Client 与 Server 都必须执行运行时校验。
- Task 固定、重命名和归档必须使用独立的严格 Mutation Schema 并携带 `Idempotency-Key`；Server 校验 `projectId + taskId` 归属后，固定写本地元数据，重命名和归档调用 Provider 端口。
- 模型目录使用统一 `AgentModelPage` 并保留每个模型的默认与可用思考量；图片上传返回不含 Data URL 和本地路径的 `AgentAttachment`，Turn 只接收附件 ID、`AgentApprovalPolicy`、`AgentApprovalsReviewer`、`AgentSandboxMode`、非空模型 ID 和该模型支持的思考量。历史消息的 `AgentMessageAttachment` 同样只包含随机 ID、媒体类型、名称和字节数；同一未变图片在重复 Task Snapshot 中必须保持当前附件 ID 稳定，避免仍在渲染的受控 URL 因快照重读返回 404。二进制固定通过 `GET /v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId` 按需读取，Server 必须验证 Project/Task 归属并禁止 MIME sniffing。
- Skill 目录使用 Project 作用域的统一 `AgentSkillPage`，只向 Web 暴露不透明 ID、名称、描述和作用域；`AgentPromptInput.skills` 接收按编辑器 Token 顺序排列的多个不透明 ID 与名称，Provider 必须逐项解析为 Codex 原生 Skill 输入，禁止暴露或接收 Codex Skill 绝对路径。
- `AgentTaskSettings` 必须是审批策略、审批审核方、模型、思考量和沙盒模式的严格完整对象，Task Snapshot 直接返回 Server 校验后的有效设置；Project defaults 包含模型、思考量和沙盒模式。完整设置更新使用原子 `PUT`，Client 必须对所有设置响应执行 Protocol Schema 校验。
- Provider 模型目录和 Codex Project 有效沙盒配置分别是初始模型能力与沙盒默认值的真相源，持久层只保存统一设置值；新 Task 继承 Project 模型、思考量和沙盒默认值，审批固定初始化为 `approvalPolicy: "on-request"` 与 `approvalsReviewer: "user"`，会话级授权和 Pending Request 不得进入长期设置。
- Task Snapshot 使用 `contextUsage` 保存最近一轮上下文用量，实时链路使用 `usage.updated` 同步更新；占用值必须来自 Provider 的最近一轮 Token Usage 与模型上下文窗口。
- 运行能力独立声明 Task 的 `list`、`read`、`start`、`fork`，Turn 的 `start`、`interrupt`、`rollback`、`review`、`compact`，Skill 的 `list`、`use`，以及 Feedback 的 `upload`；消费者不得通过 Provider 名称推断能力。
- `POST /v1/projects/:projectId/tasks`、`POST /v1/projects/:projectId/tasks/:taskId/turns` 和 Project 作用域内的 Turn Mutation 必须携带 `Idempotency-Key`，并使用统一错误码表达缺失 Key、冲突、资源不存在和 Provider 失败。
- Pending Request 使用 `command_approval`、`file_change_approval`、`user_input` 判别联合；命令审批将受管网络目标归一化为可空的 `networkAccess`，保留 Host 与协议；Snapshot 只返回未解决请求，实时链路使用 `pending_request.created`、`pending_request.resolved`、`pending_request.expired` 同步生命周期。
- Pending Request 生命周期事件必须分别携带 `pending`、`resolved`、`expired` 状态；固定选项问题至少提供一个选项，无选项 Choice 只有在允许自定义回答时才合法。
- `POST /v1/projects/:projectId/tasks/:taskId/pending-requests/:requestId/resolve` 必须携带 `Idempotency-Key`，并校验 `projectId + taskId + turnId + itemId + requestId`、请求类型、可用决策、User Input 单值与固定选项和当前状态。
- 读取剪贴板的 Playwright 用例必须在 Browser Context 显式声明 `clipboard-read` 和 `clipboard-write` 权限，不得依赖开发机或 CI Runner 的默认授权。
- 变更按新协议逻辑实现并删除冗余旧路径；破坏性变更明确升级 API 或事件版本。
- 更新所有消费者、契约测试和架构文档后运行 `pnpm check`。
