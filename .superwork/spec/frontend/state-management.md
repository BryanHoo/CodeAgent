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
- 在真正引入状态库前，不预先创建抽象 Store 或空 Slice。
