# Feature Implementation Plan

**Goal:** 以高性能 Rust 实现完整迁移 Project 文件树与文件名搜索行为，并停止应用 `.gitignore` 过滤。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — Workspace、性能与验证约束
- `.superwork/spec/backend/directory-structure.md` — Server、Rust Platform 与文件能力边界
- `.superwork/spec/backend/runtime-lifecycle.md` — 有界缓存和协作取消约束
- `.superwork/spec/backend/quality-guidelines.md` — Rust、Server 与跨平台测试要求

**Architecture:** 文件树保持单目录异步懒加载；搜索使用按 Project 根目录缓存的紧凑只读文件索引，构建时执行固定目录、符号链接与 20 层边界，查询时按文件名分组收集 exact、prefix、substring 前 50 项。索引容量、条目数和生命周期均有界，请求取消贯穿 HTTP、Runtime 与遍历。

**Tech Stack:** Rust、Tokio、N-API、Fastify、TypeScript、Vitest

## Global Constraints

- 性能优先，遍历内部禁止使用 `serde_json::Value`，查询阶段禁止全量排序。
- `.gitignore` 作为普通文件返回，任何 `.gitignore` 规则都不得移除文件或目录。
- 跳过 symlink、`.git` 与固定大型生成目录，递归深度最多 20。
- 单文件不得超过 500 行；关键逻辑添加简短清晰的中文注释。
- 缓存必须同时限制 Project 数、文件条目数和估算字节数，并声明清理触发点。

### Task 1: 固定文件树与搜索行为

**Files:**

- Modify: `crates/platform/src/project_tree.rs`
- Create: `crates/platform/src/project_file_index.rs`
- Modify: `crates/platform/src/lib.rs`

**Interfaces:**

- Consumes: `PortRequestContext`、Project 根目录和相对目录
- Produces: 强类型直接子项、文件索引和稳定搜索结果

**Behavior:**

- 文件树返回当前目录全部直接普通子项，`.gitignore` 规则不参与过滤。
- 搜索只匹配文件名，按 exact、prefix、substring、名称长度、名称、路径排序，最多 50 项。
- 搜索与目录路径都执行 20 层边界，遍历每个目录项响应取消。

**Stop Conditions:**

- 若现有公开协议不能表达相同行为则停止并先处理协议边界。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform project_tree --locked`

Expected: 文件树、搜索排序、深度、`.gitignore` 保留和取消测试通过。

### Task 2: 接入有界 Project 文件索引

**Files:**

- Modify: `crates/platform/src/files.rs`
- Modify: `crates/platform/src/project_file_index.rs`
- Modify: `crates/platform/src/lib.rs`
- Modify: `crates/core/src/ports.rs`
- Modify: `crates/runtime/src/lib.rs`
- Modify: `crates/runtime/tests/runtime_integration.rs`

**Interfaces:**

- Consumes: `PlatformFilePort`、`ProjectId`、Project 根目录、`PortRequestContext`、Runtime Project 生命周期
- Produces: 有界索引复用、单飞构建、无查询期排序的 `files.search` 响应与 `FilePort` 清理契约

**Behavior:**

- 同一 Project 的连续查询复用已构建索引；查询阶段仅线性扫描紧凑条目。
- 索引受 Project 数、总条目数、总估算字节数和 TTL 限制，取消或失败构建不得写入缓存。
- Project 删除和 Runtime 关闭时通过 `FilePort` 生命周期方法立即清理对应或全部索引。
- 文件树仍按目录实时读取，不物化完整 Project。

**Stop Conditions:**

- 若无法在不引入无界状态的前提下复用索引则停止并改用有界流式扫描。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --locked`

Expected: Platform 文件能力单元与集成测试全部通过。

### Task 3: 打通 HTTP 取消并完成验证

**Files:**

- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/routes/context.test.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`

**Interfaces:**

- Consumes: Fastify `request.signal`、`CodeAgentEngine.cancelOperation`
- Produces: 客户端断开到 Rust `PortRequestContext` 的取消通知和更新后的持久规范

**Behavior:**

- 文件树和文件搜索请求中止时调用相同 `requestId` 的 `engine.cancelOperation`，并正确移除监听器。
- 规范明确 `.gitignore` 不参与 Project 文件树和搜索过滤。
- 运行 Rust、Server 和 Workspace 质量门禁。

**Stop Conditions:**

- 若 Fastify 请求信号生命周期无法稳定映射到 Engine 操作则停止并补充独立请求取消适配器。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: Workspace 全量质量门禁通过。
