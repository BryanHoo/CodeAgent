# Tauri Phase 2 Implementation Plan

**Goal:** 完成 `docs/tauri-migration-plan.md` Phase 2，将宿主无关 Client facade 与 HTTP/WebSocket、Tauri IPC 交付实现分离，并通过构建期 alias 保证 Web 与 Desktop 只包含各自 Transport。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 workspace、构建、验证和发布产物。
- `.superwork/spec/frontend/directory-structure.md` — 约束唯一 React UI 与应用级 Composition Root。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束请求取消、订阅和卸载清理。
- `.superwork/spec/frontend/state-management.md` — 约束访问状态、实时事件和 Query `AbortSignal`。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端测试、bundle 和安全边界。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol Schema 运行时校验。
- `.superwork/spec/shared/directory-structure.md` — 约束 Client、Protocol 和 Transport 的依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公共契约和跨包测试。
- `docs/tauri-migration-plan.md` — 定义 Phase 2 实施项、删除项和验收项。

**Architecture:** `@code-agent/client` 保留稳定 `CodeAgentClient` facade、宿主无关 operation/transport 契约、结构化错误、响应 Schema 校验、request ID 和取消协调；`@code-agent/transport-http` 实现现有 HTTP/WebSocket 映射；`@code-agent/transport-tauri` 通过 `@tauri-apps/api/core` 调用领域化 Commands。`apps/web/src/app/create-host-client.ts` 是唯一 Composition Root，Vite 使用 `@code-agent/host-transport` build-time alias 静态选择 Transport。

**Tech Stack:** TypeScript 6、Vitest 4、Vite 8、pnpm 11、Tauri 2.11、Rust 2024、Serde。

## Global Constraints

- Desktop Renderer 不得包含 `fetch`、`WebSocket`、HTTP route 或 `@code-agent/transport-http`；Web bundle 不得包含 `@tauri-apps/api` 或 Tauri Transport。
- `CodeAgentClient` 公共领域方法保持 UI 调用面稳定，组件不得感知 route、command name 或宿主类型。
- 每个请求携带 Client 生成的 `requestId`；调用方取消必须让 HTTP fetch 或 Tauri `cancel_operation` 终止宿主操作。
- Tauri Command 使用 owned 参数并返回可序列化结构化错误；Command 只做 DTO 边界，不引入 Runtime、Node、Fastify 或 localhost Server。
- Phase 2 的 Tauri 实现只支持 app info、access status 和 diagnostics；其余领域 operation 返回稳定 `unsupported_operation`，不得伪造业务可用状态。
- 测试结束必须调用 Tauri `clearMocks()`；依赖边界必须由 dependency-cruiser 和构建产物扫描共同验证。
- 使用项目现有 `pnpm`；关键非显然逻辑添加简短中文注释，不保留冗余旧 HTTP Client 路径。

### Task 1: 固定宿主无关 Client 契约

**Files:**

- Create: `packages/client/src/client.test.ts`
- Create: `packages/client/src/client.ts`
- Create: `packages/client/src/project-client.ts`
- Create: `packages/client/src/task-client.ts`
- Create: `packages/client/src/contracts.ts`
- Create: `packages/client/src/errors.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/package.json`
- Delete: `packages/client/src/http-client.ts`
- Delete: `packages/client/src/http-client-transport.ts`
- Delete: `packages/client/src/http-client-projects.ts`
- Delete: `packages/client/src/http-client-tasks.ts`

**Interfaces:**

- Consumes: `@code-agent/protocol` schemas/types、现有 `CodeAgentClient` 公共领域方法。
- Produces: `CodeAgentTransport`、`CodeAgentOperation`、`CodeAgentRequestContext`、`CodeAgentError` 和 transport-driven `CodeAgentClient` facade。

**Behavior:**

- Client 为每次读取和 mutation 生成唯一 `requestId`，使用 operation 定义校验响应，保留 idempotency key 与 `AbortSignal`，将 transport 结构化失败规范化为 `CodeAgentError`；Facade 不导入或创建 `fetch`、`WebSocket`、Tauri API。

**Stop Conditions:**

- 若 operation 契约必须暴露 HTTP path/method/status 或 Tauri command name 才能覆盖现有方法，则停止并调整宿主边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/client.test.ts`

Expected: Client request ID、Schema validation、错误映射、取消和公开方法契约测试通过。

### Task 2: 提取 HTTP 与 WebSocket Transport

**Files:**

- Create: `packages/transport-http/package.json`
- Create: `packages/transport-http/tsconfig.json`
- Create: `packages/transport-http/src/index.ts`
- Create: `packages/transport-http/src/http-transport.ts`
- Create: `packages/transport-http/src/http-operation-map.ts`
- Create: `packages/transport-http/src/event-client.ts`
- Create: `packages/transport-http/src/http-transport.test.ts`
- Create: `packages/transport-http/src/event-client.test.ts`
- Modify: `packages/client/src/client.test.ts`
- Delete: `packages/client/src/http-client.test.ts`
- Delete: `packages/client/src/event-client.ts`
- Delete: `packages/client/src/event-client.test.ts`

**Interfaces:**

- Consumes: `CodeAgentTransport`、operation names/inputs、现有 REST 与 Agent Event v2 WebSocket 契约。
- Produces: `HttpCodeAgentTransport`、HTTP asset URL 解析、同源认证失效通知和有界 WebSocket 重连订阅。

**Behavior:**

- 将每个 Client operation 映射到现有 route、method、body、idempotency key 和 timeout；HTTP 响应作为 `unknown` 返回 Client 校验；WebSocket 保留 session/sequence/resync/reconnect 行为；取消同时受调用方 signal 与明确截止时间控制。

**Stop Conditions:**

- 若 Web/LAN 既有 route、认证 Cookie、错误码、重连或附件二进制行为需要改变，则停止并修复适配层，不能修改 Server 契约规避。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/client.test.ts packages/transport-http/src/http-transport.test.ts packages/transport-http/src/event-client.test.ts`

