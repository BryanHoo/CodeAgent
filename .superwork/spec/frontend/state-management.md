# 前端状态管理

## Purpose

区分瞬时 UI、HTTP Snapshot 和实时 Agent Event 状态。

## Rules

- 瞬时 UI 状态默认保留在最近组件或功能内。
- HTTP Snapshot 由服务端状态层持有；实时事件按 Task、Turn 和 Item ID 归一化合并。
- Project 新 Task 默认模型设置使用 TanStack Query 独立缓存；Task Snapshot 必须直接携带 Server 校验后的完整 Task 设置。
- Project defaults 与 Task settings 只在用户事件中通过原子 `PUT` 更新完整对象；Mutation 按 Project 或 Task 串行，成功后更新对应 Query/Snapshot 缓存。
- Project 排序以 Server 返回的 `ProjectPage` 为长期真相源；拖动中的顺序只保留在 Sidebar Hook。释放后乐观更新 `["projects"]` Query，并通过串行完整顺序 Mutation 校准，失败时恢复提交前的完整页面。
- 新 Task 草稿只继承 Project 的模型、思考量与沙盒模式，审批始终初始化为 `on-request`，不得从其他 Task 继承 `never`。
- Project Task 列表、Task Snapshot、Mutation 和实时订阅必须显式携带 `projectId`；Query Key 与连接状态按 Project 隔离，不能只用 `taskId` 作为跨项目身份。Project Task 列表使用 Cursor Infinite Query，首屏固定 5 项且只有用户触发“显示更多”才读取单个下一页；归档后必须先移除缓存实体，再重新校准活动 Infinite Query，以服务端新 Cursor 边界补足最近 5 项。搜索使用独立的按 Project 全量 Task Query，仅在搜索词非空时启用，各 Project 可并行、单个 Project 内顺序追踪全部 Cursor；新建、固定、重命名和归档必须同步维护普通列表与已存在的搜索源缓存。
- `sequence` 是 Runtime Session 内的事件顺序依据；断线恢复先刷新 Snapshot，再从检查点补发。
- Client 必须忽略 `sequence <= lastAppliedSequence` 的重复事件，并在更大缺口或 `sessionId` 变化时停止增量应用、请求 resync。
- Delta 可在同一动画帧按 Item 与字段合并，但只能合并相邻同 Key 事件，不得跨其他 Item 重排首次出现顺序；关键事件到达时先按 `sequence` 冲刷所有更早 Delta，再应用完整 Item/Turn 终态。
- `reconnecting`、`resync.required` 和 Session 变化触发 Snapshot refetch；旧订阅、Socket、Timer 和动画帧回调必须在替换或卸载时清理。
- Snapshot 请求错误优先于加载状态展示；WebSocket 成功恢复为 `connected` 后清除上一次连接尝试产生的瞬时错误。
- Approval、Error 和 Terminal State 不得因合并或反压丢失。
- `interrupted` Turn 的终态 Payload 可能只包含部分 Item；同 ID 终态实体覆盖流式实体，但缺失的已展示 Item 必须保留，停止操作不得清空已生成回复。
- Pending Request 按 `requestId` 合并 Snapshot 与实时生命周期事件；多个未解决请求按到达顺序展示，仅队首允许提交，重连期间全部暂停提交。
- Task Runtime 使用 `zustand/vanilla` 按 `projectId + taskId` 创建独立 Store；Turn、Item 与 Pending Request 必须分别保存有序 ID 和实体映射。
- 文本 Delta 只替换目标 `itemsById[itemId]`，不得替换既有 Turn、Item 顺序或其他实体引用；Timeline 根节点只订阅 Turn/Pending ID，Item 组件按 `itemId` 原子订阅。
- 未选中 Task Store 采用 LRU 回收；仍有消费者的 Store 不得回收。最后一个消费者释放时同步关闭实时传输，重新选中后必须从权威 Snapshot 校准，因此运行中、待审批或尚未 Hydrate 的非活动 Store 也可安全进入 LRU。
- 全量 Snapshot 重建只允许用于低频兼容读取、Mutation 输入或恢复边界，不得作为每个 Delta 的 React 订阅结果。
- Timeline 与 Composer 必须共享同一个 Task Runtime 订阅；同一 `projectId + taskId + checkpoint` 的多个消费者复用单一 WebSocket 链路，最后一个消费者释放后再关闭连接。
- Sidebar 的轻量活动状态必须按 `projectId + taskId` 保存，并通过已访问 Project 的常驻 Event Stream 更新；切换当前 Task 或 Project 不能清除后台 Task 的运行或审批状态，只有对应 Task 的 Snapshot 或终态事件可以更新该行状态。详细 Timeline Runtime 仍只服务当前 Task，不得把完整历史复制到 Sidebar 状态。
- Composer 只使用 `idle`、`submitting`、`running`、`reconnecting`、`failed` 五种状态；运行态来自活动 Turn，重连态暂停网络 Mutation，失败态保留草稿。
- 同一次用户动作在结果尚未确定前重试时必须复用原 `Idempotency-Key`；输入或目标变化后生成新 Key。
- Turn 撤销的提交、失败和 Idempotency Key 属于对应回复卡片的瞬时状态；同一次撤销重试复用原 Key。撤销成功后主动刷新 Task Snapshot 与 Project Git 状态，因为 Codex 会话回滚不保证产生统一实时事件。
- 创建 Task 后启动首个 Turn；若 Turn 启动失败，保留已创建 Task ID 和原始草稿，重试不得重复创建 Task。只有 Turn 启动成功后才清空草稿。
- `startTask` 返回的 Task 必须在导航前 upsert 到对应 Project Task Query，不能依赖可能早于 Provider materialize 的抢跑列表刷新；首次 `startTurn` 返回的 Turn 可作为跨路由短生命周期启动快照。任何 `startTurn` 成功后，若返回 Turn 或后续运行中 Snapshot 尚未包含 User Item，Timeline 必须使用本次提交补齐用户消息，并严格先展示用户消息、再展示“正在思考”；权威 User Item 到达后再无重复地接管展示。
- 首个 Assistant 消息出现时必须立即以用户消息首行（无文本时使用 Skill、附件名或运行态文案）替换“新聊天”；活动 Turn 从运行态进入终态后继续刷新对应 Project Task 列表，以同步 Provider 生成的正式标题。中栏标题优先使用 Task Query 或活动 Snapshot，不能向用户暴露原生 Task ID。
- 中断请求成功后继续保持运行语义，直到实时链路收到 `turn.completed` 的 `interrupted` 终态。
- 后台终端生命周期独立于 Turn：当前 Task 运行时持续读取权威终端列表，Turn 进入终态时立即补读；只要列表非空就继续轮询并保留右栏展示，直到 Provider 确认终端消失。停止请求成功后必须重新读取列表，不能在点击时乐观删除。
