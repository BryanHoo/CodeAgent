# Tauri 高性能客户端迁移计划

## 1. 文档目的

本文是 CodeAgent 从现有 React/Vite + Node/Fastify 架构迁移到 Tauri Desktop 的实施 Runbook，面向熟悉当前 monorepo、TypeScript 和 Rust 的维护者。

迁移完成后必须同时交付：

- 复用同一套 `apps/web` React 界面的 Tauri Desktop 客户端。
- 继续发布 `@bryanhu/code-agent` Node CLI 和 Web/LAN 服务。
- Tauri Desktop 直接调用 Rust Engine，不启动 Node、Fastify、localhost HTTP Server 或本地 WebSocket。
- Node CLI 通过 N-API 调用同一个 Rust Engine，不再保留第二套 TypeScript 业务实现。
- 分别生成 npm 包、macOS、Windows 和 Linux 安装包。
- 将启动、内存、IPC、事件吞吐和包体积作为合并门禁，而不是迁移完成后的补充优化。

本文不是 `.superwork/plans` 工作流计划，不记录任务状态；实际实施时按阶段拆分独立 PR。

## 2. 范围

### 2.1 本轮范围

- macOS `aarch64`、`x86_64`。
- Windows `x86_64`，在 Codex 和 CI Runner 验证稳定后增加 `aarch64`。
- Linux `x86_64-unknown-linux-gnu`，在目标发行版验证后增加 `aarch64`。
- 当前项目、任务、消息、审批、设置、Provider、Git、文件、附件和更新功能。
- 当前 SQLite 用户数据的原位迁移。
- Node CLI、浏览器 Web 和可信 LAN 模式继续维护。

### 2.2 暂不纳入

- iOS 和 Android 正式发布。
- 同一 Desktop 实例中的远程 Web UI。
- 多窗口、系统托盘、全局快捷键和深链，除非现有功能明确依赖。
- 将 React UI 重写为原生 Rust UI。
- 将 Codex App Server 协议改成新的产品协议。

移动端只保留 `crates/core` 和 `crates/runtime` 的可移植边界。当前本地 Codex binary、Git、任意项目目录和桌面文件系统能力不满足移动平台发布条件，不能把“能编译 Tauri Mobile 壳”当作功能完成。

## 3. 当前基线

迁移设计基于以下现状：

- 根包 `@bryanhu/code-agent` 同时承担 npm 发布、CLI 装配和构建编排。
- `apps/web` 是唯一 React/Vite UI，产物位于 `dist/web`。
- `packages/client` 同时包含公开客户端 API、`fetch`、WebSocket、协议解码和重连逻辑。
- `packages/server` 同时包含 Fastify Delivery、Runtime 编排、SQLite、Git、文件系统、附件和事件流。
- `packages/provider-codex` 负责 Codex binary 定位、App Server 子进程和 RPC 映射。
- `packages/protocol` 的 TypeBox Schema 是 Web、HTTP 和 Agent Event v2 的运行时协议边界。
- `src/cli-command.ts` 负责 SQLite、Codex Runtime、Fastify、端口、更新、浏览器和关闭顺序的最终装配。
- SQLite 使用 WAL、`foreign_keys=ON`、`synchronous=NORMAL` 和 `busy_timeout=5000`，数据库位于 `$CODEX_HOME/code-agent/state.sqlite3`。
- Agent Event 已包含 `sessionId`、`sequence`、有界历史、Delta 合并、Checkpoint 和 Snapshot 重同步语义。

这些协议和行为是迁移验收基线，但现有 TypeScript Runtime 不是最终兼容层。某项能力切换到 Rust 后，必须删除对应 TypeScript 实现。

## 4. 架构决策

### 4.1 最终运行路径

```text
Browser / LAN
  apps/web
    -> @code-agent/client
    -> @code-agent/transport-http
    -> @code-agent/server
    -> @code-agent/engine-node
    -> code-agent-node-binding
    -> code-agent-runtime

Tauri Desktop
  apps/web
    -> @code-agent/client
    -> @code-agent/transport-tauri
    -> apps/desktop/src-tauri
    -> code-agent-runtime

Codex
  code-agent-runtime
    -> code-agent-provider-codex
    -> bundled or resolved Codex executable
```

### 4.2 强制约束

- Desktop 只允许 Codex 作为外部进程，不允许 Node sidecar。
- Desktop Renderer 不允许导入 `@code-agent/transport-http`、Fastify、`ws`、`better-sqlite3` 或 Node built-in。
- Web 产物不允许包含 `@tauri-apps/api` 或 Tauri plugin JavaScript。
- `code-agent-runtime` 不允许依赖 Tauri、N-API 或 Fastify。
- `code-agent-node-binding` 和 Tauri application crate 只依赖 Runtime，不互相依赖。
- HTTP、Tauri IPC 和 N-API 只做 Delivery Adapter，不承载领域规则。
- 不使用一个接收任意字符串和任意 JSON 的万能 `execute` Command；按领域注册有类型的 Commands。
- 不进行 SQLite 双写，不长期维护 TypeScript/Rust 双 Engine。
- 不使用 base64 传输附件、图片或其他二进制内容。

### 4.3 不采用的方案

