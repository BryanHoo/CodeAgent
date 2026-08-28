# Codexly 工作台能力矩阵

## 结论

CodeAgent 的左栏、中心工作台、右栏检查器和设置入口已改为：

```text
React -> Tauri invoke / Channel -> Rust -> codex app-server -> stdio JSONL
```

运行时不再使用 Codexly HTTP、WebSocket 或 mock。协议基线固定为本地
`/Users/bryanhu/Develop/person/codex` 的 `rust-v0.149.0`，运行时只接受
`codex-cli 0.149.0`。

## 逐项矩阵

| 能力 | Codexly 公共方法 | CodeAgent 实现 | 状态 |
| --- | --- | --- | --- |
| 运行时与健康 | `getHealth`, `getCapabilities` | Rust 子进程握手、精确版本校验、失败恢复、有界消息队列 | 已实现 |
| 项目列表 | `listProjects`, `addProject`, `renameProject`, `removeProject`, `reorderProjects` | 原生 `project/*` app-server 方法 | 已实现 |
| 项目目录 | `listProjectDirectories` | Rust 受限目录枚举，不向 WebView 暴露 shell | 已实现 |
| 项目打开方式 | `getProjectOpenCapabilities`, `openProject` | 按系统安装状态探测编辑器、终端与文件管理器，再通过受限应用 ID 打开 | 已实现 |
| 任务列表 | `listTasks`, `startTask`, `renameTask`, `pinTask` | 原生 `thread/list`, `thread/start`, `thread/name/set`, `thread/section/set` | 已实现 |
| 归档与删除 | `archiveTask`, `unarchiveTask`, `deleteTask`, `unsubscribeTask` | 原生 thread 生命周期；活跃任务禁止错误释放 | 已实现 |
| 会话快照 | `readTask` | `thread/read(includeTurns:false)` + `thread/turns/list` | 已实现 |
| 长历史分页 | `readTask` cursor | `legacy` 使用 `full`；`paginated` 使用 `notLoaded` + 并发 `thread/items/list` | 已实现 |
| 回合控制 | `startTurn`, `steerTurn`, `interruptTurn` | 原生 `turn/start`, `turn/steer`, `turn/interrupt` | 已实现 |
| Goal 模式 | `updateTaskGoal`, `clearTaskGoal` | 原生 `thread/goal/*`；Goal 启动等待真实 `turn/started` | 已实现 |
| 高级会话 | `startReview`, `compactTask`, `forkTask` | 原生 `review/start`, `thread/compact/start`, `thread/fork` | 已实现 |
| 任务设置 | `getTaskSettings`, `updateTaskSettings` | 应用私有原子 JSON；启动回合前持久化并同步线程设置 | 已实现 |
| 排队提交 | `list/add/update/delete/reorder/startQueuedSubmission` | 原生 `thread/queue/*`，保留顺序和编辑状态 | 已实现 |
| 后台终端 | `listBackgroundTerminals`, `terminateBackgroundTerminal` | 原生 `thread/backgroundTerminals/*` | 已实现 |
| 流式时间线 | `subscribeEvents` | 单一 Tauri `Channel`；单调序号、缺口重同步、失败重连；上下文占用读取 `tokenUsage.last` | 已实现 |
| Item 映射 | 消息、推理、计划、命令、Diff、MCP 等 | 覆盖 Codex 0.149 官方 Item；未知类型降级为可见活动 | 已实现 |
| 输出背压 | 命令输出 | 历史输出限制 1 MiB/10,000 行；实时输出由前端有界缓冲 | 已实现 |
| 审批与输入 | `resolvePendingRequest` | 命令、文件变更、工具、用户输入、MCP elicitation 原生回写 | 已实现 |
| 文件树与搜索 | `list/search/stop/read/rename/deleteProjectFile` | Rust 路径包含校验、搜索取消和结果上限 | 已实现 |
| 附件 | `uploadAttachment`, `importHostAttachment`, `openTaskAttachment` | 对齐 0.149 `text`/`localImage` 输入；Rust 校验 UTF-8、类型、大小与缓存边界 | 已实现 |
| Git 状态与历史 | `getProjectGitStatus`, `getProjectGitHistory` | 受限 Git 子进程、结构化解析 | 已实现 |
| Git Diff 与提交 | commit files/diff、`generateCommitMessage`, `commitProjectChanges` | 选中文件提交、陈旧快照拒绝、真实 Diff；临时只读 Turn 调用配置模型生成 message | 已实现 |
| 分支与 worktree | switch/create/list | 受限 Git 命令和项目根校验 | 已实现 |
| 右栏检查器 | 文件、Sources、Changes、历史 | 全部由上述 Tauri 文件/Git接口驱动 | 已实现 |
| 模型与 Skills | `listModels`, `listSkills` | 原生 `model/list`, `skills/list` | 已实现 |
| MCP | `listMcpServers`, `retryMcpServers` | 原生 `mcpServerStatus/list`, `config/mcpServer/reload`；启动状态通知驱动清单刷新 | 已实现 |
| Provider 认证 | login/cancel/logout/custom provider | 原生账号协议与受限配置写入；密钥不持久化到 WebView | 已实现 |
| 全局/项目设置 | get/update settings/defaults | Codex `config/read` + 应用原子配置 | 已实现 |
| Feedback | `uploadFeedback` | 原生 `feedback/upload` | 已实现 |
| 宠物 | `listWorkbenchPets`, `downloadWorkbenchPet` | 内置 CDN 下载、WebP 校验、自定义 `pets`/旧 `avatars` 扫描、动态资产授权 | 已实现 |
| Bing 每日壁纸 | `/v1/workbench-background/bing` | Rust 固定来源有界下载、JPEG 校验、原子缓存、Tauri asset protocol | 已实现 |
| CodeAgent 本地偏好与自定义背景 | WebView `localStorage`、IndexedDB | Tauri IPC、`appData/app.json`、`appData/backgrounds/custom/`，首次启动自动迁移 | 已实现 |
| 本地访问模式 | access pair/logout/status | 桌面端固定 `local`，无 HTTP 服务和 LAN 认证面 | 等价替代 |
| 应用内更新 | `getAppInfo`, `installAppUpdate` | 返回应用/Codex 真实版本；当前构建没有签名发布源，不宣告可用更新 | 分发边界 |

