# Event Hot Path Implementation Plan

**Goal:** 用 10,000 个代表性真实协议帧量化并消除浏览器事件热路径中的重复深遍历，同时保留网络边界严格校验。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、性能与验证流程
- `.superwork/spec/frontend/state-management.md` — 约束 Project Runtime 历史容量和实时事件路径
- `.superwork/spec/frontend/quality-guidelines.md` — 约束浏览器性能门禁与测试方式
- `.superwork/spec/frontend/type-safety.md` — 约束网络边界运行时校验
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Transport 与 Web 依赖方向
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Agent Event Schema 单一来源和严格校验

**Architecture:** 先用现有 `JSON.parse + Value.Check + ProjectEventHistory.append` 建立分段基线；确认校验和容量估算是显著成本后，从 TypeBox union Schema 自动生成按事件 `type` 分派的唯一分支校验器，并让 Transport 在交付事件时附带原始 wire UTF-8 字节数，History 以 O(1) 元数据计量。当前 TypeBox runtime compiler 依赖动态 `Evaluate/new Function`，与生产 CSP 冲突，因此只有 Schema 分派未达到预算时才引入构建期静态编译产物。Tauri 等可信内部 Transport 不重复执行网络边界校验，未提供 wire 字节数时保留保守估算兜底。

**Tech Stack:** TypeScript、TypeBox、Vitest、pnpm

## Global Constraints

- 单文件不得超过 500 行，热路径实现以性能优先。
- 网络进入浏览器状态层前必须完成严格 Schema 校验。
- TypeBox Schema 是协议单一来源，不维护手写的第二套结构校验规则。
- 所有 Python 命令使用 `python3`，项目命令使用 `pnpm`。
- 不启动开发服务器。

### Task 1: 建立 10,000 帧分段微基准

**Files:**

- Create: `apps/web/src/features/conversation/runtime/event-hot-path.performance.test.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `tests/performance-budgets.json`

**Interfaces:**

- Consumes: `EventStreamMessageSchema`、`ProjectEventHistory.append`
- Produces: 语义等同当前 `Value.Check` 的 `checkEventStreamMessage` 基线入口，以及 10,000 帧 `parse`、`validate`、`append` 分段耗时与完整流水线基线

**Behavior:**

- 使用现有协议测试和实时 fixture 覆盖的代表性事件形态构造已序列化 wire 帧，固定执行 10,000 次并验证全部帧通过现有边界校验和进入有界历史。
- 记录各阶段耗时；仅当 `validate + append` 占完整流水线耗时至少 20%，或任一阶段超过单帧预算累计 16 ms，才继续引入热路径优化。

**Stop Conditions:**

- 若无法从现有协议事件构造合法且具代表性的 wire 帧，停止并补齐 fixture 依据。
- 若 `validate + append` 不满足优化门槛，停止后续实现并只保留基准证据。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run --config vitest.performance.config.ts apps/web/src/features/conversation/runtime/event-hot-path.performance.test.ts`

Expected: 10,000 帧全部完成，输出 `parse`、`validate`、`append` 与总耗时，且给出是否继续优化的可复核数据。

### Task 2: 编译并按 type 分派事件边界校验

**Files:**

- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/transport-http/src/event-client.ts`
- Modify: `packages/transport-http/src/event-client.test.ts`
- Test: `apps/web/src/features/conversation/runtime/event-hot-path.performance.test.ts`
- Modify: `tests/performance-budgets.json`

**Interfaces:**

- Consumes: `EventStreamMessageSchema` 及各事件 TypeBox Schema
- Produces: `checkEventStreamMessage(value: unknown): value is EventStreamMessage` 的 Schema 生成分派实现

**Behavior:**

- 从现有 TypeBox union Schema 生成分派表，并先读取 `type` 只校验唯一事件 Schema；未知类型、额外字段和嵌套非法载荷仍在 HTTP/WebSocket 边界拒绝。
- HTTP Transport 使用分派校验器替代通用嵌套 union 的 `Value.Check`，不对校验后的同一对象再次解码或校验。
- 仅当 10,000 帧校验仍超过 30 ms 时，才生成不含 runtime `eval` 的构建期静态编译产物。

**Stop Conditions:**

- 若生成实现增加的浏览器静态 bundle 超过现有预算，或无法从 Schema 单一来源生成严格校验器，停止并保留现有 `Value.Check`。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts packages/transport-http/src/event-client.test.ts --passWithNoTests`

Expected: 19 类 Agent Event、连接控制帧和非法帧的契约测试通过，Transport 仍只交付严格合法且连续的事件。

### Task 3: 将 wire 字节长度贯通到有界历史

**Files:**

- Modify: `packages/client/src/contracts.ts`
- Modify: `packages/transport-http/src/event-client.ts`
- Modify: `packages/transport-http/src/event-client.test.ts`
- Modify: `packages/transport-tauri/src/event-subscription.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-history.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Test: `apps/web/src/features/conversation/runtime/event-hot-path.performance.test.ts`
- Modify: `tests/performance-budgets.json`

**Interfaces:**

- Consumes: WebSocket 原始文本帧、`SubscribeAgentEventsOptions.onEvent`
- Produces: `AgentEventDelivery` 的事件与可选 `wireBytes` 元数据、`ProjectEventHistory.append(event, retainedBytes)` O(1) 容量计量

**Behavior:**

- HTTP Transport 在解析前按原始 UTF-8 wire 文本计算一次真实字节长度并随事件交付；Project Runtime 直接将该长度用于 History 预算，不再递归遍历事件对象。
- Tauri 内部事件保持可信对象交付，不增加重复 Schema 校验；没有 wire 字节元数据的内部路径使用现有保守估算兜底。
- 重新运行同一 10,000 帧基准，断言优化后结果正确且 `validate + append` 相对基线显著下降。

**Stop Conditions:**

- 若 Transport 无法提供非负安全整数 wire 字节数，History 必须回退到 `estimateRetainedBytes`，不得破坏容量上限。
- 若优化后基准没有改善或 bundle 门禁失败，停止并撤销无收益的热路径复杂度。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run --config vitest.performance.config.ts apps/web/src/features/conversation/runtime/event-hot-path.performance.test.ts && pnpm check`

Expected: 10,000 帧优化基准通过，History 淘汰语义保持，格式、Lint、架构、类型和单元测试全部通过。
