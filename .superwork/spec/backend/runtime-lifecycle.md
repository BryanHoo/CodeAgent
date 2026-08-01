# 运行时生命周期

## Codex App Server

- 默认使用长驻 `codex app-server --listen stdio://`，不为每个 Turn 创建进程；允许 Codex 忽略其版本尚未识别的前向配置字段，避免 Desktop 与打包 CLI 的配置版本差异阻断启动。
- CLI 启动 App Server 时不绑定 Project `cwd`；全局 `CodexRuntimeProvider` 只注册一次 RPC Notification 与 Server Request Listener，并维护 `taskId -> projectId/cwd` 归属映射。
- 用户必须先通过官方 Codex CLI 在相同 `CODEX_HOME` 中完成登录；CodeAgent 不调用 Account API，也不读取、修改或复制认证文件。
- 包内 Codex 必须解析平台可选依赖中的原生 `codex`/`codex.exe`，不得把会再次派生子进程的 JS launcher 作为受管 App Server 进程。
- 使用参数数组、`shell: false` 和经过控制的环境变量；Secret 不进入参数或日志。
- 所有 RPC 设置超时；子进程退出时统一 Reject Pending RPC，并清理 Listener。
- App Server 初始化必须启用 experimental API；后台终端只通过 `thread/backgroundTerminals/list` 获取，并在 Provider 边界把原生 `processId` 映射为不透明 Terminal ID。停止单个终端固定调用 `thread/backgroundTerminals/terminate`，不能用 `turn/interrupt` 代替。
- JSONL 字节流必须跨 Buffer 分片保留 UTF-8 解码状态，不得逐块独立转码。
- JSONL 中同时包含 `id` 与 `method` 的合法帧按服务端请求分发，并使用原 `id` 返回结果；未支持的方法返回 `-32601`，非法参数返回 `-32602`，不得让 Codex 无限等待。
- Provider 丢弃未知 Notification 或隔离单条字段映射失败时必须通过 Pino 告警，固定记录 `diagnosticCode`、method、Codex version、Project ID 和可提取的 Task ID；禁止记录原始 params、Prompt、命令输出或文件正文。
- JSONL 响应只有在底层写入回调确认后才算成功，所有写入都使用有界超时；异步写入失败必须关闭连接且不能提前发布请求终态。
- 过载错误使用带 jitter 的有上限指数退避，不做同步密集重试。
- Task/Turn 写入只通过 `thread/start`、`turn/start`、`turn/steer` 和 `turn/interrupt` 映射；文本输入必须转换为当前 Codex Schema 要求的 `UserInput[]`，Provider 不向上泄漏原生字段。
- `turn/steer` 只允许写入当前 Task 的活动 Turn，必须传递 `expectedTurnId` 且不能携带模型、思考量或审批等 Turn 设置覆盖；Provider 必须校验响应 `turnId` 与预期 Turn 一致。
- Server 内部生成 Git commit message 时，必须启动一次隐藏的结构化 Turn，将受限长度的选中文件 diff 作为不可信数据传入，并固定使用 `read-only`、`never` 和 `{ message }` `outputSchema`。最终 assistant message 必须从独立 `item.completed` 事件收集，`turn.completed` 只作为终态信号，不能假设其重复携带完整 items。Codex 不执行 Git Mutation；Turn 完成、失败或超时都必须移除监听器，并 best-effort 中断、归档和取消订阅隐藏 Thread。
- App Server 重启后，从 `thread/list` 或 `thread/read` 重新发现的持久化 Task 在首次 `turn/start` 前必须调用一次 `thread/resume`；同一进程内由 `thread/start` 或 `thread/fork` 创建的已加载 Task 不得重复恢复，并发续写必须复用同一个恢复 Promise。
- `agentMessage.phase` 中的 `commentary` 与 `final_answer` 都必须映射为 Assistant Message，并通过 `message.delta` 实时交付；原生 `reasoning` Item 仍映射为统一 Reasoning Item，但 Web 不展示其内容。
- Codex 协作 Item 的 `item/started` 必须映射为统一 `item.started` 实时事件，不能丢弃长时间运行的子代理操作；协作 Item 必须保留子代理任务、模型、思考量和代理状态，并使用 Provider 无关的 `agent/*` Tool 名称。普通消息和命令继续使用专用 Delta，不重复交付空的 Started Item。
- 子代理使用独立 Codex Thread。Web 按需读取父协作 Item 的 receiver Task ID 时，Runtime 必须先以 Project 归属暂存该 Thread，`thread/read` 验证 `cwd` 后同时确认 Runtime Owner 与 Project Provider Task 集合，再交付读取期间暂存的通知；这样弹窗关闭后可以停止浏览器订阅，再次打开时从最新 Snapshot checkpoint 继续，未知 Project 的子线程事件仍必须丢弃。
- `thread/start` 返回的新 Task 在首条用户消息前可能尚未 materialize；此时 `thread/read(includeTurns: true)` 的明确未 materialize 错误必须映射为该已知 Task 的空闲空快照，未知 Task 和其他 RPC 错误不得被吞掉。
- Provider 对已成功 `thread/start` 的 Task 必须提供进程内 read-your-writes：在 Codex 原生 `thread/list` 首次返回该 Task 前，将本地未 materialize Task 合并到首个列表页；只有原生列表接管后才能移除该列表回退，`turn/start` 或 `thread/read` 成功不能提前造成列表不可见窗口。
- Task 命令通过受控 Provider 方法映射：代码审查使用 `review/start`，上下文压缩使用 `thread/compact/start`，新任务续接使用 `thread/fork`，任务反馈使用 `feedback/upload`；每个动作都必须先验证 Task 属于当前 Project，并校验响应中的 Thread ID。Review Turn 中 Codex 自动生成的 `userMessage` 只作为内部执行 Prompt，Provider 必须在响应、实时事件和历史 Snapshot 中将重复 Prompt 折叠为单个统一 `review` Item。
- Task 重命名固定映射 `thread/name/set`，归档固定映射 `thread/archive`，两者都必须先验证 Task 属于当前 Project；固定状态不是 Codex 原生能力，由 CodeAgent 本地 Task 元数据持久化。
- 模型列表只通过分页 `model/list` 获取，过滤隐藏模型并保留默认模型、默认思考量和可用思考量；Server Runtime 使用带 TTL、字节容量与 in-flight 去重的模型目录缓存统一服务设置校验和 `/v1/models`，Runtime 关闭时清空且旧请求不得回填；Project 沙盒默认值通过携带 `cwd` 的 `config/read` 读取；`turn/start` 明确映射文本、受控图片 Data URL、`model`、`effort`、`approvalPolicy`、`approvalsReviewer` 和结构化 `sandboxPolicy`。自动审批使用 `on-request + auto_review`，不扩展沙盒边界。
- Codex 用户历史中的 `image` 与 `localImage` 必须映射为只含随机 ID、媒体类型、名称和字节数的统一消息附件；Provider 只接受 GIF、JPEG、PNG、WebP 的有效内容签名和不超过 2 MiB 的图片。同一 Task 中来源、名称和内容状态未变化的图片必须在重复 `thread/read` 间复用当前随机授权 ID 并刷新 TTL，后续 Snapshot 读取不得让已交付页面的附件 URL 立即失效；TTL 到期、来源变化或 Task 释放时才清理对应授权。Snapshot 不得包含 Base64 或本地路径；本地文件正文只在受权读取时加载并复验大小、修改时间和内容签名。文件缺失、超限、格式不受支持或历史附件 Store 达到预算时降级为文本占位，不能使整个 Task Snapshot 失败。
- Project Skill 目录只通过 `skills/list { cwds: [project.rootPath] }` 获取并过滤禁用项；对外 ID 必须是稳定不透明摘要。`turn/start` 只有在 ID 与名称仍匹配当前目录时，才能加入 Codex 原生 `{ type: "skill", name, path }`，原生绝对路径不得越过 Provider 边界。
- 当前 Project 启用的 MCP 服务只通过携带 `cwd` 的 `config/read` 读取 `mcp_servers`；Provider 必须过滤 `enabled: false` 并只向 Core、Protocol 和 Web 暴露服务名称，禁止让 command、args、env、URL 或 Secret 越过 Provider 边界。
- `thread/tokenUsage/updated` 只使用最近一轮 `last.totalTokens` 计算当前上下文占用，并连同 `modelContextWindow` 写入实时事件和后续 Snapshot；不得使用累计 `total.totalTokens` 冒充当前上下文。
- Web 最后一个 Task Runtime 消费者释放或不可见 Task 完成后，通过 Provider 无关 `unsubscribeTask` 端口调用实验 `thread/unsubscribe`。只有无运行 Turn、无 Pending Request、无后台终端、无读取或恢复 Promise 时才允许原生释放；`busy`、`notLoaded`、`notSubscribed` 与 `unsubscribed` 都是可恢复的 best-effort 生命周期结果，不能阻断导航。
- `thread/unsubscribe` 成功或确认未加载后，Codex Provider 必须同步删除该 Task 的 Owner、Context Usage、运行标记、恢复状态、历史附件授权、暂存事件、暂存 Server Request、终态 Request 和未 materialize 回退；重新打开时通过 `thread/read` 重新验证 Project 归属并建立状态。Task 级 Map 禁止只增不减。
- `turn/interrupt` 响应只确认中断请求已接收；`turn/completed` 的 `interrupted` 状态才是 Turn 终态，Server 和 Web 不得提前伪造完成状态。
- 非重试 `provider.error` 已确认的错误原因不能被随后缺少错误文本的 `turn/completed` 清除；Web Runtime 合并终态时必须保留该失败原因，允许已产生的部分回复与错误共同展示。
- `thread/rollback` 只用于撤销当前 Task 的最新已完成 Turn，并固定 `numTurns: 1`；它只修改 Codex 会话历史，不能视为本地文件恢复。Server 必须先对当前 Project 内受控文本补丁执行反向预检并恢复文件，再调用 Provider；Provider 失败时正向补偿文件，补偿失败返回明确冲突，禁止路径越界、`.git`、二进制和同文件多段依赖补丁。
- Codex Server Request 只有在 Task 已通过当前 Project 归属验证后才能进入可解决集合；读取期间到达的请求先暂存，原生终态到达时立即清理，归属验证成功后再提升，其他 Project 的请求直接丢弃；归属已确认后即使 Snapshot 映射失败，也不得删除仍在等待响应的请求。
- Pending Request 在本地解决、原生 `serverRequest/resolved` 或 Turn 终止时只产生一次终态；Snapshot 不保留 `resolved` 或 `expired` 请求。
- 带 `autoResolutionMs` 的 User Input 到期时使用空答案响应 Codex 并发布 `expired` 终态；手动响应写入失败不得取消自动过期，只有响应确认成功或其他终态才能清理对应定时器。

