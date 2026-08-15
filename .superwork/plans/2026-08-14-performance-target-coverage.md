# Feature Implementation Plan

**Goal:** 用真实 Rust、Node、WebSocket 与 Chromium 执行路径覆盖全部性能预算，并输出端到端采样分位数和资源指标。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 Workspace 命令、性能优先级与验证入口。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Event Stream 指标 Schema、跨层契约和附件/Git 预算。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Rust 队列、N-API bridge 与 WebSocket 反压。
- `.superwork/spec/frontend/state-management.md` — 约束实时事件到 Task Store 的动画帧合并。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束真实浏览器 Timeline、DOM 与渲染性能门禁。

**Architecture:** 保持业务事件协议不携带性能时间戳；Rust 与 Server 只增加 O(1) high-water 指标，性能测试通过显式 observer 在真实边界记录 `provider_received`、`runtime_published`、`transport_received`、`store_committed`、`painted`。Node 测试串行采集 event-loop delay、RSS、CPU 与 GC，Chromium 测试采集 Long Task、Event Timing、DOM、JS heap 与 paint。

**Tech Stack:** Rust/Tokio、N-API、TypeScript、Fastify/WebSocket、React/Zustand、Vitest、Playwright、pnpm。

## Global Constraints

- 保留工作区现有未提交改动，并在其事件合并新逻辑上继续实现。
- 单文件不超过 500 行；性能热路径只允许常数时间、无额外序列化的指标更新。
- 所有规模和门限集中维护在 `tests/performance-budgets.json`。
- 不启动持久开发服务器；浏览器性能测试只使用测试生命周期内的独立临时 Server。

### Task 1: 建立统一采样统计与资源采集

**Files:**

- Create: `tests/performance/metrics.ts`
- Create: `tests/performance/metrics.test.ts`
- Modify: `tests/performance-budgets.json`
- Modify: `vitest.performance.config.ts`

**Interfaces:**

- Consumes: `performance.now()`、`process.memoryUsage()`、`process.cpuUsage()`、`monitorEventLoopDelay`、GC `PerformanceObserver`
- Produces: `PerformanceTrace`、`p50/p95/p99` 分位数、`NodeResourceSample` 与统一预算读取入口

**Behavior:**

- 对命名采样点按事件 ID 形成阶段时延，使用稳定 nearest-rank 算法计算 p50/p95/p99，并在 Node 压力段前后采集 RSS、CPU、GC 和 event-loop delay。

**Stop Conditions:**