| 方案                                           | 不采用原因                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Tauri + Node/Fastify sidecar                   | 多一个 Runtime、进程、端口和 JSON/HTTP 跳转，冷启动、RSS 和故障面不符合性能目标 |
| Tauri 加载 localhost Web                       | 仍依赖 Server 生命周期和网络栈，无法获得直接 IPC 与最小权限边界                 |
| Web 和 Desktop 各维护一套 React App            | UI、状态和交互会漂移，修复成本翻倍                                              |
| Rust Engine 只服务 Desktop                     | Node 继续维护 TypeScript Engine，领域行为和 SQLite Schema 会长期分叉            |
| 所有宿主差异使用运行时 `window.__TAURI__` 判断 | 两套 Transport 可能同时进入 bundle，测试和依赖边界不清晰                        |
| 先把 `packages/server` 拆成大量 TypeScript 包  | 这些实现随后会迁到 Rust，形成短命包和重复搬迁                                   |

## 5. 目标 Monorepo

```text
apps/
  web/                         # 唯一 React/Vite UI，构建 web/desktop 两种产物
  node-cli/                    # 最终 npm CLI 包
  desktop/
    package.json               # Tauri CLI 和 Desktop 构建脚本
    src-tauri/
      capabilities/
      binaries/               # 构建时放入带 target triple 的 Codex binary
      icons/
      src/
        commands/
        lib.rs
        main.rs
      Cargo.toml
      build.rs
      tauri.conf.json

packages/
  protocol/                    # TypeBox Schema、TS 类型、Schema 导出
  client/                      # 宿主无关接口和 CodeAgentClient facade
  transport-http/              # fetch + WebSocket
  transport-tauri/             # invoke + Channel + raw IPC
  server/                      # Fastify、LAN access、HTTP/WS Delivery
  engine-node/                 # N-API loader 和目标平台包选择

crates/
  protocol/                    # 生成的 Rust DTO 和协议包装类型
  core/                        # 领域模型、ports、状态机、幂等和事件规则
  provider-codex/              # Codex 子进程、JSONL/RPC 和事件映射
  platform/                    # SQLite、Git、文件系统和附件实现
  runtime/                     # Engine facade、生命周期和业务编排
  node-binding/                # napi-rs bindings
  protocol-gen/                # 仅开发时使用的协议生成工具

schemas/
  code-agent/                  # 从 TypeBox 导出的稳定 JSON Schema

Cargo.toml                     # virtual workspace，resolver = "3"
Cargo.lock
package.json                   # private root、统一版本、编排脚本
pnpm-workspace.yaml
pnpm-lock.yaml
```

### 5.1 TypeScript 依赖规则

```text
protocol <- client <- transport-http <- web(web target)
protocol <- client <- transport-tauri <- web(desktop target)
protocol <- server <- node-cli
protocol <- engine-node <- node-cli
```

- `apps/web` 只能依赖 `protocol`、`client` 和一个由 Vite 构建期选择的 Transport。
- `server` 接收结构化 Engine port；它不直接导入 SQLite、Provider 或 N-API 实现。
- `node-cli` 是 Node Server 与 N-API Engine 的 Composition Root。
- `transport-tauri` 是唯一允许依赖 `@tauri-apps/api` 的前端包。
- 跨包只允许从 `src/index.ts` 暴露的 public API 导入。

### 5.2 Rust 依赖规则

```text
code-agent-protocol
  <- code-agent-core
       <- code-agent-provider-codex
       <- code-agent-platform

code-agent-protocol + code-agent-core + code-agent-provider-codex + code-agent-platform
  <- code-agent-runtime
  <- code-agent-node-binding | code-agent-desktop
```

- `protocol` 只包含序列化类型、校验和稳定标识，不包含 I/O。
- `core` 使用 ports 表达持久化、Provider、Git、文件和时间来源。
- `platform` 实现 ports；允许使用 `rusqlite`、Tokio filesystem 和进程 API。
- `runtime` 持有并协调 ports，提供宿主无关的异步 facade。
- `node-binding` 只处理 N-API 类型、任务调度和事件桥接。
- `code-agent-desktop` 只处理 Tauri Builder、Commands、Capabilities、路径和更新器。

## 6. 关键接口设计

### 6.1 前端 Client 与 Transport

`packages/client` 保留 UI 当前依赖的领域方法，但不再创建 `fetch` 或 `WebSocket`。需要引入以下宿主边界：

```ts
export interface CodeAgentTransport {
  request<TInput, TOutput>(operation: CodeAgentOperation<TInput, TOutput>): Promise<TOutput>;
  subscribeEvents(options: AgentEventSubscriptionOptions): AgentEventSubscription;
  resolveAssetUrl(reference: AssetReference): string;
}
```

实施约束：

- `CodeAgentClient` 继续提供明确的项目、任务、设置、Git 和附件方法，不让 UI 拼接 route 或 command name。
- 每个请求携带 `requestId`、输入 Schema 和输出 Schema 标识。
- `AbortSignal` 触发 Transport 的显式取消，不允许只在 Renderer 丢弃 Promise。
- HTTP Transport 将 `requestId` 映射到现有 HTTP 取消行为。
- Tauri Transport 在取消时调用 `cancel_operation`，Rust Runtime 使用 `CancellationToken` 终止实际任务。
- Transport 统一返回结构化 `CodeAgentError`，保留稳定 `code`、可展示 `message`、可选 `details`，不把 Rust backtrace 暴露给 Renderer。

