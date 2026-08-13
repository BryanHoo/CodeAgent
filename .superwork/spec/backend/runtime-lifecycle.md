# 运行时生命周期

## Codex App Server

- 默认使用长驻 `codex app-server --listen stdio://`，不为每个 Turn 创建进程；允许 Codex 忽略其版本尚未识别的前向配置字段，避免 Desktop 与打包 CLI 的配置版本差异阻断启动。
- CLI 启动 App Server 时不绑定 Project `cwd`；全局 `CodexRuntimeProvider` 只注册一次 RPC Notification 与 Server Request Listener，并维护 `taskId -> projectId/cwd` 归属映射。
- CodeAgent 只通过 App Server `account/read`、`account/login/start`、`account/login/cancel`、`account/logout` 管理官方登录或 API key 凭证；禁止读取、修改或复制 `auth.json`。CodeAgent 创建的自定义 Provider 固定使用 `code_agent_custom`，通过 `config/batchWrite` 写入无 Secret 的 Responses API 配置。连接状态必须同时读取有效 `config/read`：只要 `model_provider` 不是内置 `openai`，或配置了 `openai_base_url`，就按用户现有 Codex CLI 自定义 API 处理，并返回所选 Provider 的 `base_url`。
- Desktop 必须按平台可选依赖中的 `codex-package.json` 镜像并打包完整 canonical package，保留 `bin`、`pathDir`、`resourcesDir` 及其目录层级，不能维护可执行文件白名单；启动 App Server 时直接使用 package 的原生 entrypoint，并将 `pathDir` 和 `bin` 置于 `PATH` 首位。Desktop 必须有界恢复 Unix 登录 Shell 与各平台常见用户工具目录，使 Codex 派生的 MCP Server 可找到 `npx`、`uvx` 等启动器；Windows 必须提供原生 `npx.exe` 代理并直接执行 `node.exe` 与 `npx-cli.js`，不得依赖 `.cmd` 或 GUI 进程继承用户 Shell 环境，也不得把会再次派生子进程的 JS launcher 作为受管 App Server 进程。
- 使用参数数组、`shell: false` 和经过控制的环境变量；Secret 不进入参数或日志。
- 子进程不消费输入时必须将 stdin 配置为 `ignore`；确需 `pipe` 写入时必须监听写端错误，避免进程提前退出产生未处理的 `EPIPE`。
- 所有 RPC 设置超时；子进程退出时统一 Reject Pending RPC，并清理 Listener。
- App Server 初始化必须启用 experimental API；后台终端只通过 `thread/backgroundTerminals/list` 获取，并在 Provider 边界把原生 `processId` 映射为不透明 Terminal ID。停止单个终端固定调用 `thread/backgroundTerminals/terminate`，不能用 `turn/interrupt` 代替。
- JSONL 字节流必须跨 Buffer 分片保留 UTF-8 解码状态，不得逐块独立转码；完整帧和未完成 Buffer 必须按原始 UTF-8 字节分别执行 `64 MiB` 有界限制，以接收原生 `imageGeneration` 的单帧 Base64 结果，超限立即关闭连接；协议错误只能记录帧长度、类型或安全摘要，禁止携带原始帧内容。
- JSONL 中同时包含 `id` 与 `method` 的合法帧按服务端请求分发，并使用原 `id` 返回结果；未支持的方法返回 `-32601`，非法参数返回 `-32602`，不得让 Codex 无限等待。
- Provider 丢弃未知 Notification 或隔离单条字段映射失败时必须通过 Pino 告警，固定记录 `diagnosticCode`、method、Codex version、Project ID 和可提取的 Task ID；禁止记录原始 params、Prompt、命令输出或文件正文。
- Codex 锁定版本生成的 `ServerNotification` Union 必须逐项归入 mapped、special 或 ignored 且只能归入一类；Schema 漂移测试必须验证分类全集与官方方法全集一致，新增 Notification 不得静默进入兼容分支。
- JSONL 响应只有在底层写入回调确认后才算成功，所有写入都使用有界超时；异步写入失败必须关闭连接且不能提前发布请求终态。
- 只有 `code = -32001` 且 `data.retry = true`、明确表示请求未入队的过载错误才允许重试；Adapter 使用带正负 `20%` jitter 的有上限指数退避，默认最多重试 `4` 次、累计退避不超过 `5s`、单次不超过 `2s`，并保留首次请求的总超时。连接关闭或请求超时必须取消待执行重试，其他错误直接透传。
- Task/Turn 写入只通过 `thread/start`、`turn/start`、`turn/steer`、`turn/interrupt` 和稳定 Goal API 映射；文本输入必须转换为当前 Codex Schema 要求的 `UserInput[]`，Provider 不向上泄漏原生字段。
- Goal 模式只允许作为当前首次提交的 `AgentTurnOptions.goalMode: true`。Provider 必须先通过 `thread/settings/update` 应用当前审批、沙盒、模型和思考量，再调用 `thread/goal/set` 写入 Trim 后的 1 至 4,000 字符 objective，并等待 Codex 自动发布 `turn/started`；不得额外调用 `turn/start`。`thread/goal/updated` 与 `thread/goal/cleared` 只更新 Codex 内部 Goal 生命周期，不生成未知通知告警；自动 Turn 的 Message、Tool 和终态继续使用统一事件映射。Git 提交信息使用的 ephemeral Thread 不支持 Goal。
- `turn/steer` 只允许写入当前 Task 的活动 Turn，必须传递 `expectedTurnId` 且不能携带模型、思考量或审批等 Turn 设置覆盖；Provider 必须校验响应 `turnId` 与预期 Turn 一致。
- Server 内部生成 Git commit message 时，必须通过 `thread/start { ephemeral: true }` 启动一次隐藏的结构化 Turn。选中变更的完整 Git diff 不超过 `64 KiB` 时，默认 Prompt 必须直接提供带 staged/unstaged 标识的精确 diff；超过预算时必须改为最多 `20 KiB` 的逐文件 staged/unstaged、类型、行数和 diff 字节摘要，并从整个选择范围等距抽取最多 16 个变更，提供合计最多 `36 KiB` 的首尾 diff 片段。两种输入都必须禁止 Codex 读取文件或运行命令，避免文件数量放大工具调用和延迟。发送给 Codex 的固定指令必须使用英语，用户配置的全局提交提示词必须原样嵌入且不得翻译。固定 Prompt 不得预设 Conventional Commits、提交信息语言、标题、正文或其他格式偏好；全局提交提示词负责定义全部客户级格式和语言，但不能覆盖 diff 不可信边界，以及唯一结果只能写入结构化输出 `message` 字段的约束。同时固定使用 `read-only`、`never` 和 `{ message }` `outputSchema`。最终 assistant message 必须从独立 `item.completed` 事件收集，`turn.completed` 只作为终态信号，不能假设其重复携带完整 items。Provider 默认事件订阅必须排除临时 Task，只有执行该内部流程的订阅可显式接收临时事件，避免浏览器通知或导航暴露隐藏 Task。Codex 不执行 Git Mutation；Turn 完成、失败或超时都必须移除监听器，并 best-effort 中断和取消订阅临时 Thread，不得归档或写入用户 Task 历史。
- App Server 重启后，从 `thread/list` 或 `thread/read` 重新发现的持久化 Task 在首次 `turn/start` 前必须调用一次 `thread/resume`；同一进程内由 `thread/start` 或 `thread/fork` 创建的已加载 Task 不得重复恢复，并发续写必须复用同一个恢复 Promise。
- `agentMessage.phase` 中的 `commentary` 与 `final_answer` 都必须映射为 Assistant Message、原样保留有效阶段，并通过 `message.delta` 实时交付；缺失或 `null` 阶段保持无阶段，非法阶段必须拒绝映射。原生 `reasoning` Item 仍映射为统一 Reasoning Item；Web 只允许展示 `summary`，原始 `content` 永不进入展示组件或 DOM。
- Codex `turn/plan/updated` 必须映射为 Provider 无关的 `plan.updated` 完整计划事件，按原始顺序保留步骤，并将 `inProgress` 归一化为 `in_progress`。Provider 必须按 Task 缓存最近计划并写入可空的 `AgentTaskSnapshot.plan`，使浏览器重连和 Snapshot 重读能够恢复同一计划；释放 Task 时同步清理缓存。
- Codex `item/plan/delta`、Reasoning Summary 分段、MCP Progress、File Patch、Turn Diff、Hook、Safety Buffer、Model Reroute、Model Verification、Guardian Warning 与结构化 Error 必须映射为 Provider 无关事件或 Item。高频文本事件按 Item 追加，状态快照按 Item 或 Turn 替换；`item.completed` 和 `turn.completed` 仍是最终权威实体。
- 实时 File Patch 与 Turn Diff 必须在 Provider 边界按 UTF-8 字节限制载荷：单事件的 diff 聚合最多 `512 KiB`，File Patch 最多保留 `100` 个变更。统一事件必须携带 `truncated` 与原始全部 diff 的 `originalByteLength`，截断不得切断多字节字符；Server 的历史保留限制不能代替传输前的载荷限制。
- Codex 协作 Item 的 `item/started` 必须映射为统一 `item.started` 实时事件，不能丢弃长时间运行的子代理操作；协作 Item 必须保留子代理任务、模型、思考量和代理状态，并使用 Provider 无关的 `agent/*` Tool 名称。普通消息和命令继续使用专用 Delta，不重复交付空的 Started Item。
- 子代理使用独立 Codex Thread。Web 按需读取父协作 Item 的 receiver Task ID 时，Runtime 必须先以 Project 归属暂存该 Thread，`thread/read` 验证 `cwd` 后同时确认 Runtime Owner 与 Project Provider Task 集合，再交付读取期间暂存的通知；这样弹窗关闭后可以停止浏览器订阅，再次打开时从最新 Snapshot checkpoint 继续，未知 Project 的子线程事件仍必须丢弃。
- `thread/start` 返回的新 Task 在首条用户消息前可能尚未 materialize；此时 `thread/read(includeTurns: true)` 的明确未 materialize 错误必须映射为该已知 Task 的空闲空快照，未知 Task 和其他 RPC 错误不得被吞掉。
- Provider 对已成功 `thread/start` 的持久化 Task 必须提供进程内 read-your-writes：在 Codex 原生 `thread/list` 首次返回该 Task 前，将本地未 materialize Task 合并到首个列表页；只有原生列表接管后才能移除该列表回退，`turn/start` 或 `thread/read` 成功不能提前造成列表不可见窗口。`ephemeral` Task 必须排除在该列表回退之外。
- Task 命令通过受控 Provider 方法映射：代码审查使用 `review/start`，上下文压缩使用 `thread/compact/start`，新任务续接使用 `thread/fork`，任务反馈使用 `feedback/upload`；每个动作都必须先验证 Task 属于当前 Project，并校验响应中的 Thread ID。Review Turn 中 Codex 自动生成的 `userMessage` 只作为内部执行 Prompt，Provider 必须在响应、实时事件和历史 Snapshot 中将重复 Prompt 折叠为单个统一 `review` Item。
- Task 固定状态只映射 Codex 稳定 `Pinned` Section ID `01984de2-8f74-7c91-a3b2-5c5e937cf318`，其他自定义 Section 保持未固定；固定 Mutation 调用 `thread/section/move { threadId, sectionId }` 移入该 Section 或 `null`，随后通过 `thread/read { threadId, includeTurns: false }` 校验 Thread ID、`cwd` 和目标状态；重命名固定映射 `thread/name/set`，归档固定映射 `thread/archive`，所有动作都必须先验证 Task 属于当前 Project。
- 官方模式的模型列表通过分页 `model/list` 获取并过滤隐藏模型；Provider 分页统一拒绝重复 cursor，并限制最多 `1,000` 页，模型最多 `1,000` 项、MCP 与后台终端最多 `10,000` 项。CodeAgent 配置的自定义模式从规范化 Base URL 的 `GET /models` 有界读取，并与用户在设置中配置的模型 ID、模型名称合并，按 ID 去重和排序，且只支持 Responses API。同 ID 的手动条目覆盖远端显示名称；远端目录不可用时只有存在有效手动模型才允许继续配置，没有任何可用模型必须失败。用户在 Codex CLI 预先选择的自定义 Provider 必须通过 App Server `model/list` 读取目录，使 `env_key`、`requires_openai_auth` 或命令认证仍由 Codex 持有；持久化目录只有在模式和 Base URL 均与当前有效配置一致时才能复用。Server Runtime 按当前连接模式使用带 TTL、字节容量与 in-flight 去重的模型目录缓存统一服务设置校验和 `/v1/models`，模式切换时清空且旧请求不得回填。CodeAgent 全局设置记录不存在时，Runtime 必须通过不带 `cwd` 的 `config/read { includeLayers: false }` 读取 Codex 当前用户配置的模型、思考量、审批策略、审批审核方和沙盒模式；每个缺失、不受支持或不在当前模型目录中的字段独立回退到 CodeAgent 项目默认值，已持久化全局设置后不得再由 Codex 配置覆盖。Project 沙盒默认值通过携带 `cwd` 的 `config/read` 读取；`turn/start` 明确将普通文本与文件路径、受控图片 Data URL 分别映射为 Codex `text` 与 `image`，受控临时文件必须使用其绝对路径作为独立 `text` 输入，同时映射 `model`、`effort`、`approvalPolicy`、`approvalsReviewer` 和结构化 `sandboxPolicy`。自动审批使用 `on-request + auto_review`，不扩展沙盒边界；`item/autoApprovalReview/started` 与 `item/autoApprovalReview/completed` 必须映射为同一统一 Item，按原始顺序实时展示审批状态、风险、用户授权判断和理由。
- Codex 用户历史中的 `image`、`localImage`、`imageGeneration` 与带 `text_elements` 的粘贴文本必须映射为只含随机 ID、类型、媒体类型、名称和字节数的统一消息附件；生成图片优先引用 Codex 已保存的本地文件，缺失或不可读时解码原生 Base64 结果写入受控历史附件 Store，Base64 不得进入统一事件、Snapshot 或 Web 状态。文本元素按 UTF-8 `byteRange` 从可见正文剔除并写入受控历史附件 Store，不能把完整粘贴内容回显为消息气泡。Provider 只接受 GIF、JPEG、PNG、WebP 的有效内容签名，历史附件 Store 最多保留 `1,500` 项、合计 `512 MiB`。同一 Task 中来源、名称和内容状态未变化的附件必须在重复 `thread/read` 间复用当前随机授权 ID 并刷新 TTL，后续 Snapshot 读取不得让已交付页面的附件 URL 立即失效；TTL 到期、来源变化或 Task 释放时才清理对应授权。Snapshot 不得包含 Base64、本地路径或文本正文；本地文件正文只在受权读取时加载并复验大小、修改时间和内容签名。附件缺失、超限、格式不受支持或 Store 达到预算时降级为无正文的工具状态，不能使整个 Task Snapshot 失败。
- Codex transcript 中用于恢复 Skill 的 JSONL 必须按 Thread 缓存已发现路径，并以 `transcriptPath`、`mtime` 和 `size` 复用解析结果；文件增长时从已读取字节 offset 增量解析，并有界保留未完成行。单文件最多缓存 `2,048` 个 Turn 且 Skill 名称合计不超过 `1 MiB`，超过任一限制时按最旧 Turn 淘汰；未变化的重复读取必须复用同一合并结果。路径缓存、文件数、单行字节数和单次读取字节数必须有界，文件未生成时只允许低频重试递归发现。
- Project Skill 目录只通过 `skills/list { cwds: [project.rootPath] }` 获取并过滤禁用项；对外 ID 必须是稳定不透明摘要。`turn/start` 只有在 ID 与名称仍匹配当前目录时，才能加入 Codex 原生 `{ type: "skill", name, path }`，原生绝对路径不得越过 Provider 边界。纯 Skill Turn 必须在原生输入前补充按 Token 顺序序列化的 `$<skill.name>` 文本，使 Codex 为 Thread 生成可供 `thread/list` 和 CLI resume 使用的索引；统一消息映射必须在实时事件与历史 Snapshot 中把该索引文本和后续 Skill 展开用户项折叠为单个只含结构化 Skill 的用户消息。
- 当前 Task 可读取的 MCP 服务只通过 `mcpServerStatus/list { threadId, detail: "toolsAndAuthOnly" }` 分页获取，并与同一 Task 的 `mcpServer/startupStatus/updated` 合并；Provider 必须先确认 Task 归属当前 Project，历史或已释放 Task 必须复用并发去重的 `thread/resume` 完成加载后再查询或重载 MCP。有效启动通知必须在脱敏后发布为统一 `mcp_server.status_updated` 事件，使 Web 能按服务实时区分 `starting`、`ready`、`failed` 和 `cancelled`。只向 Core、Protocol 和 Web 暴露名称、启动状态、工具数量、认证方式、展示元数据及有界启动错误。禁止让工具定义、资源、command、args、env、URL 或 Secret 越过 Provider 边界。不得使用无 `threadId` 的进程级结果，也不得回退到 Project `config/read mcp_servers` 冒充 Task 可读清单。手动重试固定调用 `config/mcpServer/reload` 并返回目标 Task 的新状态页；Task 释放时必须清理对应启动状态。MCP 清单读取或重载失败时，Server 必须将 Codex 原始 `Error.message` 作为结构化 `PROVIDER_ERROR` 返回，Client 必须保留该消息、错误码和 HTTP 状态，禁止只展示通用 `502` 或将消息替换为通用 Provider 错误。
- `thread/tokenUsage/updated` 只使用最近一轮 `last.totalTokens` 计算当前上下文占用，并连同 `modelContextWindow` 写入实时事件和后续 Snapshot；不得使用累计 `total.totalTokens` 冒充当前上下文。
- Web 最后一个 Task Runtime 消费者释放或不可见 Task 完成后，通过 Provider 无关 `unsubscribeTask` 端口调用实验 `thread/unsubscribe`。只有无运行 Turn、无 Pending Request、无后台终端、无读取或恢复 Promise 时才允许原生释放；`busy`、`notLoaded`、`notSubscribed` 与 `unsubscribed` 都是可恢复的 best-effort 生命周期结果，不能阻断导航。
- `thread/unsubscribe` 成功或确认未加载后，Codex Provider 必须同步删除该 Task 的 Owner、Context Usage、运行标记、恢复状态、历史附件授权、暂存事件、暂存 Server Request、终态 Request 和未 materialize 回退；重新打开时通过 `thread/read` 重新验证 Project 归属并建立状态。Task 级 Map 禁止只增不减。
- `turn/interrupt` 响应只确认中断请求已接收；`turn/completed` 的 `interrupted` 状态才是 Turn 终态，Server 和 Web 不得提前伪造完成状态。
- 非重试 `provider.error` 已确认的错误原因不能被随后缺少错误文本的 `turn/completed` 清除；Web Runtime 合并终态时必须保留该失败原因，允许已产生的部分回复与错误共同展示。
- Codex Server Request 只有在 Task 已通过当前 Project 归属验证后才能进入可解决集合；读取期间到达的请求先暂存，原生终态到达时立即清理，归属验证成功后再提升，其他 Project 的请求直接丢弃；归属已确认后即使 Snapshot 映射失败，也不得删除仍在等待响应的请求。
- Pending Request 在本地解决、原生 `serverRequest/resolved` 或 Turn 终止时只产生一次终态；Snapshot 不保留 `resolved` 或 `expired` 请求。
- 带 `autoResolutionMs` 的 User Input 到期时使用空答案响应 Codex 并发布 `expired` 终态；手动响应写入失败不得取消自动过期，只有响应确认成功或其他终态才能清理对应定时器。
- User Input 手动响应确认成功后，Provider 必须在 `pending_request.resolved` 之后发布同一 Turn 的用户 Message Item，按问题顺序展示回答供实时 Timeline 渲染；`isSecret` 回答只能显示固定遮罩，不能进入事件、日志或前端状态。

