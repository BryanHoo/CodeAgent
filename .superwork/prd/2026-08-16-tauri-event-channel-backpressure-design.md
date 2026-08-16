# Tauri 事件 Channel 端到端背压设计

## Goal

让 Desktop 事件交付具备可感知 WebView 消费的端到端背压：慢 Renderer 不得把未消费载荷堆进 Tauri 内部无界 `ChannelDataIpcQueue`，并继续复用 Runtime 已有的有界订阅队列与慢订阅者 `resync.required`。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md` — 约束有界队列、性能优先、跨层契约同步。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Event Stream 有界订阅、慢订阅者 resync、Tauri 不得使用全局窗口事件。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Tauri Channel 当前逐帧 JSON 交付、可信内部对象不重复 Schema 校验。
- `.superwork/spec/shared/directory-structure.md` — 约束 `transport-tauri` 与 Runtime 宿主无关边界。
- `.superwork/spec/frontend/state-management.md` — 约束 `sequence` 连续性、`resync.required` 与 Project Runtime 单订阅。

## Existing Context

- Runtime `drive_event_subscription` 对每个最终 frame 等待 `send(frame) -> Future<Output = bool>`。N-API 用 `ThreadsafeFunction` `max_queue_size = 1` 的 `call_async` 真正等待 JS 消费，因此 Node 路径已有端到端背压。
- Desktop `apps/desktop/src-tauri/src/commands/events.rs` 的 `send_frame` 在 `Channel::send` 入队后立即返回；`std::future::ready(...)` 使 Runtime 认为发送已完成。
- `subscriber_capacity: 256` 只限制进入 Tauri 之前的 `mpsc`。该队列被立刻排空时，慢 WebView 无法把它变成背压信号。
- Tauri 2.11.5 对大于 8192 字节的 Channel JSON 先写入内部 `ChannelDataIpcQueue<HashMap<...>>` 再让 JS 异步 fetch，该 Map 无容量上限；小消息走 `eval`，同样没有消费 ACK。
- HTTP WebSocket 已用 `bufferedAmount`：超过 `256 KiB` 记软背压，超过 `1 MiB` 以 `1013` 断开并要求 Snapshot 刷新。
- Runtime 在订阅 `mpsc` 满载时已经把该订阅标为 `ResyncRequired` 并发送 `resync.required`。`event_subscription` 测试证明：只要 `send` Future 不立即完成，该慢订阅者路径就会生效。
- Client `SubscribeAgentEventsOptions` 与 Web Project Runtime 保持宿主无关；HTTP Transport 与 N-API 不在本设计范围内。
- 当前未提交改动已将 Project 事件订阅下沉到 Runtime lease 入口；本设计必须建立在该边界上，不得把 checkpoint/resync 状态机搬回 Tauri。

## Approaches

### A. Channel 轻量通知 + pull command + raw Response（推荐）

Channel 只发送远小于 8192 字节的 `event.available`。前端用 `event_pull { subscriptionId, maxEvents, maxBytes }` 拉取批次；Rust 把 Runtime 已序列化的 frame 以 length-prefixed 字节拼接，经 `tauri::ipc::Response` 返回 `ArrayBuffer`。Tauri 侧有界 mailbox 在入队时挂起 `send` Future。

优点：真正限制 in-flight；大载荷不进入 Channel 无界 Map；符合 Tauri「流用 Channel、大数据用 raw response」；批次摊销 IPC。缺点：相对当前推送多一次 pull RTT；Transport 要解析二进制批次。

### B. 批量 Channel + credit/ACK

Runtime 仍经 Channel 推送批次，前端 `onmessage` 后用 command 归还 credit，严格限制 `in_flight_events` / `in_flight_bytes`。`send` Future 等待 credit。

优点：首包延迟略低。缺点：大于 8192 字节的批次仍进入无界 `ChannelDataIpcQueue`，只能靠「在途最多一批」间接限制；credit 与 Channel fetch 竞态更难测；与官方大数据路径不一致。

### C. 保持逐帧 Channel，仅把 `send` 改成 oneshot ACK

每帧等 JS ACK。实现表面最小，但 IPC 次数最大，大 JSON 仍走无界 Map，无法利用批处理。

## Recommended Approach

采用方案 A。Desktop 把 Channel 降为边沿唤醒，把有界 mailbox 作为 `send` Future 的等待点，使现有 `subscriber_capacity: 256` 和慢订阅者 resync 对 WebView 生效。HTTP 与 N-API 交付不变。

## Component Responsibilities And Interfaces

### Runtime

- 保持 `start_leased_project_event_subscription` 与 `FnMut(Arc<[u8]>) -> Future<Output = bool>`。
- 不解析 Tauri notify/pull，不引入 mailbox 类型。
- 当 Tauri `send` 因 mailbox 满而挂起时，订阅任务停止 `recv()`；上游 `mpsc` 满载后继续发出 `resync.required`。

### Desktop mailbox

新建 `apps/desktop/src-tauri/src/event_mailbox.rs`，由 `commands/events.rs` 使用，不进入 Runtime。`EventMailboxRegistry` 作为 `tauri::State` 注册；`lifecycle.shutdown` 在 Runtime 关闭前 `close_all()`，避免 `admit` 等待者在退出时挂起。

- 每个 `subscriptionId` 一个 mailbox，保存 `Arc<[u8]>` frame 引用，不重新 JSON 序列化。
- 容量与 HTTP 软阈值对齐：`MAILBOX_MAX_EVENTS = 64`、`MAILBOX_MAX_BYTES = 256 KiB`。
- 单 frame 超过字节预算时仍必须入队恰好一帧，避免 1 MiB 上限事件永久卡住。
- `admit(frame)`：有空位则入队并返回 `true`；满则等待；关闭、取消或发送失败返回 `false`。
- `pull(max_events, max_bytes)`：最多取出调用方预算，且至少一帧（若非空）。
- 关闭必须唤醒全部 `admit` 等待者为 `false`，并拒绝后续 pull。
- 命令参数与现有 Desktop 命令一致，使用 `rename_all = "camelCase"`。

### Tauri commands

`event_subscribe` 仍接收 Channel，但 Channel 载荷改为固定小结构：

```json
{ "type": "event.available" }
```

该对象必须保持远小于 8192 字节，只走 eval 路径。Channel 已按本次 subscribe 作用域隔离，通知不携带业务 frame。

通知合并：

- mailbox 从空变为非空，且当前没有未确认通知时，发送一次 `event.available`。
- `event_pull` 开始时清除未确认标记。
- `event_pull` 结束后若 mailbox 仍非空，再发送一次。
- 任意时刻每个订阅最多一个未完成 Channel 发送。

新增 `event_pull`：

- 输入：`subscriptionId`、`maxEvents`、`maxBytes`。
- 服务端钳制：`maxEvents ∈ [1, 64]`，`maxBytes ∈ [1, 256 KiB]`；缺省分别为 `64` 与 `256 KiB`。
- 输出：`tauri::ipc::Response` / `InvokeResponseBody::Raw`，不是 JSON envelope。
- 二进制布局（little-endian）：
  - `u32 magic = 0x43414550`（`CAEP`）
  - `u32 frame_count`
  - 重复 `frame_count` 次：`u32 frame_len` + `frame_len` 字节的 Runtime UTF-8 JSON frame
- 空 mailbox 返回 `frame_count = 0` 的合法头，不报错。
- 未知或已关闭订阅返回稳定 `CommandError`（`NotFound`，`retryable: false`）。

`event_unsubscribe` 取消 Runtime 订阅并关闭、移除 mailbox。Runtime 关闭路径必须清空全部 mailbox。

`send` 闭包变为 `mailbox.admit(frame)`，不得再 `std::future::ready(channel.send(json_frame))`。

### Tauri Transport

`packages/transport-tauri/src/event-subscription.ts`：

- `event_subscribe` 后 Channel 只监听 `event.available`。
- 单飞 pull：同一时刻最多一个 `event_pull`。
- 收到通知或 pull 返回非空且打满预算时继续 pull；空批次且无待处理通知时回到等待。
- 将 raw 结果归一成 `Uint8Array`（兼容 `ArrayBuffer` / `Uint8Array` / `number[]`），校验 magic 与长度，再按帧 `JSON.parse`。
- 解析后的对象仍视为 Runtime 已校验的可信内部消息：不跑 `EventStreamMessageSchema`。`onEvent` 的 `wireBytes` 传该帧 `frame_len`。
- `connection.ready`、连续事件、`resync.required`、本地 session/gap 检查保持现有语义。
- 卸载或 resync 必须取消 in-flight pull（`AbortSignal` 或忽略过期响应）并调用 `event_unsubscribe`。

`SubscribeAgentEventsOptions` 与 `apps/web` Project Runtime 不改。

### 指标

不扩展 HTTP `EventStreamMetricsResponse`。Desktop 慢客户端改由 Runtime `queueHighWaterMark` 与 `slowSubscribers` 体现；mailbox 高水位只留在 Rust 单元测试断言，不进入公开 metrics Schema。

## Data Flow

1. Runtime 发布 frame → 订阅任务 `admit` 到 mailbox。
2. mailbox 空到非空 → 发送一次 `event.available`。
3. Renderer pull → 复制已序列化字节到 raw Response → 释放 mailbox 名额 → 唤醒等待中的 `admit`。
4. Renderer 按 `sequence` 应用到 Project Runtime。
5. 若 Renderer 停止 pull，mailbox 填满 → `admit` 挂起 → Runtime `mpsc` 升至 256 → `resync.required` 进入 mailbox → 下一次 pull 或关闭时交付。

## Error Handling

- Channel `send` 失败：关闭 mailbox，使后续 `admit` 返回 `false`，订阅任务退出。
- pull 解析失败（magic、截断、非 UTF-8、非法 JSON）：Transport 走现有 `onError` 并 unsubscribe，要求 Snapshot 恢复。
- 过期 pull 响应（unsubscribe 后返回）：丢弃。
- `resync.required` 不得因字节预算被丢弃：它作为普通 frame 入队；超预算时仍按「至少一帧」规则交付。
- 命令错误继续使用稳定 `code`、`message`、`retryable`、`correlationId`；Transport 不得改写底层消息。

## Verification Strategy

- Desktop Rust：mailbox 满时 `admit` 等待、pull 唤醒、单帧超预算仍入队、关闭唤醒等待者为 `false`、通知合并（空到非空只唤醒一次）、`event_pull` 钳制预算。
- `packages/transport-tauri`：ready → 事件 → unsubscribe；通知触发单飞 pull；打满预算后续拉；空批次停止；raw 帧 `wireBytes`；本地 gap / 服务端 resync；卸载取消 in-flight pull。
- 更新 `tests/tauri-phase-5.test.ts`：禁止 Channel 发送业务 JSON frame；要求 `event_pull`、`InvokeResponseBody::Raw` 或 `ipc::Response`、mailbox 有界常量。
- 保留 Runtime `event_subscription_should_prioritize_resync_when_live_queue_overflows`。
- 最终：`pnpm check`、`pnpm check:rust`。不改 HTTP 事件性能测试。

## Non-Goals

- 不改变 HTTP WebSocket 或 N-API callback 交付。
- 不把 mailbox 或 pull API 提升为 Protocol / Client 公共契约。
- 不使用全局 `emit` / `listen`。
- 不在 Channel 上发送业务事件或 credit 数字。
- 不引入第二套 sequence / checkpoint 状态机。
- 不在本轮扩展公开 Event Stream metrics Schema。
- 不修改 Web Timeline 合并或 Snapshot 恢复状态机。

## Success Criteria

- 慢 WebView 下，Tauri 内部 Channel 数据 Map 每个订阅最多一条小通知，业务载荷只存在 Runtime `mpsc` + 64 事件 / 256 KiB mailbox。
- `Channel::send` 的 Future 完成不再表示 WebView 已消费业务事件。
- 前端仍按 `connection.ready`、连续 `sequence`、`resync.required` 工作，Client 与 Web 订阅入口不变。
- 批次 raw Response 不把 Runtime frame 再编码成 JSON 数组或 `number[]` 业务信封。
- 规范已更新为 notify + pull，不再要求 Channel 逐帧交付 `EventStreamMessage`。