### 6.2 Tauri Command 分组

Commands 按领域放入独立模块，并全部注册到 `tauri::generate_handler![]`：

```text
commands/app.rs
commands/projects.rs
commands/tasks.rs
commands/turns.rs
commands/settings.rs
commands/provider.rs
commands/files.rs
commands/git.rs
commands/attachments.rs
commands/events.rs
commands/cancellation.rs
```

每个 async Command：

- 参数使用 owned types，返回 `Result<T, CommandError>`。
- 只完成 DTO 转换、身份/路径检查和 Runtime 调用。
- 不持有锁跨越 `.await`。
- 不执行同步磁盘 I/O、Git 或 SQLite 查询。
- 使用领域化名称，例如 `project_list`、`task_create`、`turn_start`，不使用万能 JSON dispatcher。

### 6.3 Runtime State

Tauri 只管理一个 `Arc<CodeAgentRuntime>`。Runtime 内部按资源使用细粒度状态：

- `tokio::sync::RwLock` 只保护小型共享索引。
- 有序写入使用单 owner task 和有界 `mpsc`，不使用包住整个 Runtime 的全局 `Mutex`。
- SQLite 使用独立数据库线程和有界命令队列，避免阻塞 Tokio worker。
- Codex stdout/stderr reader、RPC writer 和进程 watcher 分离，退出信号统一进入 Runtime supervisor。
- 所有后台 task 都挂入可取消的生命周期树；窗口退出时按 Event subscription、Runtime、SQLite、Codex 的顺序关闭。

### 6.4 Agent Event Streaming

`sessionId`、`sequence`、Checkpoint、Snapshot 重同步、Delta 合并和有界历史迁入 `code-agent-runtime`，HTTP WebSocket 和 Tauri Channel 只负责发送。

Tauri 实现：

1. Renderer 调用 `event_subscribe`，传入 `projectId`、`sessionId`、`afterSequence` 和 `Channel<AgentEventMessage>`。
2. Runtime 先判断能否从有界历史回放；不能回放时发送 `resync_required`。
3. 每个订阅拥有有界发送队列，队列容量同时受事件数和字节数限制。
4. Provider Delta 在 Runtime 内按现有语义合并，关键状态事件先刷新更早 Delta。
5. Channel 保持有序发送；不使用 Tauri global event 承载高频 token。
6. Renderer 继续检查 `sessionId` 和连续 `sequence`，发现 gap 后丢弃订阅并刷新 Snapshot。
7. Renderer 卸载 Project Runtime 时调用 `event_unsubscribe`，Rust 同步清理队列和 listener。

如果 Tauri Channel 缺少足够的下游压力反馈，增加批量 `event_ack`：Renderer 每帧或每 100ms 回报最后应用的 `sequence`，Runtime 按未确认事件数、字节数和时间上限触发重同步。是否启用必须由 Phase 0 压测决定，不能使用无界队列代替。

### 6.5 二进制与资源

- Renderer 上传 `File` 时转换为 `Uint8Array`，使用 raw IPC body，不进行 base64 或 JSON 数组编码。
- Rust 使用 `tauri::ipc::Request` 读取 raw body，校验 headers 中的 metadata、媒体类型、声明长度和实际字节数。
- 小型返回二进制使用 `tauri::ipc::Response`。
- 历史图片和附件使用 `codeagent-asset://` 自定义 URI protocol，以 opaque ID 定位资源；不把绝对路径暴露给 Renderer。
- URI handler 必须校验 ID 所属 Project/Task、canonical path、媒体类型、大小和允许范围；它的首要目标是避免内容进入 JS heap，超大内容仍使用分页或 Range 读取。
- 不配置覆盖 `$HOME/**` 的宽泛 `assetScope`。
- 大型源码继续使用分页、截断和缓存预算，不经 IPC 一次返回完整仓库文件。

### 6.6 Codex binary

- `code-agent-provider-codex` 使用 Tokio process API 直接启动 Codex App Server。
- Desktop 构建从锁定的 `@openai/codex` 平台包提取 binary，复制为 Tauri `externalBin` 要求的 target-triple 文件名。
- 构建脚本校验 Codex 版本、目标架构、可执行权限和 lockfile integrity。
- Node CLI 继续从 `@openai/codex` 解析 binary path，并通过 `EngineOptions.codex_path` 传给 Rust Runtime。
- binary 参数只由 Rust Provider 构建，Renderer 不能传递任意 executable 或任意 shell arguments。
- Codex 意外退出必须转化为 Runtime failure，通知所有订阅并完成资源清理。

## 7. 协议单一来源

迁移期间继续以 `packages/protocol` TypeBox Schema 为公开协议源，Rust DTO 通过确定性生成获得：

1. `tools/generate-code-agent-schema.mjs` 按领域导出 `schemas/code-agent/*.schema.json`。
2. `crates/protocol-gen` 使用 `typify` 生成检查入库的 Rust modules。
3. 生成文件禁止手工编辑；领域 helper 和 newtype 放在非生成模块。
4. `pnpm run protocol:rust:check` 重新生成到临时目录并比较差异。
5. TS 和 Rust 共用合法、缺字段、额外字段、错误 discriminant、边界长度和 Unicode fixtures。
6. Agent Event tagged union、`camelCase` 字段、时间戳、整数范围和 nullability 必须逐项 round-trip。