## Server 与持久化

- CLI 未提供子命令时必须与显式 `code-agent start` 执行同一启动流程；根级 `-h`、`--help` 必须使用英文完整列出 `start`、`doctor`、`version` 及其全部参数、默认值、约束和示例。
- CLI `start` 必须在创建 SQLite、Codex 或 HTTP 资源前检查 npm registry `latest`；检查失败、非交互终端或用户拒绝更新时继续启动当前版本。用户确认后必须先按严格复验的目标版本完成全局安装，再使用原始 `start` 参数重新执行 CLI；旧进程不得继续创建运行时资源，替换进程不得重复询问同一次更新。
- CLI 必须把根发布包版本和已启动 Codex Binary 的实际版本注入 Server；`GET /v1/app-info` 读取 npm registry `latest` 并在失败时保留本地版本。`POST /v1/app-update` 必须携带 `Idempotency-Key`，重新确认目标版本等于严格校验的 `latest` 且高于当前版本后，使用参数数组和 `shell: false` 执行全局 npm 安装；安装成功只返回需要重启状态，不得在 HTTP 请求中替换或重启当前进程。
- CLI 默认监听 `127.0.0.1:3210`，每次监听成功后直接打开新的浏览器页面，不检测或复用已打开页面；`--port` 可将本地或 LAN 监听端口覆盖为 `1` 至 `65535` 的整数。只有 `--lan` 才建立启动期访问密码、传入进程内 Access 配置并监听 `0.0.0.0:<port>`；`--lan-password` 可提供 16 至 128 字符且同时包含大小写字母、数字和符号的自定义密码，缺省时生成至少 128 bit 熵的随机密码。LAN 模式不得自动打开浏览器，终端只列出物理网络接口上的私有 IPv4 URL，不把 VPN、虚拟网桥或 `0.0.0.0` 当作访问地址；自定义密码不得回显。
- LAN 访问密码、Session、失败窗口和清理定时器只属于当前 Fastify 实例；关闭时必须清空，重启不得恢复。未配置 `--session-ttl` 时 Session 在当前实例内永不过期；显式配置时接受带 `ms | s | m | h | d` 单位的任意正整数时长，并使用签发时固定的绝对期限，请求不得续期。
- Fastify 资源通过插件封装，并在 `onClose` 中释放。
- 幂等 Mutation 的已完成结果缓存与进行中请求必须独立管理；`idempotencyCacheSize` 同时作为结果缓存容量和不同 Key 进行中请求的硬上限。同 Key 继续复用原请求，不同 Key 超限时返回可重试的 `503 IDEMPOTENCY_CAPACITY_EXCEEDED`，请求完成或失败后立即释放进行中名额。
- 普通 HTTP 路由使用 Fastify 原生 60 秒 `handlerTimeout` 和 `request.signal` 执行协作取消；Event Stream WebSocket 是显式长连接，不继承 Handler 截止时间，其有界性由队列、背压和连接关闭生命周期保证。
- Project 列表默认空，通过宿主系统目录选择器注册，并持久化到 `CODEX_HOME/code-agent/state.sqlite3`；重复真实路径幂等返回已有 Project。
- CLI 启动时必须以 `0700` 幂等创建 `${CODEX_HOME}/code-agent/temporary-workspace`，拒绝最终目标为符号链接，并在 SQLite 中确保固定 ID、`kind = temporary` 的内部 Project。Project 列表、排序、重命名、删除及 Project defaults 只能操作 `kind = user`。
- 用户临时聊天必须通过 `/v1/temporary/**` 访问内部作用域，`/v1/projects/temporary/**` 即使经过 URL 编码也必须返回资源不存在。创建必须调用不带 `ephemeral` 的 `thread/start`；Snapshot、设置更新和 Turn 参数必须完整保留普通 `AgentTaskSettings`，不得覆写审批、Sandbox、模型或思考量。temporary API 允许 Task、Turn、Attachment、Event、Skill、MCP 和后台终端能力；Web 不得借该作用域请求 Git、文件、目录打开、Project defaults 或其他 Project Mutation，也不得展示内部路径。
- Server 启动不得枚举项目并预建 Runtime；Project Runtime Context 只在首次 Project API 或 WebSocket 访问时激活。已激活 Context 必须先从进程内缓存解析，只有缓存未命中时才读取 Project Repository。Project 重命名成功后同步刷新缓存中的展示信息；Project 删除成功后必须释放事件订阅和 Context 缓存，后续访问重新读取 Repository 并返回资源不存在，不能复用已删除 Runtime。
- 同一 Project 的首次 Runtime Context 初始化必须按 Project ID 复用进行中的 Promise；异步读取 Project Repository 返回后再次检查 Context 缓存，确保并发请求只创建一个 Event Stream 和一份 Provider 事件订阅。初始化成功、资源不存在或失败后都必须清理进行中条目，并使用并发 `inject` 测试覆盖该行为。
- Project 删除和 Server 关闭必须通过 Runtime 的显式 `releaseProject` 端口统一释放 Project Provider、原始 Provider、Task Owner、Pending Request 定时器、Task 运行状态和历史附件授权；Server 同时清理该 Project 未消费或 Turn 占用中的上传附件，且不得影响其他 Project。
- Project 与 Codex Thread 的 `cwd` 归属必须按真实路径比较；Windows 路径忽略大小写，Linux 符号链接解析到同一实体，不能仅比较原始路径字符串。
- Linux 系统目录选择器在某个桌面启动器缺失或无法连接桌面会话时必须继续尝试下一个启动器，全部不可用后再回退终端输入；用户取消选择不得触发回退。
- 浏览器与外部应用启动必须观察短时退出结果；启动器快速非零退出视为失败，Linux 浏览器按候选顺序继续回退，不能在仅收到子进程 `spawn` 事件后报告成功。macOS Finder 与 Windows `explorer.exe` 是系统请求转交器，成功 `spawn` 后不得用代理进程随后的退出码误报失败；Finder 对文件使用 `open -R` 定位，对目录直接打开。Windows Terminal 固定使用 `-w new -d <projectRoot>` 打开独立新窗口，不受用户 `windowingBehavior` 设置影响。
- 数据库使用版本化 Migration、`STRICT` 表、显式 SQL、Prepared Statement 和事务，并固定启用 WAL、外键、NORMAL synchronous 与 5000ms busy timeout。
- 所有同步 SQLite 操作都放入专用 `worker_threads` Worker，Fastify 主事件循环只通过 Core Repository 端口异步调用。
- Global settings 以单例记录保存完整审批策略、审批审核方、模型、思考量、沙盒模式、默认跟进行为与默认打开应用；默认跟进行为只允许 `queue` 或 `steer`，新记录与迁移记录固定使用 `queue`。Project defaults 保存模型、思考量与沙盒模式；Task settings 保存完整运行设置。有效值固定按 `Task > Project > Global` 解析并按实时模型目录校验；读取推导值不得隐式写入局部记录，新 Task 创建和 Turn 启动时才固化完整 Task settings。
- Task 固定状态不得写入本地数据库；SQLite migration 必须删除旧 `task_metadata`，Task 列表、Snapshot 和固定 Mutation 都以 Provider 返回的 Codex 原生 `Pinned` Section 状态为唯一事实来源。
- Provider 连接只允许持久化 `official | custom` 模式、自定义 Base URL、已验证的有界模型目录和更新时间；API key、登录 URL、登录 ID、`allow_for_session` 和可操作 Pending Approval 不得持久化，进程重启后不得恢复可操作 `pending`。
- WebSocket 客户端使用独立有界队列，慢客户端不能阻塞 Provider；`bufferedAmount` 超过 `256 KiB` 时向 Event Stream 发出软背压信号，超过 `1 MiB` 时以 `1013` 关闭连接并要求刷新 Snapshot。
- 每个 Project 创建独立 Event Stream Session，Provider 不分配传输序号。Server 在分配单调 `sequence` 前，按 `taskId + turnId + itemId + type + field` 合并 `message.delta`、`reasoning.delta` 和 `command.output_delta`：缓冲队列只能合并相邻同 Key 事件，不得跨其他 Item 重排 A-B-A 交错输入；普通窗口固定为 `16ms`，收到软背压信号后的下一窗口固定为 `32ms`。
- 非 Delta 事件、Snapshot checkpoint、事件回放和 Runtime 关闭前必须立即冲刷所有更早 Delta；不同 key 按首次进入窗口的顺序分配连续 `sequence`，关键终态不得越过待发送 Delta。
- Event Stream 使用固定数组环形缓冲区，每个 Project 最多保留 `1,000` 条、合计 `4 MiB` 的已发布事件，单事件最多保留 `1 MiB`；容量按序列化 UTF-8 字节计量并从最旧事件开始淘汰。同一 Event 对象的 Frame 与字节长度必须只序列化一次，并通过弱引用结果供保留预算和全部 WebSocket 客户端复用。回放必须按 `sequence` 升序返回，跨越已淘汰或因单事件超限而未保留的序列时发送 `resync.required`。
- `/v1/projects/:projectId/events` 首帧发送 `connection.ready`，只补发 `afterSequence` 之后仍在缓存窗口内的事件；过期或超前序号发送 `resync.required`。
- `/v1/metrics/events` 只读暴露每个 Project 的 Provider 输入、发布、合并、pending Delta、保留淘汰、软背压、活动客户端和慢客户端断开计数，不得包含 Prompt、命令输出或文件内容。
- Provider `readTask` Promise 完成前必须让返回 Snapshot 包含此前状态并同步交付对应通知；Task Snapshot 读取完成后再从当前 Event Stream 固定 checkpoint，避免丢失事件或重复补发已有内容；Task 归属确认后读取有效设置，固定状态直接保留 Provider Snapshot 的原生值。
- `resync.required` 发送后由 Server 主动关闭当前 WebSocket；客户端必须使用新 Snapshot checkpoint 建立新连接。
- Fastify 关闭时取消 Provider Event 订阅并关闭 WebSocket 资源。
- 所有 Agent Mutation 必须校验非空 `Idempotency-Key`；同操作、同 Key、同 Payload 复用进行中或成功结果，不同 Payload 返回冲突，失败结果不缓存。
- Git message 生成与 commit/commit+push 同样必须使用 `Idempotency-Key` 并复验 `expectedSnapshot`；每个 Project 同时只允许一个 Git Mutation，冲突请求返回稳定错误。用户 message 原样交给 Git，Codex 生成只提供可编辑候选。
- Git Working Tree 状态、分支和 diff 等后台只读子进程必须继承受控环境并设置 `GIT_OPTIONAL_LOCKS=0`，避免周期读取刷新索引或争用可选锁；每次读取最多并发 4 个 Git 命令、处理 1,000 个变更文件并返回合计 10 MiB Diff，未跟踪文件读取最多并发 8 个；每个仓库的 staged 与 unstaged Diff 必须分别批量读取并按文件拆分，禁止按变更文件启动子进程；Git Mutation 不得复用该环境约束。
- 后台终端读取必须先验证 Project/Task 归属；Project Provider 只在 Runtime Owner 缓存缺失时读取一次 Task，持续轮询不得重复映射完整历史。已持久化但未加载到当前 App Server 的历史 Task 将原生 `-32600 thread not found` 归一化为空终端列表，其他 Provider 错误继续上抛；单终端停止是幂等 Mutation，即使进程在请求到达前自然退出也返回已终止语义。
- Task 创建在 Provider 成功但设置持久化失败时必须保留有界恢复状态；同 `Idempotency-Key` 重试只补齐持久化，不得再次调用 Provider 创建 Task。
- 成功的幂等结果缓存必须同时设置容量上限和过期时间；进行中的请求不得淘汰，Runtime 关闭时清空全部条目。
- 任何新增 Task Runtime、Snapshot、历史或终端缓存都必须同时声明按字节容量、Entry 次级上限和明确清理触发点；不得依赖框架默认 TTL 或无界模块级 Map。
- 浏览器图片、文件与粘贴文本只通过 `multipart/form-data` 二进制流幂等上传，类型由路由参数在 Body 解析前确定；Server 先按声明长度拒绝明显超限请求，再在流式写入中强制执行真实字节限制。所有附件均使用异步文件 API 和随机文件名写入 Runtime 专用临时目录，原始名称只用于界面展示，不能成为磁盘路径；普通文件通过受控临时文件的绝对路径文本交给 Codex，Store 不长期保留 Base64 或 Data URL。Attachment Store 必须设置有限的默认条目数，在途上传必须计入条目容量，总字节检查与容量提交之间不得让出事件循环，并使用并发上传测试覆盖条目和字节预算。文本附件必须流式严格校验 UTF-8，并映射为带完整 UTF-8 字节范围 `text_elements` 的 Codex `text`；图片只在 Turn 启动前按需生成短生命周期 Data URL `image`。Provider 失败时保留引用供同一请求重试；Provider 接受后立即消费图片和文本引用，普通文件保留到对应 Turn 终态或 TTL 到期，Runtime 关闭时异步删除整个临时目录。

