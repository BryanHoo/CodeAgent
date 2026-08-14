# Feature Implementation Plan

**Goal:** 限制单个超大 Turn 的 Item DOM 挂载规模，并用 1 Turn × 10,000 Items 的真实浏览器测试建立性能门禁。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束性能优先、文件规模和项目验证命令。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Task Timeline 的渲染边界与交互语义。
- `.superwork/spec/frontend/state-management.md` — 约束归一化 Store、Item 独立订阅与增量更新。
- `.superwork/spec/frontend/quality-guidelines.md` — 要求真实 Chromium 覆盖 10,000 Item 的 DOM、内存和交互门禁。

**Architecture:** 在现有 Turn 级 `ConversationVirtualList` 内增加共享滚动容器上的嵌套 Item 虚拟列表。小型 Assistant Group 保持直接渲染，大型 Group 只挂载可视窗口及少量 overscan；继续由独立 Item Store 驱动已挂载行。性能测试增加单 Turn 10,000 个 Tool Item 场景并单独约束挂载 Item 数与 DOM 节点数。

**Tech Stack:** React 19、TypeScript、Zustand、TanStack React Virtual、Vitest、Playwright、Chromium CDP。

## Global Constraints

- 保持生产 TypeScript/TSX 单文件不超过 500 行。
- 优先保证长时间线性能，不复制 Snapshot 或 Item 实体，不对文本 Delta 扫描完整 Item 列表。
- 保持现有 Turn 级虚拟化、自动置底、动态高度测量、键盘与可访问性行为。
- 不启动开发服务器。

### Task 1: 为超大 Assistant Group 增加二级 Item 虚拟化

**Files:**

- Modify: `apps/web/src/shared/components/agent/conversation.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Create: `apps/web/src/features/workbench/components/task-timeline-store-turn.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `ConversationContext.containerRef`、`TaskStore.itemStoresById`、`StoredTimelineItemContent`
- Produces: `ConversationNestedVirtualList` 与保持 Item 顺序、动态测量和有界挂载的 `StoredTimelineItemWindow`

**Behavior:**

- 当单个 Assistant Group 超过固定阈值时，复用 Conversation 滚动容器按 Item 建立嵌套虚拟窗口；只挂载可视 Item 与 overscan，小型 Group 继续直接渲染，并保持运行中最后一个 Tool/Message、动态高度和自动置底可见。

**Stop Conditions:**

- 如果 TanStack Virtual 无法在共享滚动容器中使用 `scrollMargin` 保持嵌套列表定位，停止并重新评估扁平化 Timeline 单元方案。
- 如果拆分后任一生产文件超过 500 行，停止并继续按组件职责拆分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: Task Timeline 单元测试通过，并证明单 Turn 大型 Item Group 不再生成全量 Item 标记。

### Task 2: 增加 1 Turn × 10,000 Items Chromium 病理门禁

**Files:**

- Modify: `tests/performance-budgets.json`
- Modify: `tests/performance/timeline.performance.spec.ts`

**Interfaces:**

- Consumes: `TaskSnapshot` 测试路由、`Memory.getDOMCounters`、Timeline DOM 标记
- Produces: `pathologicalTurn` 性能预算与单 Turn 10,000 Tool Item 浏览器测试

**Behavior:**

- 构造一个包含 10,000 个 Tool Item 的运行中 Turn，断言最后一个 Item 可见、挂载 Item 数和稳定 DOM 节点数均低于独立预算，防止 React commit 与 layout 峰值回归。

**Stop Conditions:**

- 如果测试不能区分已挂载 Item 与 Store 中的完整 Item 数，停止并为虚拟行增加稳定、只读的测试标记。
- 如果新增预算只能通过放宽现有长历史阈值通过，停止并修复实现而不是调整既有预算。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test --config playwright.performance.config.ts tests/performance/timeline.performance.spec.ts`

Expected: 现有 10,000 Item 长历史和新增 1 Turn × 10,000 Items 场景均通过各自 DOM 与挂载规模预算。
