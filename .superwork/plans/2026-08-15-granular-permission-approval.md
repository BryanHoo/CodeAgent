# Feature Implementation Plan

**Goal:** 让 CodeAgent 完整展示并响应 Codex `item/permissions/requestApproval`，同时保留命令审批中的 `additionalPermissions`。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨层协议、生成代码和验证流程。
- `.superwork/spec/backend/runtime-lifecycle.md` — 定义 Codex App Server 双向请求和 Pending Request 生命周期。
- `.superwork/spec/frontend/component-guidelines.md` — 约束审批组件职责、可访问性和拆分边界。
- `.superwork/spec/frontend/type-safety.md` — 要求前端只消费严格公共协议。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 TypeBox、Rust DTO 和契约测试同步。

**Architecture:** 以 `packages/protocol` 的 TypeBox Schema 定义 Provider 无关的结构化权限请求与授权响应；Rust Codex Provider 严格映射本机 0.147.0 App Server Schema，并在 Pending Request Registry 中生成原生授权子集；Web 复用统一权限明细组件展示独立权限请求和命令 `additionalPermissions`，由现有 Client Mutation 链路提交。

**Tech Stack:** TypeScript、TypeBox、Rust、serde_json、React、Vitest、Playwright、pnpm。

## Global Constraints

- 保持生产单文件不超过 500 行，并优先选择无重复解析、无额外全量遍历的高性能实现。
- 所有外部 Codex 字段必须在 Provider 边界严格校验，原始 Provider 结构不得泄漏到 Web。
- TypeBox 是 TypeScript/Rust 公共协议唯一来源，生成文件只能通过项目命令更新。
- 会话级授权只作用于当前 Codex Session，不进入 Global、Project 或 Task 持久设置。
- 只向 Codex 返回用户选中的请求权限子集，禁止扩大授权范围。

### Task 1: 扩展公共 Pending Request 权限契约

**Files:**

- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `schemas/code-agent-runtime.schema.json`
- Modify: `crates/protocol/src/generated.rs`

**Interfaces:**

- Consumes: `PendingRequestSchema`、`ResolvePendingRequestRequestSchema`、Codex 权限 Profile 字段语义
- Produces: `permissions_approval` Pending Request、结构化权限 Profile、`turn | session` 授权响应契约

**Behavior:**

- 严格校验网络权限、文件系统 legacy path 与 entry path 联合、访问模式、请求身份及授权范围；拒绝额外字段和非法权限值，并允许空授权子集表达拒绝。

**Stop Conditions:**

- 如果本机 Codex 0.147.0 生成 Schema 与官方 App Server 文档在字段必选性上冲突，停止并保留两份证据。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/protocol/src/rust-runtime-schema.test.ts`

Expected: 新权限请求和响应契约测试通过，Rust Schema 生成物无漂移。

### Task 2: 映射并解析 Codex 细粒度权限请求

**Files:**

- Modify: `crates/provider-codex/src/mapping/server_requests.rs`
- Modify: `crates/provider-codex/src/pending_requests.rs`
- Modify: `crates/provider-codex/tests/mapping.rs`
- Modify: `crates/provider-codex/tests/pending_requests.rs`

**Interfaces:**

- Consumes: `item/permissions/requestApproval`、`CommandExecutionRequestApprovalParams.additionalPermissions`、公共权限契约
- Produces: `pending_request.created` 权限事件、Codex `PermissionsRequestApprovalResponse`

**Behavior:**

- 严格映射独立权限请求与命令附加权限，校验文件系统和网络结构；解析时只回传客户端选择的权限子集，并将授权范围映射为 `turn` 或 `session`。

**Stop Conditions:**

- 如果原生权限响应无法通过实际 App Server Schema，或无法保证返回值是请求权限子集，停止并报告具体载荷。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-provider-codex --test mapping --test pending_requests --locked`

Expected: Provider 映射、原生响应、幂等和生命周期测试全部通过。

### Task 3: 实现权限授权界面

**Files:**

- Create: `apps/web/src/features/workbench/components/permission-request-details.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.test.tsx`
- Modify: `apps/web/src/features/conversation/runtime/event-hot-path.performance.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-activity.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-activity.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Modify: `apps/web/src/features/notifications/browser-task-notifier.test.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/transport-http/src/http-client.test.ts`

**Interfaces:**

- Consumes: `permissions_approval`、命令 `additionalPermissions`、现有 `onResolve` Mutation
- Produces: 可选择授权子集的权限 UI、`turn | session` Resolution、命令附加权限只读摘要

**Behavior:**

- 以可访问的复选框逐项展示网络和文件系统权限；默认选择全部请求权限，允许 Turn、Session 或空子集拒绝，队列态和终态遵循现有审批交互。

**Stop Conditions:**

- 如果新增 UI 使任一生产文件超过 500 行，停止并先按职责继续拆分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/pending-request.test.tsx`

Expected: 权限明细、子集选择、Session 授权、拒绝和命令附加权限渲染测试通过。

### Task 4: 覆盖浏览器端到端权限审批流程

**Files:**

- Modify: `tests/fixtures/fake-codex-server.mjs`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: Fake Codex `item/permissions/requestApproval`、Web Pending Request UI、HTTP/Tauri 共用 Resolution 契约
- Produces: 浏览器可见权限请求、Session-scoped 原生响应证据、更新后的稳定运行时规范

**Behavior:**

- Fake Codex 发出网络与文件系统组合权限请求，浏览器选择子集并按 Session 授权；测试断言 Turn 正确继续且原生响应未包含未选权限。

**Stop Conditions:**

- 如果现有 E2E Fixture 无法观察 App Server 响应内容，停止并先增加有界、非敏感的测试专用观测字段。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-runtime.spec.ts`

Expected: 新权限审批用例通过，既有 Pending Request 用例无回归。