## Server 与持久化

- Fastify 资源通过插件封装，并在 `onClose` 中释放。
- 普通 HTTP 路由使用 Fastify 原生 60 秒 `handlerTimeout` 和 `request.signal` 执行协作取消；Event Stream WebSocket 是显式长连接，不继承 Handler 截止时间，其有界性由队列、背压和连接关闭生命周期保证。
- Project 列表默认空，通过宿主系统目录选择器注册，并持久化到 `CODEX_HOME/code-agent/state.sqlite3`；重复真实路径幂等返回已有 Project。
- 已激活的 Project Runtime Context 必须先从进程内缓存解析，只有缓存未命中时才读取 Project Repository。Project 重命名成功后同步刷新缓存中的展示信息；Project 删除成功后必须释放事件订阅和 Context 缓存，后续访问重新读取 Repository 并返回资源不存在，不能复用已删除 Runtime。
- Project 与 Codex Thread 的 `cwd` 归属必须按真实路径比较；Windows 路径忽略大小写，Linux 符号链接解析到同一实体，不能仅比较原始路径字符串。
- Linux 系统目录选择器在某个桌面启动器缺失或无法连接桌面会话时必须继续尝试下一个启动器，全部不可用后再回退终端输入；用户取消选择不得触发回退。
- 浏览器与外部应用启动必须观察短时退出结果；启动器快速非零退出视为失败，Linux 浏览器按候选顺序继续回退，不能在仅收到子进程 `spawn` 事件后报告成功。Windows `explorer.exe` 是系统请求转交器，成功 `spawn` 后不得用代理进程随后的退出码误报失败；Windows Terminal 固定使用 `-w new -d <projectRoot>` 打开独立新窗口，不受用户 `windowingBehavior` 设置影响。
- 数据库使用版本化 Migration、`STRICT` 表、显式 SQL、Prepared Statement 和事务，并固定启用 WAL、外键、NORMAL synchronous 与 5000ms busy timeout。
- 所有同步 SQLite 操作都放入专用 `worker_threads` Worker，Fastify 主事件循环只通过 Core Repository 端口异步调用。
- Global settings 以单例记录保存完整审批策略、审批审核方、模型、思考量、沙盒模式、默认跟进行为与默认打开应用；默认跟进行为只允许 `queue` 或 `steer`，新记录与迁移记录固定使用 `queue`。Project defaults 保存模型、思考量与沙盒模式；Task settings 保存完整运行设置。有效值固定按 `Task > Project > Global` 解析并按实时模型目录校验；读取推导值不得隐式写入局部记录，新 Task 创建和 Turn 启动时才固化完整 Task settings。
- `task_metadata` 只保存 Project 作用域的 Task 固定状态；Task 列表与 Snapshot 在 Server 交付边界合并该状态，不修改 Codex Thread 内容。
- Provider 模型目录、`allow_for_session` 和可操作 Pending Approval 不得持久化；进程重启后不得恢复可操作 `pending`。
- WebSocket 客户端使用独立有界队列，慢客户端不能阻塞 Provider；`bufferedAmount` 超过 `256 KiB` 时向 Event Stream 发出软背压信号，超过 `1 MiB` 时以 `1013` 关闭连接并要求刷新 Snapshot。
- 每个 Project 创建独立 Event Stream Session，Provider 不分配传输序号。Server 在分配单调 `sequence` 前，按 `taskId + turnId + itemId + type + field` 合并 `message.delta`、`reasoning.delta` 和 `command.output_delta`：普通窗口固定为 `16ms`，收到软背压信号后的下一窗口固定为 `32ms`。
- 非 Delta 事件、Snapshot checkpoint、事件回放和 Runtime 关闭前必须立即冲刷所有更早 Delta；不同 key 按首次进入窗口的顺序分配连续 `sequence`，关键终态不得越过待发送 Delta。
- Event Stream 使用固定数组环形缓冲区，以 O(1) 写入和淘汰已发布事件；回放必须按 `sequence` 升序返回，窗口外恢复仍发送 `resync.required`。
- `/v1/projects/:projectId/events` 首帧发送 `connection.ready`，只补发 `afterSequence` 之后仍在缓存窗口内的事件；过期或超前序号发送 `resync.required`。
- `/v1/metrics/events` 只读暴露每个 Project 的 Provider 输入、发布、合并、pending Delta、保留淘汰、软背压、活动客户端和慢客户端断开计数，不得包含 Prompt、命令输出或文件内容。
- Provider `readTask` Promise 完成前必须让返回 Snapshot 包含此前状态并同步交付对应通知；Task Snapshot 读取完成后再从当前 Event Stream 固定 checkpoint，避免丢失事件或重复补发已有内容；Task 归属确认后并行读取有效设置与固定元数据，避免无依赖的持久层读取串行等待。
- `resync.required` 发送后由 Server 主动关闭当前 WebSocket；客户端必须使用新 Snapshot checkpoint 建立新连接。
- Fastify 关闭时取消 Provider Event 订阅并关闭 WebSocket 资源。
- 所有 Agent Mutation 必须校验非空 `Idempotency-Key`；同操作、同 Key、同 Payload 复用进行中或成功结果，不同 Payload 返回冲突，失败结果不缓存。
- Git message 生成与 commit/commit+push 同样必须使用 `Idempotency-Key` 并复验 `expectedSnapshot`；每个 Project 同时只允许一个 Git Mutation，冲突请求返回稳定错误。用户 message 原样交给 Git，Codex 生成只提供可编辑候选。
- Git Working Tree 状态、分支和 diff 等后台只读子进程必须继承受控环境并设置 `GIT_OPTIONAL_LOCKS=0`，避免周期读取刷新索引或争用可选锁；Git Mutation 不得复用该环境约束。
- 后台终端读取必须先验证 Project/Task 归属；已持久化但未加载到当前 App Server 的历史 Task 将原生 `-32600 thread not found` 归一化为空终端列表，其他 Provider 错误继续上抛；单终端停止是幂等 Mutation，即使进程在请求到达前自然退出也返回已终止语义。
- Task 创建在 Provider 成功但设置持久化失败时必须保留有界恢复状态；同 `Idempotency-Key` 重试只补齐持久化，不得再次调用 Provider 创建 Task。
- 成功的幂等结果缓存必须同时设置容量上限和过期时间；进行中的请求不得淘汰，Runtime 关闭时清空全部条目。
- 任何新增 Task Runtime、Snapshot、历史或终端缓存都必须同时声明按字节容量、Entry 次级上限和明确清理触发点；不得依赖框架默认 TTL 或无界模块级 Map。
- 浏览器图片与粘贴文本附件先经幂等上传进入 Server 的有界 TTL Store，并只返回随机 ID；文本附件必须严格解码 UTF-8，Provider 将其映射为独立 Codex `text` UserInput，并用覆盖完整 UTF-8 字节范围的 `text_elements` 和文件名表达附件占位；Turn 成功后消费引用，Provider 失败时保留引用供同一请求重试，Runtime 关闭时清空 Store。

## 关闭

- `SIGINT` 与 `SIGTERM` 进入同一幂等关闭路径。
- 停止接收请求、完成写入并依次关闭 HTTP Server、数据库 Worker 和 App Server。
- 每一步都有明确超时；发送 `SIGKILL` 后仍执行有界等待，超时返回可诊断错误，不无限等待。