如果 `typify` 无法无损表达某个 TypeBox Schema，应先调整 Schema 为明确、可移植的 JSON Schema，或为该类型增加受测试的手写 adapter；禁止静默放宽 Rust 校验。

当 Node 和 Tauri 都切换到 Rust Engine 后，领域内部可以使用更强的 Rust types，但跨 IPC、N-API 和 HTTP 的 DTO 仍由 `packages/protocol` 定义。

## 8. SQLite 迁移策略

### 8.1 实现选择

- `code-agent-platform` 使用 `rusqlite` 和 bundled SQLite，减少目标系统差异。
- 保持 WAL、`foreign_keys=ON`、`synchronous=NORMAL`、`busy_timeout=5000` 和 `STRICT` tables。
- 数据库只由 dedicated thread 持有 connection；Runtime 通过有界队列请求。
- 查询返回 owned DTO，不能把 SQLite row 或 transaction lifetime 泄漏到 async Runtime。

### 8.2 切换步骤

1. 将现有迁移 SQL 提取为 `crates/platform/migrations/*.sql`，保持版本号、顺序和内容。
2. 为当前每个历史 migration version 生成脱敏 fixture database。
3. Rust Repository 对所有 fixture 执行升级，并验证 rows、foreign keys、WAL 和 `integrity_check`。
4. Rust Repository 先只实现当前 Schema，不在 Node 仍使用旧 Repository 时引入不兼容的新 Schema。
5. Desktop 首次打开数据库前确认没有活跃 CodeAgent owner，创建一次可恢复备份，再在事务中迁移。
6. Desktop 和 Node N-API 都通过同一 Rust Repository 后，删除 `sqlite-state-repository.ts`、Worker 和 TypeScript migrations。
7. 后续 Schema 变更只允许从 `crates/platform/migrations` 增加单调版本。

禁止双写。迁移失败时保持原数据库和备份不变，阻止 Engine 启动并返回诊断信息；不能创建空数据库掩盖错误。

## 9. 分阶段实施

每一阶段单独合并，必须满足该阶段验收条件后才能继续。标记为“删除”的代码不能推迟到项目末尾集中清理。

阶段状态：

- Phase 0：已由现有性能门禁与技术验证覆盖；持续基线位于 `tests/performance-budgets.json`。
- Phase 1：已完成，执行记录见 `.superwork/plans/2026-08-12-tauri-phase-1-desktop-shell.md`。
- Phase 2：已完成，执行记录见 `.superwork/plans/2026-08-12-tauri-phase-2-client-transports.md`。
- Phase 3：已完成，执行记录见 `.superwork/plans/2026-08-12-tauri-phase-3-rust-runtime.md`。
- Phase 4 至 Phase 9：待开始。

### Phase 0：建立基线与技术验证

实施项：

- 记录 macOS、Windows、Linux 基准机信息和测量方法。
- 测量当前 Node CLI 的进程树、冷启动、首个可交互时间、空闲 RSS、30 分钟流式任务内存、Web bundle 和 npm tarball 大小。
- 创建最小 Tauri spike，验证现有 `dist/web` 能在系统 WebView 正确渲染。
- 验证 `invoke`、`Channel`、raw IPC、Codex external binary、SQLite bundled build 和 custom URI protocol。
- 用 10,000 个顺序事件压测 Channel，记录吞吐、P50/P95/P99 延迟、Renderer long task 和内存平台期。
- 验证 TypeBox JSON Schema 到 Rust DTO 的生成质量。

验收项：

- 不存在 Node/Fastify Desktop 进程。
- 事件保持顺序；队列达到上限时进入确定性重同步，不产生无界内存增长。
- raw IPC 的 10 MiB payload 不经过 base64，Renderer heap 不保留重复副本。
- 形成 `performance-budgets.json`，后续 CI 以同一基准机和口径检查回退。
- 明确支持的最低 macOS、Windows 和 Linux 版本。

### Phase 1：建立双 Workspace 和 Desktop 壳

实施项：

- 创建根 `Cargo.toml` virtual workspace，设置 `resolver = "3"`、`workspace.package`、`workspace.dependencies` 和 `workspace.lints`。
- 创建 `apps/desktop`、`apps/desktop/src-tauri` 和空的 Rust crates。
- `main.rs` 只调用 `lib.rs::run()`；Builder、State、Commands 和 plugin 注册放在 `lib.rs`。
- Tauri `frontendDist` 指向 `dist/desktop`，开发时使用现有 Vite Server。
- `apps/desktop/package.json` 只包含 Tauri CLI、Desktop scripts 和必要 plugins。
- 在 `pnpm-workspace.yaml` catalog 锁定 Tauri JavaScript 依赖版本，在 Cargo Workspace 锁定对应 Rust crates。
- 根 scripts 增加独立的 `build:web`、`build:desktop-ui`、`build:desktop`、`check:rust`，不改变现有 npm 发布结果。

验收项：

