# Feature Implementation Plan

**Goal:** 在不引入 Item 虚拟化且不改变 Store 完整数据的前提下，用完成过程语义聚合限制单个超大 Turn 默认收起时的 DOM、React commit、Item 订阅与 layout 规模，保留最近 20 个终态普通操作，并在用户展开时直接展示全部过程 Item。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束性能优先、文件规模和项目验证命令。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 完成过程、组件复用与可访问交互。
- `.superwork/spec/frontend/state-management.md` — 约束归一化 Store、独立 Item Store 订阅和完成过程折叠。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束长历史 DOM、交互和真实 Chromium 性能门禁。

**Architecture:** 完整 Item 继续保存在现有 `TaskStore.itemStoresById` 和 Turn 顺序索引中。终态 Turn 在结构或终态变化时单次扫描 Item 快照，生成成功操作数、失败操作数、唯一文件数、聚合隐藏 ID 与固定 20 项的最近普通操作环形窗口；默认折叠态渲染摘要和最近操作，用户展开后按原顺序直接挂载全部过程 Item。Turn 级虚拟化保持不变，不创建 Item 测高、占位行、分页窗口或二级滚动容器。

**Tech Stack:** React 19、TypeScript、Zustand、i18next、Vitest、Playwright、pnpm。

## Global Constraints

- 生产 TypeScript/TSX 单文件不得超过 500 行，所有实现以性能优先。
- 不删除、截断、复制或改写协议 Item；Store 必须继续保留完整 Item 数据与原顺序。
- 不引入 Item 虚拟化、动态测高、占位高度或嵌套滚动容器。
- 默认折叠态最多订阅最近 20 个普通操作的 Item Store；用户展开后允许直接挂载并订阅全部过程 Item。
- 使用项目现有 `pnpm` 命令验证，所有 Python 命令使用 `python3`，不启动开发服务器。

### Task 1: 定义完成过程语义聚合

**Files:**

- Create: `apps/web/src/features/workbench/components/task-timeline-process.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `AgentItem`、`AgentTurn.status`、`shouldRenderTimelineItem`
- Produces: `CompletedTurnProcess` 聚合结果与 `COMPLETED_TURN_RECENT_OPERATION_LIMIT`

**Behavior:**

- 终态 Turn 按一次线性扫描识别最终回答前的 Commentary、Reasoning 和结构化操作；统计成功操作、失败操作与去重文件路径，并把不会单独展示的完成文件变更纳入聚合隐藏集合。
- 同一扫描使用固定 20 项环形窗口保留最近终态 Command、Tool、Activity、审批与 Runtime Status ID，失败项同样保留。
- 运行中 Turn 不聚合；没有最终回答的终态 Turn 保留既有结构化 Item 展示。
- 10,000 个过程 Item 的测试证明聚合数据完整且输入数组未被删除、截断或改写。

**Stop Conditions:**

- 如果协议 Item 无法稳定区分成功与失败语义，停止并以现有状态 Union 为唯一依据修正契约。
- 如果聚合需要修改 Store、协议或 Provider 数据，停止并缩回纯展示派生边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 大 Turn聚合测试先以缺失接口失败，随后通过且既有 Timeline 测试保持通过。

### Task 2: 接入摘要与完整展开交互

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline-store-turn.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `CompletedTurnProcess`、`StoredTimelineItemContent`、`TurnProcessingTime`
- Produces: 完成过程摘要与展开/收起控制

**Behavior:**

- 折叠态展示“已完成 N 项操作 · M 项失败 · F 个文件”语义摘要、最近 20 个终态普通操作、最终回答和文件汇总。
- 用户展开后按原顺序直接挂载全部过程 Item，不展示分页控件；收起后再次卸载全部过程 Item。
- E2E 使用 205 个完成过程 Item 证明折叠时只挂载最后 20 个普通操作、展开后首尾操作同时可见，最终回答始终可见。

**Stop Conditions:**

- 如果展开/收起破坏 Item 原顺序、最终回答、文件汇总或 Turn 级滚动行为，停止并修正渲染过滤边界。
- 如果交互需要分页、嵌套滚动容器、Item 测高或新状态 Store，停止并保持简单局部布尔状态。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx && pnpm run build:web && pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "expands the complete execution process"`

Expected: 单元测试通过；Chromium 中摘要、最近 20 项、完整展开、聚合隐藏项卸载和收起流程全部通过。

### Task 3: 恢复单个超大 Turn 性能门禁

**Files:**

- Modify: `tests/performance/timeline.performance.spec.ts`
- Modify: `tests/performance-budgets.json`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`

**Interfaces:**

- Consumes: Timeline Chromium 性能场景、`tests/performance-budgets.json`
- Produces: 单 Turn 10,000 操作默认折叠的 DOM、交互和内存预算

**Behavior:**

- 真实 Chromium 加载包含 10,000 个完成操作的单 Turn，断言默认折叠态 DOM 有界、摘要准确、仅挂载最近 20 个普通操作且最终回答可见。
- 性能预算独立记录单 Turn Item 数、折叠态最大 DOM、Hydration 时延和内存增长，不提高既有长历史预算。
- 前端规范明确 Turn-only 虚拟化与完成过程默认语义聚合、用户完整展开的职责边界。

**Stop Conditions:**

- 如果场景只能通过 `renderToStaticMarkup` 验证或无法读取真实 Chromium 指标，停止并保留现有浏览器性能框架。
- 如果折叠态预算失败暴露过程 Item 仍被挂载或订阅，停止并修正实现，不放宽预算掩盖回归。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test --config playwright.performance.config.ts tests/performance/timeline.performance.spec.ts && pnpm check`

Expected: 长历史与单个 10,000 Item Turn 性能场景全部通过，格式、Lint、架构、类型和 Vitest 基线通过。
