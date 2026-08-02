# 前端状态管理

## Purpose

区分瞬时 UI、HTTP Snapshot 和实时 Agent Event 状态。

## Rules

- 瞬时 UI 状态默认保留在最近组件或功能内。
- HTTP Snapshot 由服务端状态层持有；实时事件按 Task、Turn 和 Item ID 归一化合并。
- 高扇出 React Provider 必须按只读数据、稳定操作和高频活动状态拆分 Context，消费者只通过专用 Hook 订阅所需边界；每个 Provider value 及派生数组、Map 必须保持引用稳定，Mutation Pending 或单个活动状态变化不得使无关数据/操作消费者重新渲染。
- Global settings 与 Project 新 Task 默认设置使用 TanStack Query 独立缓存；Task Snapshot 必须直接携带 Server 校验后的完整 Task 设置。
- Global settings、Project defaults 与 Task settings 只在用户事件中通过原子 `PUT` 更新完整对象；Mutation 按 Global、Project 或 Task 串行，成功后更新对应 Query/Snapshot 缓存。
- 主题偏好属于浏览器本地状态，必须使用版本化存储并在 React 挂载前应用；不得混入 Global settings Query 或服务端持久化。
- Project 排序以 Server 返回的 `ProjectPage` 为长期真相源；拖动中的顺序只保留在 Sidebar Hook。释放后乐观更新 `["projects"]` Query，并通过串行完整顺序 Mutation 校准，失败时恢复提交前的完整页面。
- 有效设置固定按 `Task > Project > Global` 解析；读取回退值不得隐式写入 Project 或 Task 记录。新 Task 创建时固化当时的完整有效设置，不得从其他 Task 继承任何设置。
- Project Task 列表、Task Snapshot、Mutation 和实时订阅必须显式携带 `projectId`；Query Key 与连接状态按 Project 隔离，不能只用 `taskId` 作为跨项目身份。普通 Project Task Infinite Query 只允许为当前路由或侧栏已展开的 Project 激活；当前 Project 即使在侧栏收起也必须保持激活，未展开的非当前 Project 不得在首次加载时发起请求。Project Task 列表使用 Cursor Infinite Query，首屏固定 5 项且只有用户触发“显示更多”才读取单个下一页；归档后必须先移除缓存实体，再重新校准活动 Infinite Query，以服务端新 Cursor 边界补足最近 5 项。搜索使用独立的按 Project 全量 Task Query，仅在搜索词非空时启用，各 Project 可并行、单个 Project 内顺序追踪全部 Cursor；新建、固定、重命名和归档必须同步维护普通列表与已存在的搜索源缓存。
- `sequence` 是 Runtime Session 内的事件顺序依据；断线恢复先刷新 Snapshot，再从检查点补发。
- Client 必须忽略 `sequence <= lastAppliedSequence` 的重复事件，并在更大缺口或 `sessionId` 变化时停止增量应用、请求 resync。
- Delta 可在同一动画帧按 Item 与字段合并，但只能合并相邻同 Key 事件，不得跨其他 Item 重排首次出现顺序；关键事件到达时先按 `sequence` 冲刷所有更早 Delta，再应用完整 Item/Turn 终态。
- `reconnecting`、`resync.required` 和 Session 变化触发 Snapshot refetch；旧订阅、Socket、Timer 和动画帧回调必须在替换或卸载时清理。
- Snapshot 请求错误优先于加载状态展示；WebSocket 成功恢复为 `connected` 后清除上一次连接尝试产生的瞬时错误。
- `provider.error` 标记 `willRetry` 时只作为当前 Turn 的临时提示；后续收到新的 Message、Reasoning 或 Command Delta 即清除。不可重试错误继续保留到权威终态，不能因部分回复或缺少错误文本的终态被覆盖。
- Approval、Error 和 Terminal State 不得因合并或反压丢失。
- `interrupted` Turn 的终态 Payload 可能只包含部分 Item；同 ID 终态实体覆盖流式实体，但缺失的已展示 Item 必须保留，停止操作不得清空已生成回复。
- Pending Request 按 `requestId` 合并 Snapshot 与实时生命周期事件；多个未解决请求按到达顺序展示，仅队首允许提交，重连期间全部暂停提交。Task Store 保留全部活动请求和最近 20 个终态请求，兼容 HTTP Snapshot 重建只输出 `pending`，避免长会话持续扩大状态与 Timeline 遍历量。
- Task Runtime 使用 `zustand/vanilla` 按 `projectId + taskId` 创建独立 Store；Turn、Item 与 Pending Request 必须分别保存有序 ID 和实体映射，Item 实体各自使用独立 Store。
- 文本 Delta 只向目标 Item Store 的 Chunk 列表追加，并在同一事件批次结束后发布一次；不得替换 Task 的稳定 Item Map、既有 Turn、Item 顺序或其他实体引用。Item 组件只订阅对应 Item Store，终态事件再以权威完整字符串替换流式 Chunk。
- 未选中 Task Store 采用 UTF-8 字节估算 LRU 回收：非活动 Store 合计最多 64 MiB、最多 20 份；仍有消费者的 Store 不得回收且不占非活动预算。最后一个消费者释放时从 Project Runtime 注销 Store 并发起 best-effort `thread/unsubscribe`，重新选中后必须从权威 Snapshot 校准，因此运行中、待审批或尚未 Hydrate 的非活动 Store 也可安全进入 LRU。
- Command Output 同时受单 Item 1 MiB / 10,000 行和单 Task 8 MiB 总预算约束；流式 Delta 只重新裁剪和计量目标 Command，总字节数与访问序号使用稳定 Map 按 Item 增量维护，只有超出 Task 预算时才遍历 LRU 索引并回收最久未更新的 Command Output。回收结果使用明确截断标记，界面高度限制不能代替 Payload 字节限制。
- CodeBlock Token Cache 必须使用 24 MiB / 128 Entry 的字节 LRU，单份超过 512 KiB 的源码不进入缓存；Cache Key 只保存摘要并在命中时核验源码，禁止把完整源码直接作为长期 Map Key。
- TanStack Query 全局非活动 `gcTime` 固定为 2 分钟，Task Snapshot 使用 30 秒；非活动完整 Snapshot 另受 48 MiB / 12 Entry 字节 LRU 约束。完整 Snapshot 与归一化 Store 不得同时作为无界长期缓存，归档时必须立即移除对应 Snapshot Query。
- Client HTTP 请求固定使用有界策略：携带 TanStack Query `signal` 的读取同时受调用方取消和 30 秒超时控制，普通直接读取使用 15 秒超时，幂等 Mutation 使用 60 秒超时并允许显式取消；三类请求都必须在 Fetch 边界组合 `AbortSignal.timeout()`。
- 全量 Snapshot 重建只允许用于低频兼容读取、Mutation 输入或恢复边界，不得作为每个 Delta 的 React 订阅结果。
- 每个 Project 只允许一个客户端 Project Runtime 和一条 Event Stream；统一完成协议解析、Session/Sequence 校验，并向 Sidebar Activity 与该 Project 内已注册的 Task Store 扇出。Project Runtime 使用最多 2,048 条、4 MiB 的固定容量环形事件历史，以 O(1) 追加和头部淘汰补齐 Snapshot 读取期间的事件，不得通过 `Array.shift()` 反复移动大数组；历史不足时必须重新读取 Snapshot。
- 每个 Project 只允许一个 Git 状态协调器；任一 Task 运行时每 10 秒执行一次兜底刷新，页面隐藏时跳过周期刷新。完成的 `file_change` Item 触发 300ms 防抖刷新，每个 `turn.completed` 必须最终刷新；最后一个活动 Task 完成后先最终刷新再停止周期调度。同一 Project 的并发刷新必须串行合并，失败后暂停周期调度，直到新活动或手动刷新恢复。
- Sidebar 的轻量活动状态必须按 `projectId + taskId` 保存；切换当前 Task 或 Project 不能清除后台 Task 的运行或审批状态，只有对应 Task 的 Snapshot 或终态事件可以更新该行状态。Project 无 Task Store 消费者、无运行 Task、无待审批且连续 2 分钟未访问后必须关闭 Event Stream 并释放 Runtime；详细 Timeline Store 不得把完整历史复制到 Sidebar 状态。
- Task 归档成功后必须清理 `taskActivity`、最近 Snapshot 恢复引用、非活动 Runtime Store 与 Task Snapshot Query；不可见 Task 收到 `turn.completed` 后再次尝试安全 unsubscribe，避免首次切换时因运行态跳过后永久保留 Thread。
- Composer 只使用 `idle`、`submitting`、`running`、`reconnecting`、`failed` 五种状态；运行态来自活动 Turn，重连态暂停网络 Mutation，失败态保留草稿。
- 同一次用户动作在结果尚未确定前重试时必须复用原 `Idempotency-Key`；输入或目标变化后生成新 Key。
- Turn 撤销的提交、失败和 Idempotency Key 属于对应回复卡片的瞬时状态；同一次撤销重试复用原 Key。撤销成功后主动刷新 Task Snapshot 与 Project Git 状态，因为 Codex 会话回滚不保证产生统一实时事件。
- Git 提交弹窗的文件选择、可编辑 message 和部分成功结果属于瞬时 UI 状态；打开时按路径合并 staged/unstaged 记录并默认全选。生成与提交必须携带当前 Git `snapshot` 和所选路径；提交成功后失效 `['projects', projectId, 'git-status']`，push 失败或未配置 upstream 时保留 commit 成功结果，不得把它展示为整体失败。聚合子仓库模式必须禁用提交入口。
- 创建 Task 后启动首个 Turn；若 Turn 启动失败，保留已创建 Task ID 和原始草稿，重试不得重复创建 Task。只有 Turn 启动成功后才清空草稿。
- `startTask` 返回的 Task 必须立即 upsert 到对应 Project Task Query 并在 Sidebar 选中，不能依赖可能早于 Provider materialize 的抢跑列表刷新；此时保持 Project Composer 和项目级草稿以支持首轮失败重试，首次 `startTurn` 成功后再导航到 Task 路由，并将返回 Turn 作为跨路由短生命周期启动快照。任何 `startTurn` 成功后，若返回 Turn 或后续运行中 Snapshot 尚未包含 User Item，Timeline 必须使用本次提交补齐用户消息，并严格先展示用户消息、再展示“正在思考”；权威 User Item 到达后再无重复地接管展示。
- 首个 Assistant 消息出现时，无论 Task 是否仍为当前路由，都必须立即读取对应 Task Snapshot，并以 Provider 标题或用户消息首行（无文本时使用 Skill、附件名或运行态文案）替换“新聊天”；实时 Delta 已证明 Assistant 开始时，不得因 HTTP Snapshot 暂未包含 Assistant Item 而放弃更新。同一 Turn 的流式 Delta 只触发一次，不能按 Token 重复请求；同一 Task 的流式与终态元数据读取必须串行，不能让终态校准复用尚未结束的旧 Snapshot 请求。任意前台或后台 Task 的 Turn 进入终态后都必须再次刷新对应 Project Task 列表与 Snapshot，以校准 Provider 生成的正式标题，不能依赖用户重新进入该 Task。中栏标题优先使用 Task Query 或活动 Snapshot，不能向用户暴露原生 Task ID。
- 中断请求成功后继续保持运行语义，直到实时链路收到 `turn.completed` 的 `interrupted` 终态。
- 后台终端生命周期独立于 Turn：当前 Task 运行时持续读取权威终端列表，Turn 进入终态时立即补读；只要列表非空就继续轮询并保留右栏展示，直到 Provider 确认终端消失。停止请求成功后必须重新读取列表，不能在点击时乐观删除。