- `pnpm --filter @code-agent/desktop build` 能生成最小未签名 Desktop artifact。
- `cargo check --workspace --locked`、`cargo clippy`、`cargo test` 通过。
- Web 产物仍位于 `dist/web`；Desktop UI 位于 `dist/desktop`，两者互不覆盖。
- Desktop 启动后只显示现有 UI，不声称业务功能已完成。

### Phase 2：拆分 Client 与 Transport

实施项：

- 从 `packages/client` 提取当前 HTTP/WebSocket 实现到 `packages/transport-http`。
- `packages/client` 仅保留 facade、Transport interfaces、结构化错误、Schema validation 和 request ID。
- 创建 `packages/transport-tauri`，先实现 app info、access status 和 diagnostics。
- 在 `apps/web` 增加唯一的 `createHostClient()` Composition Root。
- Vite 根据显式 `CODE_AGENT_TARGET=web|desktop` 设置 build-time alias，禁止运行时同时导入两个 Transport。
- 更新 dependency-cruiser：Web 不能跨过 Client/Transport，两个 Transport 不能互相依赖。
- 为两种 Transport 建立同一套 contract tests。

删除项：

- 删除 `packages/client` 中直接创建全局 `fetch` 和 `WebSocket` 的默认路径。
- 删除 UI 内直接实例化固定 HTTP Client 的入口。
- 删除基于 `window.__TAURI__` 的产品逻辑分支。

验收项：

- 现有 Web、LAN、重连、取消和 E2E 行为保持通过。
- bundle report 证明 `dist/web` 没有 Tauri modules，`dist/desktop` 没有 HTTP/WebSocket Transport。
- Tauri diagnostics 可以通过 typed Command 往返，错误可被 UI 正确展示。

### Phase 3：建立 Rust Protocol、Core 与 Runtime 骨架

实施项：

- 实现 Schema 导出、Rust DTO 生成和 drift gate。
- 将 Project/Task identifiers、settings、Provider capability 和 errors 建模为 Rust types。
- 定义 Repository、Provider、Git、File、Attachment、Clock、Update ports。
- 实现 `CodeAgentRuntimeBuilder`，要求所有必需 ports 在 build 时存在。
- 实现有界 request registry、idempotency、cancellation 和 shutdown tree。
- 移植 Agent Event Stream 的 sequence、session、retention、coalescing、replay 和 resync 规则。
- 使用 fake Provider/Repository 建立 Runtime integration tests。

验收项：

- TS/Rust 协议 fixtures 双向通过。
- Runtime 测试覆盖正常流、Provider 崩溃、取消、重复 idempotency key、sequence gap、retention overflow 和 shutdown。
- `cargo clippy --all-targets --all-features --locked -- -D warnings` 通过。
- 性能热点不使用无界 channel、循环内大对象 clone 或全局锁。

### Phase 4：迁移 SQLite 与宿主平台能力

按以下垂直切片逐项迁移，每个切片同时包含 port、Rust 实现、Tauri Command、Transport 方法和契约测试：

1. Project registry、排序、临时 Project 和默认设置。
2. Global settings、Task settings 和 Provider connection。
3. Project directory browsing、host file browsing 和 system open。
4. Source file progressive loading、image loading 和 file tree。
5. Attachment import、存储、读取、打开和清理。
6. Git status、diff、history、branch、commit 和 review。

实施约束：

- 路径进入 Runtime 前进行 canonicalization 和 Project root containment 检查。
- Git 和文件 I/O 不阻塞 Tokio worker；长任务可取消并设置超时。
- `rusqlite` connection 只存在于 dedicated DB thread。
- 每个切片完成后对比现有 HTTP 响应 fixture 和 Rust 结果。

验收项：

- Tauri 可以在同一个现有数据库上读取和修改项目、设置。
- fixture databases 从所有历史版本升级成功。
- Git/文件/附件在 macOS、Windows 和 Linux 路径语义下通过测试。
- 10 MiB 附件上传、预览和打开不使用 base64，不泄漏绝对路径。

### Phase 5：迁移 Codex Provider 与实时任务链路

实施项：

- 将 Codex App Server process、JSONL reader/writer、request correlation、notification mapping 和 capability discovery 迁到 `code-agent-provider-codex`。
- 保持 Codex Schema baseline 校验；升级 Codex 时继续显式审查 Schema drift。
- 实现 Project Runtime context、Task snapshot、turn start/steer/queue/interrupt、approval、review 和 MCP/terminal request。
- 将 Provider events 直接写入 Rust Agent Event Stream，再由 Tauri Channel 发送。
- 实现 Codex binary 的 Desktop 目标平台准备脚本。
- 实现 Codex 退出、卡死、stdout malformed frame、RPC timeout 和 shutdown escalation。

删除项：

- 每个迁移完成的 Provider 功能从 `packages/provider-codex` 删除。
- 每个迁移完成的 Runtime 功能从 `packages/server` 删除。

验收项：

- Desktop 可以完成创建任务、流式回复、工具调用、审批、steer、queue、interrupt 和恢复 Snapshot 的完整流程。
- 高频事件不会超过每 animation frame 一次 UI 批量提交。
- Codex 退出后 Desktop 不遗留子进程、订阅或数据库 owner。
- 相同 fixture 在 HTTP 和 Tauri 两条 Delivery 路径得到相同领域结果。

