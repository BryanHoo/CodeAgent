# Feature Implementation Plan

**Goal:** 在 Project 文件索引 walker 阶段实施 entry/byte/deadline/cancellation 预算，避免超大仓库先无界构建完整索引再被缓存淘汰，并向上游返回 `truncated` 降级状态。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 性能优先与有界运行时约束
- `.superwork/spec/backend/runtime-lifecycle.md` — 协作取消与有界缓存
- `.superwork/spec/backend/directory-structure.md` — 文件搜索边界与索引缓存

**Architecture:** 抽取共享索引预算常量；`ProjectFileIndex` 增加 `truncated`；并行 walker 在 `visit` 时检查取消、构建截止时间、全局 entry/byte 计数，超限时 `WalkState::Quit` 并标记截断；缓存层复用同一上限，仅对多 Project 做 LRU 驱逐。Protocol 与 `files.search` 响应携带 `truncated`。

**Tech Stack:** Rust、`ignore` parallel walker、TypeBox、Vitest

## Global Constraints

- 性能优先：预算检查必须是 O(1)，不得在 walker 结束后才截断。
- 单文件不超过 500 行；关键预算逻辑添加简短中文注释。
- 取消与失败构建仍不得写入缓存。
- `truncated: true` 时索引仍可缓存并在 TTL 内复用，避免重复全量遍历。

### Task 1: Walker 阶段预算与截断状态

**Files:**

- Create: `crates/platform/src/project_file_index_budget.rs`
- Modify: `crates/platform/src/project_file_index.rs`
- Modify: `crates/platform/src/project_file_index_cache.rs`
- Modify: `crates/platform/src/lib.rs`

**Interfaces:**

- Consumes: `PortRequestContext`、`MAX_PROJECT_FILE_DEPTH`、忽略目录规则
- Produces: `ProjectFileIndex { entries, estimated_bytes, truncated }`、`IndexBuildBudget`

**Behavior:**

- 构建索引时在并行 visitor 中检查取消、5 秒构建截止时间、250,000 条目与 64 MiB 估算字节；任一触发即停止遍历并设置 `truncated: true`。
- 正常小仓库 `truncated: false`；测试可通过注入更小预算验证截断。

**Stop Conditions:**

- 若 `ignore` parallel visitor 无法在 worker 间安全共享预算计数则停止并改用单线程 walker。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform project_file_index --locked`

Expected: 既有搜索排序/边界测试通过，并新增 walker 预算截断测试通过。

### Task 2: 暴露 truncated 协议与搜索响应

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `crates/platform/src/files.rs`

**Interfaces:**

- Consumes: `ProjectFileIndex { entries, estimated_bytes, truncated }`
- Produces: `ProjectFileSearchPage { data, truncated }`

**Behavior:**

- `files.search` JSON 响应包含 `truncated` 布尔字段；Schema 校验拒绝缺失字段。

**Stop Conditions:**

- 若现有 Client/Web 无法容忍新增必填字段则先更新 Protocol 测试与 fixture，不保留旧分支。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts`

Expected: `ProjectFileSearchPageSchema` 接受/拒绝 `truncated` 的用例通过。

### Task 3: 平台与缓存集成验证

**Files:**

- Modify: `crates/platform/src/project_file_index_cache.rs`（如需）

**Interfaces:**

- Consumes: 有界 `ProjectFileIndex`
- Produces: 可缓存的截断索引，超大单 Project 不再触发构建后立即驱逐

**Behavior:**

- 截断索引的 `entry_count` 与 `estimated_bytes` 不超过缓存单索引上限；`get_or_build` 可复用截断索引。

**Stop Conditions:**

- 若截断索引仍超过全局多 Project 预算，仅依赖现有 LRU 驱逐，不扩大缓存。

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-platform --locked`

Expected: Platform 全部测试通过。