## 关闭

- Rust `CodeAgentRuntimeBuilder` 必须在编译期要求 Repository、Provider、Git、File、Attachment、Clock 与 Update ports；Runtime 不依赖 Tauri、N-API 或具体 Provider/Platform crate。
- Rust 活动操作通过有界 Registry 管理，取消使用共享 `CancellationToken`；注册项必须由 RAII guard 在成功、错误传播和 Future 取消时自动释放，禁止依赖调用方手动完成清理；成功幂等结果同时受容量与 TTL 限制，关闭时清空并拒绝新请求；后台任务通过 `TaskTracker` 纳入关闭树，关闭时停止接收、通知取消并有界等待。
- Rust Project Event Stream 由 Runtime 分配 Provider、Session、Sequence、Timestamp 与 Version；相邻同 Key Delta 才允许合并，关键事件、checkpoint、replay 和 close 前必须先 flush。保留同时受事件数、单事件 UTF-8 字节和总字节预算限制，慢订阅者通过独立控制信号进入 resync，不得阻塞 Provider。Provider 上游订阅满载时必须用预留槽位交付一次不可重试的溢出终态并关闭该订阅；Runtime 收到后立即把全部下游订阅标记为 `ResyncRequired`，Tauri 使用触发时的最新 checkpoint 发送 `resync.required`。
- Tauri 只 `manage` 一个 `Arc<CodeAgentRuntime>`；退出时先关闭 Runtime 操作树，再关闭 Repository 的有界数据库队列并 join 唯一 SQLite owner thread。
- Desktop 启动只管理一个 Codex supervisor；二进制按环境变量、应用旁 sidecar、仓库 target-triple 产物顺序解析。握手失败或进程退出写入诊断但不阻塞窗口，退出顺序固定为 Channel 订阅、Runtime、Codex 进程。
- Tauri 事件订阅必须先建立实时接收器，再固定 checkpoint 并回放；只通过 `Channel<EventStreamMessage>` 交付 `connection.ready`、连续事件和 `resync.required`，不得使用全局窗口事件。取消、发送失败和 resync 必须清理订阅任务。

- 本地 CLI 启动在所有平台统一复用已打开的 CodeAgent 页面：Web 通过进程级浏览器会话 ID 识别 Server 重启并刷新当前标签，CLI 在 HTTP Server 就绪后执行有界等待；收到旧页面握手时不得再次调用系统浏览器，超时后才打开新标签。LAN 模式继续不自动打开浏览器。

- `SIGINT` 与 `SIGTERM` 进入同一幂等关闭路径。
- 停止接收请求、完成写入并依次关闭 HTTP Server、数据库 Worker 和 App Server。
- 每一步都有明确超时；发送 `SIGKILL` 后仍执行有界等待，超时返回可诊断错误，不无限等待。