### Phase 6：完成 Desktop 宿主功能与安全收敛

实施项：

- 实现原生目录/文件选择、系统打开、通知和应用信息。
- 配置严格 CSP；禁止 remote navigation 和 remote Tauri API access。
- 在 `capabilities/*.json` 按窗口和功能启用最小权限，并在 `tauri.conf.json` 显式列出。
- 前端不获得任意 `fs`、`shell:execute` 或任意 URL HTTP 权限。
- Codex external binary 只由 Rust backend 启动。
- 加入 single-instance、窗口关闭和应用退出策略；不默认增加托盘驻留。
- 为 `CodeAgentError` 增加用户可读错误与内部 tracing correlation ID。

验收项：

- 权限清单不存在 wildcard path、wildcard executable 或未使用 plugin permission。
- CSP 下现有 Markdown、Shiki、图片、附件和字体正常显示。
- DevTools 只在 debug 构建开启。
- 恶意 attachment ID、越界路径、伪造 command 参数和 oversized payload 均被拒绝。

### Phase 7：通过 N-API 让 Node 复用 Rust Engine

实施项：

- 使用 napi-rs 创建 `code-agent-node-binding`，导出 async Engine facade。
- N-API 只暴露 DTO、Promise、subscription handle 和 close；不暴露 Rust 内部对象图。
- Runtime events 通过 bounded bridge 和 `ThreadsafeFunction` 进入 Node。
- 创建 `packages/engine-node`，负责加载目标平台 `.node` package、binary path 和错误诊断。
- 修改 `src/cli-command.ts`/最终 `apps/node-cli`，由它装配 Rust Engine 与 `packages/server`。
- 将 `packages/server` 收敛为 Fastify routes、access control、static files、HTTP serialization 和 WebSocket sender。
- 使用现有 HTTP/E2E/性能测试验证 N-API Engine。

删除项：

- 删除 TypeScript `packages/core`。
- 删除 TypeScript `packages/provider-codex`。
- 删除 `packages/server` 中 SQLite、Git、文件、附件、Runtime、idempotency 和 event stream 实现。
- 删除 `better-sqlite3`、SQLite Worker 和不再使用的 Node dependencies。

验收项：

- `@bryanhu/code-agent start` 的 HTTP/LAN 行为通过现有测试。
- Node 与 Desktop 使用同一个 `code-agent-runtime` 和 SQLite migrations。
- `package:check` 验证每个目标平台 native addon 正确加载，不触发隐式 `node-gyp rebuild`。
- Node shutdown、Codex crash 和 native error 不导致资源泄漏或未处理 Promise。

### Phase 8：整理发布包和根 Workspace

实施项：

- 将 npm CLI package 从根目录迁到 `apps/node-cli`，保留包名 `@bryanhu/code-agent` 和命令 `code-agent`。
- 根 `package.json` 设置 `private: true`，只保存统一产品版本、Workspace scripts 和开发依赖。
- 由 napi-rs 生成/维护目标平台 native packages，主 npm 包使用 `optionalDependencies` 选择平台。
- Tauri `version` 指向根 `package.json`，Cargo packages 使用 `version.workspace = true`。
- 增加版本一致性检查，覆盖 Node CLI、native packages、Cargo 和 Tauri config。
- 更新 `docs/releasing.md`，明确 npm、Desktop、签名、更新器和失败恢复流程。

验收项：

- `pnpm pack` 产物只包含 CLI、Web 静态资源、Server Delivery、N-API loader 和所需声明文件。
- Desktop 安装包不包含 Node、Fastify、WebSocket Server 或 N-API addon。
- 内部 `@code-agent/*` packages 保持 private，不单独发布。
- 一个 `vX.Y.Z` tag 可重现所有目标 artifacts。

### Phase 9：签名、Updater 与正式发布

实施项：

- macOS 配置 Developer ID、Hardened Runtime、签名和 notarization。
- Windows 配置 OV/EV code signing 和时间戳服务。
- Linux 在最低支持系统上构建，验证 WebKitGTK 4.1、glibc 和安装依赖。
- 配置 `tauri-plugin-updater`、HTTPS endpoint、public key 和 updater capability。
- CI secret 只保存 updater private key、Apple/Windows 签名材料，不写入仓库或构建日志。
- 先发布 native npm packages，再发布主 CLI；Desktop artifacts 上传同一个 GitHub Release。
- Release 创建为 draft，全部平台安装、签名和 smoke 通过后再公开。

验收项：

- macOS Gatekeeper、Windows SmartScreen/签名检查和 Linux clean VM 安装通过。
- Updater 验证合法签名、拒绝篡改 artifact，并能从前一正式版本升级。
- npm、Desktop 和 updater metadata 版本一致。
- GitHub Release 包含 checksum、签名、目标架构和最低系统说明。

## 10. Vite 双目标构建

使用显式 mode 和 build-time alias：

```text
CODE_AGENT_TARGET=web
  @code-agent/host-transport -> @code-agent/transport-http
  outDir -> dist/web

CODE_AGENT_TARGET=desktop
  @code-agent/host-transport -> @code-agent/transport-tauri
  outDir -> dist/desktop
```

实施要求：