## 协议事件覆盖

| 类别 | Codex 0.149 通知 |
| --- | --- |
| 回合 | `turn/started`, `turn/completed`, `turn/plan/updated` |
| 文本与推理 | `item/agentMessage/delta`, reasoning delta/summary 通知 |
| 工具与文件 | command output、MCP progress、file patch、item started/completed |
| 运行时 | warning/error、token usage、model reroute/safety/verification |
| 生命周期 | thread status/name/archive/delete、goal、queue |
| 扩展流程 | hook、auto approval review、background terminal、认证、MCP status |

## 传输与性能证据

- `AppServerConnection` 使用请求 ID 匹配乱序响应，`-32001` 过载有限重试。
- stdout 按 JSONL 增量读取，stderr 独立排水，通知队列容量为 256。
- 前端只保留 1,024 条近期事件，流式文本按动画帧批量提交。
- 历史页每次读取 10 个 Turn，每个 Turn 的 Item 每页 100 条，同页 Turn 并发补全。
- 文件变更、附件、命令输出、搜索结果和运行时事件均设有大小或数量边界。
- 源码不存在 `new WebSocket`、Codexly `/v1/*` 调用或 mock 运行时；Bing 壁纸也通过原生命令获取。

## 证据索引

- 架构依据：`docs/architecture-research.md`
- Rust app-server 连接：`src-tauri/src/infrastructure/codex/connection.rs`
- 进程与版本：`src-tauri/src/infrastructure/codex/process.rs`
- 历史与 Item：`src-tauri/src/infrastructure/codex/conversation.rs`
- Tauri 事件状态：`src-tauri/src/application/state.rs`
- 左栏客户端：`src/platform/tauri/sidebar-client.ts`
- 文件与 Git：`src-tauri/src/infrastructure/workspace/`
- 宠物资产：`src-tauri/src/application/pet_commands.rs`, `pet_assets.rs`
- Bing 壁纸：`src-tauri/src/application/background_commands.rs`

## 参考资料

- [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Tauri Rust 到前端通信](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri 前端调用 Rust](https://v2.tauri.app/develop/calling-rust/)
- [codex-webui](https://github.com/seo-rii/codex-webui)
- [CodexHarbor](https://github.com/adondada/codexharbor)
