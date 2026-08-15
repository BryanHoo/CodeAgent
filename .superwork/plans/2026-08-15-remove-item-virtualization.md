# Implementation Plan

**Goal:** 恢复 Timeline 仅按 Turn 虚拟化，Turn 内 Item 不再创建二级虚拟行、估算高度或滚动窗口。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束性能优先、文件规模和项目验证命令。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 渲染边界与 Item 展示规则。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束浏览器性能门禁范围。

**Architecture:** 保留 `ConversationVirtualList` 的 Turn 级动态测高；删除共享滚动容器上的 `ConversationNestedVirtualList`，并在现有 Turn 组件内直接映射 `visibleItemIds`。继续由 `StoredTimelineItemContent` 决定空内容是否返回 `null`，保留完成过程折叠和最后一个空内容项规则。

**Tech Stack:** React 19、TypeScript、Zustand、TanStack React Virtual、Vitest、Playwright。

## Global Constraints

- 保持生产 TypeScript/TSX 单文件不超过 500 行。
- 保持现有 Turn 级虚拟化、自动置底、完成过程折叠与最后一个空内容项规则。
- 不恢复旧 `content-visibility` 逻辑，不改动无关功能。
- 使用项目现有 `pnpm` 命令验证，不启动开发服务器。

### Task 1: 恢复 Turn 内直接渲染

**Files:**

- Modify: `apps/web/src/shared/components/agent/conversation.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-turn.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-running.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `ConversationVirtualList`、`TaskStore.itemStoresById`、`StoredTimelineItemContent`
- Produces: 仅 Turn 级虚拟化且直接渲染 Turn 内 Item 的 Timeline

**Behavior:**

- 单 Turn 内所有 Item 直接进入 React 渲染流程；返回 `null` 的内容不产生 DOM 或高度；完成过程折叠和最后一个空内容项规则保持不变。

**Stop Conditions:**

- 如果直接映射需要改变完成过程折叠或 Item 顺序，停止并修正实现边界。
- 如果任一生产文件超过 500 行，停止并按既有职责拆分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 测试证明不存在 Item 虚拟容器，且同一 Turn 的首尾 Tool 均被渲染；既有 Turn 虚拟化和折叠测试通过。

### Task 2: 删除失效门禁并完成验证

**Files:**

- Modify: `tests/e2e/app-shell-runtime.spec.ts`
- Modify: `tests/performance/timeline.performance.spec.ts`
- Modify: `tests/performance-budgets.json`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`
- Delete: `.superwork/plans/2026-08-14-single-turn-item-virtualization.md`

**Interfaces:**

- Consumes: Timeline E2E、Chromium 性能预算、前端组件与质量规范
- Produces: 与 Turn-only 虚拟化一致的验证与规范

**Behavior:**

- 删除依赖 Item 虚拟行 DOM 的 E2E、单 Turn `10,000 Tool Item` 性能场景与预算；长历史 Turn 虚拟化门禁继续保留。

**Stop Conditions:**

- 如果清理会删除 Turn 级长历史门禁，停止并缩小删除范围。
- 如果规范仍要求 Item 二级虚拟化，停止并同步修正后再验证。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 类型、Lint、格式与测试门禁通过，源码和规范中不再存在 Item 二级虚拟化引用。