- `vite.config.ts` 校验 target，只接受 `web` 或 `desktop`，缺失时构建失败。
- 两个 target 使用同一套 React source、Tailwind、i18n 和 route tree。
- Web 继续使用当前最低浏览器 targets；Desktop 单独根据最低系统 WebView 确定 target，不能直接设为 `esnext` 后假设所有 WebView 一致。
- proxy 只在 `web` dev target 开启；Desktop dev target 直接调用 IPC。
- 保留 `manifest`、无 sourcemap 和 bundle budget。
- 增加 forbidden-module bundle scan，防止 Transport 依赖泄漏。

## 11. 性能门禁

### 11.1 测量维度

| 维度         | 起点                  | 终点                                     |
| ------------ | --------------------- | ---------------------------------------- |
| 冷启动       | Process spawn         | 主窗口首个可交互 frame                   |
| Engine ready | Process spawn         | SQLite + Codex handshake + Runtime ready |
| 空闲内存     | Engine ready 后 60 秒 | App、WebView、Codex 分进程记录 RSS/PSS   |
| 事件延迟     | Runtime 分配 sequence | Renderer 完成对应批次提交                |
| 流式稳定性   | 30 分钟持续 delta     | RSS、JS heap、队列长度和 long task 趋势  |
| 二进制传输   | Renderer 发起上传     | Rust 完成落盘和返回 metadata             |
| 包体积       | release build         | 解压后 App、Codex、Web assets 分项统计   |

### 11.2 合并规则

- Phase 0 结束前必须将平台预算写入版本化的 `performance-budgets.json`。
- 同一基准机 P95 冷启动、事件延迟或空闲内存回退超过 10% 时阻止合并；测量噪声必须通过多轮采样证明。
- token streaming 下 React 更新频率不得高于每 animation frame 一次。
- event、DB、N-API 和 IPC bridge 均必须有事件数与字节数双重上限。
- 30 分钟稳定性测试在 GC/idle 后的内存不得持续线性增长。
- 10 MiB binary round-trip 不允许 base64，JS heap 不应保留两个完整 payload 副本。
- `cargo bench`/Criterion 只用于稳定的纯 Rust 热点；真实 WebView 启动和 IPC 使用独立 Desktop harness。
- Release profile 初始使用 `opt-level = 3`、`lto = "thin"`、`codegen-units = 1`、`strip = "symbols"`，任何调整必须同时比较速度与包体积。
- 不在 Workspace 全局设置 `panic = "abort"`，避免 N-API panic 直接终止 Node 进程。

## 12. 测试矩阵

| 层级               | 工具                              | 必须覆盖                                            |
| ------------------ | --------------------------------- | --------------------------------------------------- |
| Protocol           | Vitest + Cargo tests              | Schema fixtures、round-trip、drift                  |
| Rust unit          | Cargo test                        | Core rules、errors、cancellation、bounded queues    |
| Rust integration   | Cargo test                        | SQLite、Codex fake process、Git/file fixtures       |
| Rust performance   | Criterion + harness               | Event stream、snapshot、serialization、DB hot paths |
| Transport contract | Vitest                            | HTTP 与 Tauri 对同一 Client contract 的行为         |
| Tauri frontend     | Vitest `mockIPC`                  | Command mapping、errors、cleanup、AbortSignal       |
| Web E2E            | Playwright                        | 浏览器和 LAN 用户流程                               |
| Desktop E2E        | WebdriverIO `@wdio/tauri-service` | 真正 IPC、窗口、启动、文件选择、更新 smoke          |
| Packaging          | clean VM                          | 安装、启动、签名、Codex binary、更新                |

测试分配原则：

- UI 交互和状态逻辑只在 Playwright/Vitest 完整测试一次。
- Tauri E2E 只覆盖宿主边界和关键 happy path，不复制整套浏览器 E2E。
- 每个 Tauri Command 至少有 Rust test 或 Transport contract test。
- 每个 capability/plugin 至少有一个 production-like smoke。
- `mockIPC` 测试结束后必须清理 mocks，避免跨测试污染。

## 13. CI 流水线