Expected: 现有 HTTP/WebSocket 行为迁移后通过，Client 测试不再直接 mock 全局 fetch。

### Task 3: 实现 Tauri typed diagnostics 边界

**Files:**

- Create: `packages/transport-tauri/package.json`
- Create: `packages/transport-tauri/tsconfig.json`
- Create: `packages/transport-tauri/src/index.ts`
- Create: `packages/transport-tauri/src/tauri-transport.ts`
- Create: `packages/transport-tauri/src/tauri-transport.test.ts`
- Create: `apps/desktop/src-tauri/src/commands/mod.rs`
- Create: `apps/desktop/src-tauri/src/commands/app.rs`
- Create: `apps/desktop/src-tauri/src/command_error.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `Cargo.lock`

**Interfaces:**

- Consumes: Tauri `invoke`、`CodeAgentTransport`、`AppInfoResponse`、`AccessStatusResponse`、`HealthResponse`。
- Produces: `TauriCodeAgentTransport`、`app_info`、`access_status`、`app_diagnostics`、`cancel_operation` typed Commands 和序列化 `CommandError`。

**Behavior:**

- 三个只读 operation 通过独立 typed Commands 往返；Desktop access 固定为本机已认证，diagnostics 明确报告 Rust/Tauri delivery ready；未支持 operation 返回 `unsupported_operation`；取消已完成 request 幂等成功，活动 request 预留显式 cancellation registry 边界。

**Stop Conditions:**

- 若实现需要万能 JSON dispatcher、Node/Fastify、localhost、全局 event、同步 I/O 或宽泛 capability，则停止，因为违反 Phase 2 Delivery 边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts && cargo test -p code-agent-desktop --locked`

Expected: `mockIPC` 覆盖 command payload、结构化错误、unsupported operation 和取消，Rust command tests 通过。

### Task 4: 接入唯一 Composition Root 与构建期隔离

**Files:**

- Create: `apps/web/src/app/create-host-client.ts`
- Create: `apps/web/src/app/create-host-client.test.ts`
- Create: `apps/web/src/types/host-transport.d.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/app/providers.tsx`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/vite.config.test.ts`
- Modify: `apps/web/package.json`
- Modify: `packages/transport-http/package.json`
- Modify: `packages/transport-tauri/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `@code-agent/host-transport` Vite alias、`createHostTransport()`、`CodeAgentClient`。
- Produces: 唯一 `createHostClient()` 与分别静态链接 HTTP/Tauri Transport 的 Web/Desktop UI。

**Behavior:**

- 生产代码只在 Composition Root 创建 Client；Vite target 明确映射到一个 Transport，并仅为 Web target 配置 `/v1` proxy；测试证明两个 target alias 互斥且页面既有消费者继续使用同一 Client 实例。

**Stop Conditions:**

- 若需要 `window.__TAURI__`、动态 import 两个 Transport 或运行时宿主判断，则停止并修复 build-time alias。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/app/create-host-client.test.ts apps/web/vite.config.test.ts`

Expected: Composition Root 与 target alias 测试通过，生产 UI 不再直接实例化固定 HTTP Client。

### Task 5: 强化依赖与 bundle 门禁并完成验证

**Files:**

- Create: `tests/tauri-phase-2.test.ts`
- Create: `tools/verify-host-bundles.mjs`
- Modify: `dependency-cruiser.config.cjs`
- Modify: `package.json`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `packages/client/README.md`

**Interfaces:**

- Consumes: dependency-cruiser 编译前依赖图、Vite manifest/chunks、Web/Desktop build outputs。
- Produces: Transport 互不依赖、Web 仅含 HTTP、Desktop 仅含 Tauri 的静态门禁和 Phase 2 仓库契约。

**Behavior:**

- 架构 lint 覆盖两个新包并拒绝 Client 依赖 Transport、Transport 互相依赖和 Web 绕过 Composition Root；bundle scanner 对产物内容与 manifest 扫描 forbidden modules；更新工程指南后运行完整 TypeScript、Rust、E2E 与 Desktop artifact 验证。

**Stop Conditions:**

- 若任一 build 泄漏另一 Transport、Web/LAN/E2E 回归、Rust lint 失败或 Desktop 无法生成当前平台未签名 artifact，则停止并修复，不能放宽门禁。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e && pnpm check:rust && pnpm --filter @code-agent/desktop build`

Expected: 全部门禁和当前平台 Desktop 未签名构建通过，`dist/web` 不含 Tauri，`dist/desktop` 不含 HTTP/WebSocket Transport。
