# 共享契约质量规范

## Purpose

确保统一协议和领域边界可验证、可版本化且不泄漏 Provider 实现。

## Rules

- 网络 Access 契约必须独立于 Codex 账号和 Provider 类型，使用严格版本化 Schema 定义 `local | lan` 状态、配对、注销及 `ACCESS_DENIED`、`PAIRING_FAILED`、`PAIRING_RATE_LIMITED` 错误。Protocol、Client、Server 与 Web 消费者必须同步更新。
- Client 所有 Fetch 必须显式使用 `credentials: "same-origin"`；配对码只能进入 `POST /v1/access/pair` JSON Body。`401` 通知不得吞掉或改写原 HTTP 或 Mutation 错误。
- Project、Task 等 Protocol 类型必须有对应 JSON Schema 或明确生成来源，运行时边界不得只依赖 TypeScript 类型。
- 用户临时 Task 使用固定 Protocol scope 和 `/v1/temporary/**` 公共路径；Client、Server 与 Web 不得暴露内部 Project ID、名称或 `${CODEX_HOME}/code-agent/temporary-workspace`。其 Codex Thread 必须持久化并完整遵循普通 `AgentTaskSettings`，审批、Skill、MCP 与后台终端不得被临时作用域额外限制；Sandbox 固定为 `danger-full-access`，Web 不显示选择器，Server 必须覆盖其他输入值。直接 `/v1/projects/temporary/**` 访问及 Project 文件、Git、目录打开、Project defaults 和其他 Project Mutation 必须被拒绝或不发起。
- 应用信息和更新必须使用严格 `AppInfoResponse`、`InstallAppUpdateRequest` 与 `InstallAppUpdateResponse` Schema；Client 必须校验 CodeAgent/Codex/current/latest/status 字段。更新请求只接受目标 SemVer 并携带 `Idempotency-Key`，Server 必须区分无可用更新、检查失败与安装失败，Web 不得根据版本字符串自行执行包管理命令。
- 代码审查请求使用携带严格 `AgentReviewTarget` 的 `AgentReviewItem` 进入 Snapshot 和实时事件，禁止用普通用户消息或 Provider 原生 Prompt 表达审查模式。
- Codex `review/start` 必须通过 `thread/started.thread.parentThreadId` 将独立 reviewer 子 Thread 关联到父 Task，并将外层审查 Turn 与 worker Turn 投影成同一个用户可见 Turn：只保留一个结构化审查请求，隐藏 worker 的重复 Prompt，按原顺序保留 worker 的 commentary、工具和最终回复；仅在 worker 已交付最终回复时抑制外层重复结果。worker 终态只清理其待处理请求，外层 `exitedReviewMode` 与 `turn/completed` 才结束审查运行态和处理计时；历史 Snapshot 必须读取 `subAgentReview` 子 Thread，并与实时事件生成相同投影。
- `Project.rootPath` 由本地 Runtime 校验后随 Project 契约返回，用于当前工作台展示，并由 `ProjectSchema` 校验为非空字符串。
- Project 目录浏览必须使用严格的 `ProjectDirectoryQuery` 与 `ProjectDirectoryListing` Schema，返回规范化的当前绝对路径、可空父路径和直接子目录；路径契约必须覆盖 POSIX、Windows Drive 与 UNC 绝对路径，并拒绝 NUL 和换行控制字符。Project 注册只接受显式 `AddProjectRequest.rootPath`，Client、Server 与 Web 不得保留原生目录选择器或空请求体分支。
- Project 重命名只允许更新本地 `projects.name` 展示名，必须保持 `id`、`rootPath`、`createdAt` 和磁盘目录不变；Project 删除只移除 CodeAgent 注册及级联的本地设置/元数据，并释放对应 Web/Server Runtime，不得删除磁盘文件或归档 Provider Task。两种操作均使用独立严格 Mutation Schema 和 `Idempotency-Key`。
- `ProjectGitStatus` 必须同时返回可空的当前 `branch`、当前分支优先且无重复的本地 `branches`、无重复的 `baseBranches`、`repositoryMode`、稳定 `snapshot`、`staged` 和 `unstaged`；其中 Git 状态和提交选择只允许 Project 相对路径，但 Provider Task 历史中的 `AgentFileChange` 仍可保留绝对路径。Client 与 Fastify 响应边界必须使用同一严格 Schema 校验，Web 不得硬编码分支名称。
- Project Git 历史使用严格 `ProjectGitHistoryQuery` 与 `ProjectGitHistoryPage` Schema；每页必须返回所选仓库可空的当前 `branch`、当前 `HEAD` 的最近 `20` 条提交，并通过可空 `nextCursor` 请求下一页。根仓库模式不得接受 `repository`，聚合模式只允许选择 Server 最新枚举的直属 Git 子目录，响应返回无重复且有界的 `repositories`，不同仓库的分支和提交不得混合。Client 与 Fastify 必须校验同一响应 Schema，浏览器不得提交命令、分支引用或宿主绝对路径。
- Git message 生成、commit 和 commit+push 使用独立严格 Mutation Schema 与 `Idempotency-Key`，请求携带同一 `expectedSnapshot` 和无重复的 Project 相对路径；响应必须区分未请求、已推送、推送失败和未配置 upstream，不能把 commit 后 push 失败归一化为整体失败。
- Git 分支切换使用严格 `SwitchProjectBranchRequest` 与 `Idempotency-Key`，请求只携带本地分支精确名称和 `expectedSnapshot`，响应返回完整 `ProjectGitStatus`。Server 必须区分当前分支、分支不存在、状态冲突、只读仓库和执行失败，不得接受命令、远端引用或隐式创建分支。
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
- Project 源文件预览必须返回已解析的相对或绝对路径、文本内容和截断状态；相对路径限制在 Project 根目录内，显式绝对路径允许读取 Project 外的本机文件。Server 必须解析真实路径并拒绝不可读目标、目录和二进制文件，单次预览最多读取 `256 KiB`、最多返回 `4,000` 行。Project 图片预览允许相同的绝对路径范围，但只接受有界普通文件及 GIF、JPEG、PNG、WebP 的有效内容签名，响应必须设置受检媒体类型和 `nosniff`。
- `OpenProjectRequest.path` 同时承载普通菜单的 Project 相对路径和 AI 输出的本机绝对引用，只执行有界字符串 Schema 校验；Server 必须限制相对路径位于 Repository 根目录内，显式绝对路径则校验 `realpath`、可读性和目标类型，不能把 Protocol Schema 当作文件系统授权。
- Agent 写入必须由 Protocol 提供结构化 `AgentPromptInput`、Task/Turn Mutation 请求响应、能力和错误 Schema；Client 与 Server 都必须执行运行时校验。
- Task 固定、重命名和归档必须使用独立的严格 Mutation Schema 并携带 `Idempotency-Key`；Server 校验 `projectId + taskId` 归属后分别调用 Provider 端口，固定状态以 Provider 返回的原生 Task 为准，不得写入或覆盖本地元数据。
- 模型目录使用统一 `AgentModelPage` 并保留每个模型的默认与可用思考量；上传输入按 `file | image | text` 区分，固定使用 `POST /v1/projects/:projectId/attachments/:kind` 的 `multipart/form-data` 二进制流，不接受 Base64 JSON。文件覆盖 OpenAI File Inputs 公布的文档、表格、演示、文本和代码类型，图片只接受 PNG、JPEG、WebP 与非动画 GIF，并返回不含 Data URL 和本地路径的 `AgentAttachment`；文件单个及同一 Prompt 合计不超过 `50 MiB`，图片单张不超过 `10 MiB`、同一 Prompt 最多 `20` 张且合计不超过 `50 MiB`，粘贴文本单个不超过 `1 MiB`。Turn 只接收附件 ID、`AgentApprovalPolicy`、`AgentApprovalsReviewer`、`AgentSandboxMode`、非空模型 ID 和该模型支持的思考量。历史消息的 `AgentMessageAttachment` 表示受控图片或粘贴文本，只包含随机 ID、`kind`、媒体类型、名称和字节数；历史授权 Store 独立保留最多 `1,500` 项、合计 `512 MiB`，同一未变附件在重复 Task Snapshot 中必须保持当前附件 ID 稳定，避免仍在渲染的受控 URL 因快照重读返回 404。正文固定通过 `GET /v1/projects/:projectId/tasks/:taskId/attachments/:attachmentId` 按需读取，Server 必须验证 Project/Task 归属并禁止 MIME sniffing；Provider 历史尚未同步时，该端点必须读取当前运行 Turn 保留的已提交副本，待 `turn.completed` 后释放临时副本并由历史授权 Store 接管。
- Composer 按钮使用 `GET /v1/host-files` 浏览 CodeAgent 宿主支持的真实普通文件，并通过 `POST /v1/projects/:projectId/attachments/:kind/host` 导入；导入请求只接受严格绝对路径和 `file | image`，Server 必须跳过符号链接、重新验证类型与普通文件身份，并写入同一 `AttachmentStore`。返回的 `AgentAttachment` 不含 Data URL 或本地路径，待提交图片只通过 Project 作用域的随机附件 ID 读取预览，Turn 仍只接收附件 ID；本地与已配对 LAN 浏览器使用相同链路。
- Skill 目录使用 Project 作用域的统一 `AgentSkillPage`，只向 Web 暴露不透明 ID、名称、描述和作用域；`AgentPromptInput.skills` 接收按编辑器 Token 顺序排列的多个不透明 ID 与名称，Provider 必须逐项解析为 Codex 原生 Skill 输入，禁止暴露或接收 Codex Skill 绝对路径。
- Task MCP 清单使用严格 `AgentMcpServerPage`，逐项包含启动状态、工具数量、认证状态、可空展示元数据、失败原因和最长 `8,192` 字符的脱敏错误；不得包含工具定义、资源、command、args、env、URL 或 Secret。手动重载使用严格空 Body、`Idempotency-Key` 和 Project/Task 归属校验，返回同一状态页契约。
- `AgentTaskSettings` 必须是审批策略、审批审核方、模型、思考量和沙盒模式的严格完整对象，Task Snapshot 直接返回 Server 校验后的有效设置；Project defaults 包含模型、思考量和沙盒模式。计划模式只允许作为可选的 `AgentTurnOptions.collaborationMode: "plan"` 进入当前 Turn，Goal 模式只允许作为可选的 `AgentTurnOptions.goalMode: true` 进入当前首次提交，两者都不得写入 Task、Project 或 Global 持久设置；Codex Provider 必须为每个 `turn/start` 显式发送使用当前模型、当前思考量和内置开发指令的原生 `collaborationMode`，统一选项为 `"plan"` 时映射为原生 `"plan"`，缺省时映射为原生 `"default"`，不得通过省略字段继承 Thread 的上轮模式。Goal 必须使用独立 `thread/goal/set` 协议，不得伪装成 collaboration mode。`AgentGlobalSettings` 还必须包含独立的提交消息模型、思考量、最多 `4,000` 字符的提示词、`queue | steer` 默认跟进行为和默认打开应用；提交生成使用独立模型设置，不继承 Project 或 Task，跟进行为仅控制活动 Turn 中非空 Composer 提交的默认分派。完整设置更新使用原子 `PUT`，Client 必须对所有设置响应执行 Protocol Schema 校验。
- Provider 模型目录和 Codex Project 有效沙盒配置分别是初始模型能力与沙盒默认值的真相源，持久层只保存统一设置值；新 Task 继承 Project 模型、思考量和沙盒默认值，审批固定初始化为 `approvalPolicy: "on-request"` 与 `approvalsReviewer: "user"`，会话级授权和 Pending Request 不得进入长期设置。
- Task Snapshot 使用 `contextUsage` 保存最近一轮上下文用量，实时链路使用 `usage.updated` 同步更新；占用值必须来自 Provider 的最近一轮 Token Usage 与模型上下文窗口。
- 运行能力独立声明 Task 的 `list`、`read`、`start`、`fork`，Turn 的 `start`、`steer`、`interrupt`、`review`、`compact`，Skill 的 `list`、`use`，以及 Feedback 的 `upload`；消费者不得通过 Provider 名称推断能力。
- `turn/steer` Mutation 必须携带统一 `AgentPromptInput`、路径中的活动 `taskId + turnId`、Body 中匹配的 `taskId` 和 `Idempotency-Key`；Server 必须确认 Turn 仍在运行。Provider 映射固定使用 `expectedTurnId`，不得接受模型、思考量、审批或沙盒覆盖，并必须校验返回的 Turn ID。
- `POST /v1/projects/:projectId/tasks`、`POST /v1/projects/:projectId/tasks/:taskId/turns` 和 Project 作用域内的 Turn Mutation 必须携带 `Idempotency-Key`，并使用统一错误码表达缺失 Key、冲突、资源不存在和 Provider 失败。
- Pending Request 使用 `command_approval`、`file_change_approval`、`user_input` 判别联合；命令审批将受管网络目标归一化为可空的 `networkAccess`，保留 Host 与协议；Snapshot 只返回未解决请求，实时链路使用 `pending_request.created`、`pending_request.resolved`、`pending_request.expired` 同步生命周期。
- Pending Request 生命周期事件必须分别携带 `pending`、`resolved`、`expired` 状态；固定选项问题至少提供一个选项，无选项 Choice 只有在允许自定义回答时才合法。
- `POST /v1/projects/:projectId/tasks/:taskId/pending-requests/:requestId/resolve` 必须携带 `Idempotency-Key`，并校验 `projectId + taskId + turnId + itemId + requestId`、请求类型、可用决策、User Input 单值与固定选项和当前状态。
- 读取剪贴板的 Playwright 用例必须在 Browser Context 显式声明 `clipboard-read` 和 `clipboard-write` 权限，不得依赖开发机或 CI Runner 的默认授权。
- `dependency-cruiser` 必须分析 TypeScript 编译前依赖，使纯类型模块不会被误判为 orphan，并确保类型导入同样接受跨包依赖边界校验。
- ESLint 必须对生产 JavaScript/TypeScript 模块强制执行 500 行上限，超限模块按职责拆分；仅声明文件、测试/规格文件、测试 fixture 与 E2E 场景可在集中配置中豁免，生产文件不得使用单文件例外。
- 变更按新协议逻辑实现并删除冗余旧路径；破坏性变更明确升级 API 或事件版本。
- 更新所有消费者、契约测试和架构文档后运行 `pnpm check`。