### 13.1 Pull Request 门禁

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
pnpm run protocol:rust:check
pnpm run desktop:bundle:check
```

- Ubuntu 和 Windows 运行完整 TypeScript/Rust 门禁。
- macOS 运行 Rust/Tauri build smoke、Codex binary resolution 和关键 Desktop E2E。
- Linux Runner 安装锁定的 WebKitGTK 4.1 开发依赖。
- Rust 使用 `rust-toolchain.toml` 锁定 stable toolchain；CI 使用 `Cargo.lock`。
- 缓存 pnpm store 和 Cargo registry/target，但 release artifact 不从不可信缓存直接发布。

### 13.2 Release 构建

每个平台原生构建，不进行跨平台 installer 构建：

| Runner      | Target                     | 产物                                  |
| ----------- | -------------------------- | ------------------------------------- |
| macOS arm64 | `aarch64-apple-darwin`     | `.app`、`.dmg`、updater artifact      |
| macOS x64   | `x86_64-apple-darwin`      | `.app`、`.dmg`、updater artifact      |
| Windows x64 | `x86_64-pc-windows-msvc`   | `.msi`、NSIS `.exe`、updater artifact |
| Linux x64   | `x86_64-unknown-linux-gnu` | `.deb`、`.rpm`、`.AppImage`           |

发布时分别构建 `code-agent-desktop` 和 `code-agent-node-binding`，不要使用 `cargo build --workspace --all-features` 生成发布产物，避免宿主 feature 合并进入错误 artifact。

## 14. 安全检查表

- [ ] Tauri 只加载打包的本地 UI，不配置 remote URL capability。
- [ ] `tauri.conf.json` 显式列出启用的 capability identifiers。
- [ ] capability 只针对 `main` window，不使用不必要的 `*`。
- [ ] Renderer 不拥有任意 filesystem、shell execute 或 process spawn 能力。
- [ ] 所有文件路径在 Rust 端 canonicalize 并校验 Project root/Attachment root。
- [ ] Codex executable、arguments 和 environment 由 Rust 构建并过滤。
- [ ] IPC 输入在进入 Core 前通过长度、Schema 和语义校验。
- [ ] Custom URI protocol 只接受 opaque ID，拒绝原始绝对路径和 traversal。
- [ ] Production 禁用 DevTools，CSP 不包含无必要的 `unsafe-eval`。
- [ ] updater 只使用 HTTPS、签名 artifact 和受保护 private key。
- [ ] npm、Cargo 和 GitHub Actions 同时执行依赖审计与 lockfile 校验。

## 15. 可观测性与故障诊断

- Rust 使用结构化 tracing，字段至少包含 `requestId`、`projectId`、`taskId`、`operation`、`durationMs` 和 error code。
- 日志默认写入 Tauri app log directory，不写 prompt、attachment content、token 或完整绝对路径。
- Runtime 暴露只读 diagnostics：Codex version、database migration、event queue、retention eviction、backpressure、active tasks 和 shutdown state。
- Desktop crash report 与用户内容分离，默认不上传敏感数据。
- N-API error 必须保留 Rust error chain 到本地日志，但只把稳定错误码和安全 message 传给 Node/Renderer。
- `doctor` 最终同时支持 Node CLI diagnostics 和 Desktop diagnostics 页面使用同一 Runtime API。

## 16. 风险与处理

| 风险                                     | 处理                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| TypeBox 无法完整生成 Rust DTO            | Phase 0 做全协议 spike；使用显式 adapter 和共用 fixtures，不放宽校验                |
| Tauri Channel 对慢 Renderer 缺少压力反馈 | 有界 bridge、Delta 合并、sequence gap 重同步；必要时启用批量 ack                    |
| Rust SQLite 与现有 migration 行为不同    | 历史版本 fixture、事务迁移、备份、`integrity_check`，禁止双写                       |
| GUI App 找不到用户 shell 中的 Codex/Git  | Codex 使用 bundled resource；Git 使用明确 discovery 和诊断，不假定 shell rc `$PATH` |
| Linux WebKitGTK/glibc 差异               | 在最低支持发行版构建并对目标发行版做 clean VM smoke                                 |
| N-API panic 或 Tokio Runtime 管理错误    | 所有边界返回 `Result`，catch unwind 只作最后保护，不使用全局 `panic=abort`          |
| Tauri/Node 功能短期漂移                  | 以 Transport contract 和同一个 Rust Runtime 收敛；每个切片迁完即删除旧实现          |
| 安装包被 Codex binary 主导               | 分项记录包体积；不重复打包 Node Runtime；按目标架构单独发布                         |
| 发布矩阵显著增加 CI 时间                 | PR 使用分层门禁，完整签名和 installer 测试只在 release/daily workflow 执行          |

## 17. 完成定义

以下条件全部满足才算完成 Tauri 接入：

- [ ] `apps/web` 是 Web 和 Desktop 唯一 UI 源码。
- [ ] Desktop 进程树不存在 Node、Fastify 和 localhost CodeAgent Server。
- [ ] Node CLI 与 Desktop 使用同一个 Rust Runtime、Provider 和 SQLite migrations。
- [ ] TypeScript `packages/core`、`packages/provider-codex` 和 Server 内旧 Runtime 已删除。
- [ ] HTTP/WebSocket 与 Tauri IPC Transport contract 全部通过。
- [ ] Agent Event 顺序、重放、gap、backpressure 和 Snapshot 恢复通过压力测试。
- [ ] 附件和图片全链路不使用 base64，不暴露宿主绝对路径。
- [ ] 当前 SQLite 数据升级、备份、故障恢复和完整性检查通过。
- [ ] macOS、Windows、Linux 安装、Codex 启动、Git/文件操作和更新通过 clean VM smoke。
- [ ] 性能预算、bundle budget、native package 和签名门禁进入 CI。
- [ ] npm 包和所有 Desktop artifacts 可由同一 tag 重现。
- [ ] `docs/releasing.md`、README 安装方式和故障诊断已更新。

## 18. 官方参考

- [Tauri Configuration](https://v2.tauri.app/reference/config/)
- [Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)
- [Calling the Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
- [Embedding Additional Files](https://v2.tauri.app/develop/resources/)
- [Tauri Tests](https://v2.tauri.app/develop/tests/)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
- [Tauri Distribution](https://v2.tauri.app/distribute/)
- [Cargo Workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
- [Cargo Profiles](https://doc.rust-lang.org/cargo/reference/profiles.html)