- 若 Node 24 不提供所需 `perf_hooks` 指标，则停止并保留明确的平台能力错误，不以空值通过预算。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/performance/metrics.test.ts --config vitest.performance.config.ts`

Expected: 统计与资源采集测试通过，性能配置能发现 `tests/performance/**` 和各 Workspace 性能用例。

### Task 2: 暴露 Rust queue 与 WebSocket 反压 high-water 指标

**Files:**

- Modify: `crates/runtime/src/event_stream.rs`
- Modify: `crates/runtime/tests/event_stream.rs`
- Modify: `crates/node-binding/src/events.rs`
- Modify: `packages/engine-node/src/engine.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/server/src/routes/runtime-routes.ts`
- Modify: `packages/protocol/src/server-metrics.ts`
- Modify: `packages/protocol/src/server-metrics.test.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: Rust bounded `mpsc` subscriber capacity、`WebSocket.bufferedAmount`
- Produces: `queueHighWaterMark`、`maxBufferedAmount` 严格 Event Stream metrics 字段

**Behavior:**

- 每次发布和 WebSocket 发送前以 O(1) 最大值更新 high-water，贯穿 Rust、N-API、Server 与 TypeBox 响应，且不扫描队列或载荷。

**Stop Conditions:**

- 若 high-water 需要改变公共 Agent Event 或增加每事件序列化，则停止并改为独立指标页实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/server-metrics.test.ts packages/server/src/app.test.ts && cargo test -p code-agent-runtime --test event_stream --locked`

Expected: 跨层指标契约测试通过，Rust 队列 high-water 在积压后达到预期且清空后保留峰值。

### Task 3: 覆盖 N-API、Server publish 与真实 WebSocket 预算

**Files:**

- Create: `tests/performance/napi-event-bridge.test.ts`
- Create: `tests/performance/server-event-route.test.ts`
- Modify: `packages/engine-node/src/event-subscription.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/server/src/server-options.ts`

**Interfaces:**

- Consumes: `NativeEventEngine.eventSubscribe`、Fastify WebSocket route、显式 performance observer
- Produces: `runtime_published`、`transport_received` 采样与 N-API/server/WebSocket p50/p95/p99、资源预算断言

**Behavior:**

- 串行推送固定事件量，通过真实 Fastify listener 和 `ws` 客户端交付文本帧，验证顺序、吞吐、queue/buffer high-water、event-loop delay、RSS、CPU 与 GC。

**Stop Conditions:**

- 若测试没有经过真实 socket I/O 或只调用 route callback，则不得标记 WebSocket 预算完成。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/engine-node/src/event-subscription.performance.test.ts packages/server/src/event-routes.performance.test.ts --config vitest.performance.config.ts`

Expected: N-API facade、Server 发布与真实 WebSocket 用例均被收集，并满足预算与资源上限。

### Task 4: 覆盖附件与 Git Rust 压力预算

**Files:**

- Create: `crates/platform/tests/performance_budgets.rs`
- Modify: `crates/platform/src/git/status.rs`
- Modify: `package.json`

**Interfaces:**

- Consumes: `AttachmentStore`、`GitCliService`、`tests/performance-budgets.json`
- Produces: 50 MiB 附件写入/retained RSS 预算、Git 多仓库/变更/Diff 压力预算

**Behavior:**

- Release 模式创建受管临时目录，执行真实文件 I/O、SQLite、Git 子进程与 Diff，断言预算后完整清理测试资源。

**Stop Conditions:**

- 若系统缺少 `git` 或无法创建临时普通文件，则明确失败，不以 mock 替代 Rust 性能目标。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --release --test performance_budgets --locked -- --nocapture`

Expected: 附件和 Git 预算均由真实 Rust 实现执行并通过。

### Task 5: 用 Chromium Timeline 测试替代静态 SSR 基准

**Files:**

- Delete: `apps/web/src/features/workbench/components/task-timeline.performance.test.tsx`
- Create: `tests/performance/timeline.performance.spec.ts`
- Create: `apps/web/src/features/conversation/runtime/project-runtime-recovery.test.ts`
- Create: `playwright.performance.config.ts`
- Modify: `packages/client/src/contracts.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/transport-http/src/event-client.ts`
- Modify: `packages/transport-http/src/event-client.test.ts`
- Modify: `packages/transport-tauri/src/event-subscription.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-history.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-recovery.ts`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `package.json`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`

**Interfaces:**

- Consumes: Chromium DOM、`PerformanceObserver` long task/Event Timing、CDP `Performance`/`HeapProfiler`、真实 React/Zustand Timeline
- Produces: `provider_received` → `runtime_published` → `transport_received` → `store_committed` → `painted` 的 p50/p95/p99，以及 DOM、paint、INP、JS heap、RSS、CPU、GC 结果

**Behavior:**

- 在独立浏览器测试 Server 中加载 10,000 Item 历史并流式交付采样事件，等待真实 DOM 更新和下一帧 paint，检查虚拟挂载规模、Long Task、交互延迟、内存增长与 GC 后保留量。

**Stop Conditions:**

- 若用例未运行 Chromium、未挂载真实 DOM 或没有观测到 `painted`，则性能套件必须失败。

- [x] **Task Status:** completed

Run: `pnpm run test:performance`

Expected: Rust、Vitest 与 Chromium 三段性能门禁全部执行；输出每阶段 p50/p95/p99 及 queue、event-loop、buffer、Long Task、RSS、CPU、GC 指标。
