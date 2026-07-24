# 前端状态管理

## Purpose

区分瞬时 UI、HTTP Snapshot 和实时 Agent Event 状态。

## Rules

- 瞬时 UI 状态默认保留在最近组件或功能内。
- HTTP Snapshot 由服务端状态层持有；实时事件按 Task、Turn 和 Item ID 归一化合并。
- `sequence` 是 Runtime Session 内的事件顺序依据；断线恢复先刷新 Snapshot，再从检查点补发。
- Client 必须忽略 `sequence <= lastAppliedSequence` 的重复事件，并在更大缺口或 `sessionId` 变化时停止增量应用、请求 resync。
- Delta 可在同一动画帧按 Item 与字段合并，但只能合并相邻同 Key 事件，不得跨其他 Item 重排首次出现顺序；关键事件到达时先按 `sequence` 冲刷所有更早 Delta，再应用完整 Item/Turn 终态。
- `reconnecting`、`resync.required` 和 Session 变化触发 Snapshot refetch；旧订阅、Socket、Timer 和动画帧回调必须在替换或卸载时清理。
- Snapshot 请求错误优先于加载状态展示；WebSocket 成功恢复为 `connected` 后清除上一次连接尝试产生的瞬时错误。
- Approval、Error 和 Terminal State 不得因合并或反压丢失。
- Pending Request 按 `requestId` 合并 Snapshot 与实时生命周期事件；多个未解决请求按到达顺序展示，仅队首允许提交，重连期间全部暂停提交。
- 在真正引入状态库前，不预先创建抽象 Store 或空 Slice。
- Timeline 与 Composer 必须共享同一个 Task Runtime 订阅，不能为同一 Task 重复建立 Snapshot Query 和 WebSocket 链路。
- Composer 只使用 `idle`、`submitting`、`running`、`reconnecting`、`failed` 五种状态；运行态来自活动 Turn，重连态暂停网络 Mutation，失败态保留草稿。
- 同一次用户动作在结果尚未确定前重试时必须复用原 `Idempotency-Key`；输入或目标变化后生成新 Key。
- Turn 撤销的提交、失败和 Idempotency Key 属于对应回复卡片的瞬时状态；同一次撤销重试复用原 Key。撤销成功后主动刷新 Task Snapshot 与 Project Git 状态，因为 Codex 会话回滚不保证产生统一实时事件。
- 创建 Task 后启动首个 Turn；若 Turn 启动失败，保留已创建 Task ID 和原始草稿，重试不得重复创建 Task。只有 Turn 启动成功后才清空草稿。
- 中断请求成功后继续保持运行语义，直到实时链路收到 `turn.completed` 的 `interrupted` 终态。
