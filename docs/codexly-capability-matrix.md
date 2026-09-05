# Codexly 工作台能力矩阵

## 结论

CodeAgent 的左栏、中心工作台、右栏检查器和设置入口已改为：

```text
React -> Tauri invoke / Channel -> Rust -> codex app-server -> stdio JSONL
```

运行时不再使用 Codexly HTTP、WebSocket 或 mock。协议基线固定为只读的本地
`/Users/bryanhu/Develop/person/codex` `rust-v0.153.4`；外部稳定运行时仅接受精确版本
`0.153.4`，应用私有回退包固定为 `0.153.4` 并校验 SHA-512。

### 0.153.4 接入边界

- `agentMessage.questions` 在 Composer 上方固定显示单选及自由回答，支持折叠、多组切换、未回答数量与限高内部滚动；时间线只读留存。首项预选但不自动发送，复用 Composer 在运行中追加消息或结束后开启回合，不清空草稿、不继承计划/Goal 模式。实时和历史共用有界映射，超预算回退官方 `text`；发送成功移出固定区，恢复历史时识别完整格式化回答，Delta 不重建问题列表。
- `Thread.model` / `reasoningEffort` 通过现有读取直接恢复到 Composer 的模型与思考强度，续聊发送沿用该配置；空值回退任务设置，用户手动选择优先，刷新不覆盖手动选择。沿用模型可用性与推理强度校验，不在 Inspector 重复展示，不增加读取、轮询或自动配置写回。
- 现有审批模式选择可在运行中切换 reviewer；只更新后续步骤审核路由，沙箱与已有审批不变。精确目标已结束时仅保存未来设置并提示，被托管策略拒绝则保留原设置。
- `plugin/reconcile` 和按 App 账户审批暂不新增入口；当前无插件管理流程，原始 usage metadata 不进入 WebView。
- 保持单一 stdio 连接、RawValue Delta 映射、有界队列与分页历史；协议快照由本机 `codex-cli 0.153.4` 携带 `--experimental` 生成。

## 逐项矩阵

| 能力 | Codexly 公共方法 | CodeAgent 实现 | 状态 |
| --- | --- | --- | --- |
| 运行时与健康 | `getHealth`, `getCapabilities` | 仅使用应用私有 Codex `0.153.4`，首次缺失、损坏或版本不符时自动安装；五个平台固定官方 npm 包通过 SHA-512 校验后原子切换，失败提供重试；后台已就绪时恢复窗口跳过检测，Rust supervisor 按 1–30 秒有界退避恢复；CI 验证私有安装、app-server 生命周期与实验协议 Schema | 已实现 |
| 项目列表 | `listProjects`, `addProject`, `renameProject`, `removeProject`, `reorderProjects` | 原生 `project/*` app-server 方法；兼容 0.152 `recencyAt`，继续按用户维护的 `position` 排序且不请求 `recencyAt` 排序 | 已实现 |
| 项目目录 | `listProjectDirectories` | Rust 受限目录枚举，不向 WebView 暴露 shell | 已实现 |
| 项目打开方式 | `getProjectOpenCapabilities`, `openProject` | 按系统安装状态探测编辑器、终端与文件管理器，再通过受限应用 ID 打开 | 已实现 |
| 任务列表 | `listTasks`, `startTask`, `renameTask`, `pinTask` | 原生 `thread/list`, `thread/start`, `thread/name/set`, `thread/section/set`；临时任务在 `appData/temporary-workspaces/` 分配独立 `cwd`；`thread/start`、`thread/resume`、`thread/fork` 均以线程配置覆盖启用 `tools.update_plan.enabled`，恢复时不覆盖已保存的 `cwd` | 已实现 |
| 归档与删除 | `archiveTask`, `unarchiveTask`, `deleteTask`, `unsubscribeTask` | 原生 thread 生命周期；删除临时任务后仅清理验证为受控直接子目录的工作区；Rust lease 管理器在终态触发释放，活跃任务保持 busy 并有界退避重试，WebView 只声明消费者挂载/卸载 | 已实现 |
| 会话快照 | `readTask` | `thread/read(includeTurns:false)` + `thread/turns/list` | 已实现 |
| 长历史分页 | `readTask` cursor | `legacy` 使用 `full`；`paginated` 使用 `notLoaded` + 并发 `thread/items/list` | 已实现 |
| 回合控制 | `startTurn`, `steerTurn`, `interruptTurn` | 原生 `turn/start`, `turn/steer`, `turn/interrupt` | 已实现 |
| Goal 模式 | `updateTaskGoal`, `clearTaskGoal` | 原生 `thread/goal/*`；Goal 启动等待真实 `turn/started` | 已实现 |
| 高级会话 | `startReview`, `compactTask`, `forkTask` | 原生 `review/start`, `thread/compact/start`, `thread/fork` | 已实现 |
| 任务设置 | `getTaskSettings`, `updateTaskSettings` | 应用私有原子 JSON；启动回合前持久化并同步线程设置 | 已实现 |
| 排队提交 | `list/add/update/delete/reorder/startQueuedSubmission` | 原生 `thread/queue/*`，保留顺序和编辑状态 | 已实现 |
| 后台终端 | `listBackgroundTerminals`, `terminateBackgroundTerminal` | 原生 `thread/backgroundTerminals/*` | 已实现 |
| 流式时间线 | `subscribeEvents` | 单一 Tauri `Channel`；单调序号、缺口重同步、失败重连；上下文占用读取 `tokenUsage.last` | 已实现 |
| 系统通知 | Task 终态、失败与待处理请求 | Rust 按持久化偏好直接发送，不依赖 WebView 是否存在、可见或处于前台 | 已实现 |
| 状态栏任务 | Task 运行态与任务跳转 | Rust `TaskActivityState` 统一维护运行、等待、完成、失败及项目/标题元数据；图标旁实时显示数量，左键显示动态菜单；WebView 只能读取状态快照并渲染 | 已实现 |
| Item 映射 | 消息、推理、计划、命令、Diff、MCP 等 | 覆盖 Codex 0.152 官方 Item，包括 `functionCallOutput`、新增协作工具与子代理完成态；未知类型降级为可见活动 | 已实现 |
| 输出背压 | 命令输出 | 历史输出限制 1 MiB/10,000 行；实时输出由前端有界缓冲 | 已实现 |
| 审批与输入 | `resolvePendingRequest` | 严格区分 0.152 `command`/`writeStdin`；终端输入保留 callback、会话、stdin 与 cwd 并提供独立审批界面；Guardian `writeStdin` 进入自动审批时间线；文件变更、权限、用户输入、MCP elicitation 原生回写 | 已实现 |
| 文件树与搜索 | `list/search/stop/read/rename/deleteProjectFile` | Rust 路径包含校验、过滤 `.git` 与 `.DS_Store`、遵守 ignore 规则的缓存索引、会话取消和结果上限；临时任务按 `thread/read.cwd` 验证预览根目录；源码与图片通过最小 capability 的轻量原生独立窗口预览 | 已实现 |
| 附件 | `uploadAttachment`, `importHostAttachment`, `openTaskAttachment` | 对齐 0.152 `text`/`localImage`/`localAudio`；图片固定 `detail: auto`，普通文件通过 `text_elements.placeholder` 保留身份并作为路径引用；浏览器上传使用 raw IPC，宿主文件单遍流式缓存；队列与历史完整恢复 | 已实现 |
| 模型输入能力 | `model/list.inputModalities` | 提交前按所选模型动态校验图片与音频能力；保留未知新模态，不使用本地硬编码模型名单 | 已实现 |
| 通用文件原生输入 | `input_file` | Codex 0.152 app-server `ContentItem` 没有该类型；项目不绕过 app-server，也不伪造协议，普通文件以本地路径交给 Codex 工具读取 | 上游未提供 |
| 生成图片 | `imageGeneration` | JSONL 接收边界验证并落盘 Base64，Timeline 和 Tauri `Channel` 仅传递固定大小附件元数据 | 已实现 |
| Git 状态与历史 | `getProjectGitStatus`, `getProjectGitHistory` | 受限 Git 子进程、结构化解析 | 已实现 |
| Git Diff 与提交 | commit files/diff、`generateCommitMessage`, `commitProjectChanges` | 选中文件提交、陈旧快照拒绝、真实 Diff；临时只读 Turn 调用配置模型生成 message | 已实现 |
| 分支与 worktree | switch/create/list | 受限 Git 命令和项目根校验 | 已实现 |
| 右栏检查器 | 文件、Sources、Changes、历史、MCP | MCP 按当前 Task 读取线程级权威快照并展示紧凑连接态与工具数 | 已实现 |
| 模型与 Skills | `listModels`, `listSkills` | 原生 `model/list`, `skills/list` | 已实现 |
| MCP | `listMcpServers`, `retryMcpServers` | 原生 `mcpServerStatus/list`, `config/value/write`, `config/mcpServer/reload`；`Skills & MCP` 入口仅投影全局服务名称与启用状态，切换后热重载连接；当前 Task 继续精确保留 0.152 线程连接态，启动通知只触发清单失效，IPC 仅传固定大小摘要；`openaiForm` 与 `openai/form` 均显式降级为 unsupported | 已实现 |
| Provider 认证 | login/cancel/logout/custom provider | 原生账号协议与受限配置写入；密钥不持久化到 WebView | 已实现 |
| 全局/项目设置 | get/update settings/defaults | `appData/agent-settings.json` 原子配置；返回实际变化字段，模型与权限默认值不写入 Codex 配置 | 已实现 |
| Feedback | `uploadFeedback` | 原生 `feedback/upload` | 已实现 |
| 宠物 | `listWorkbenchPets`, `downloadWorkbenchPet` | 内置 CDN 下载、WebP 校验、自定义 `pets`/旧 `avatars` 扫描、动态资产授权、全屏置顶桌面面板、拖动动画、Rust 任务活动投影与跨显示器位置恢复 | 已实现 |
| Bing 每日壁纸 | `/v1/workbench-background/bing` | Rust 固定来源有界下载、JPEG 校验、原子缓存、Tauri asset protocol | 已实现 |
| CodeAgent 本地偏好与自定义背景 | WebView `localStorage`、IndexedDB | `appData/app.json`、`appData/agent-settings.json`、`appData/backgrounds/custom/`；偏好与设置原子落盘，图片使用动态授权 asset URL，显式读取使用 raw IPC | 已实现 |
| 本地访问模式 | 无 Web 访问接口 | 桌面端固定 `local`，无 HTTP 服务和 LAN 认证面 | 原生实现 |
| 应用版本信息 | `getAppInfo` | 返回应用/Codex 真实版本；更新安装由外部分发渠道负责 | 已实现 |

## 协议事件覆盖

| 类别 | Codex 0.152 通知 |
| --- | --- |
| 回合 | `turn/started`, `turn/completed`, `turn/plan/updated` |
| 文本与推理 | `item/agentMessage/delta`, reasoning delta/summary 通知 |
| 工具与文件 | command output、MCP progress、file patch、`functionCallOutput`、九类协作 Agent 工具、item started/completed |
| 运行时 | warning/error、token usage、model reroute/safety/verification；认证恢复通知校验结构后显式消费，暂不投影 UI |
| 生命周期 | thread status/name/archive/delete、goal、queue |
| 扩展流程 | hook、含 `writeStdin` 的 auto approval review、background terminal、认证、MCP status |

`mcpServer/event/stream/notification` 仅由实验性 hosted app 事件订阅触发；三类
`thread/realtime/item/*` 通知仅属于完整 Realtime 语音会话。当前桌面产品没有对应的订阅、采集、
播放和转写交互，因此初始化时显式关闭这四类通知，避免无效 JSONL 传输与解析。后续只有在成组
实现对应产品工作流时才启用。

## 传输与性能证据

- `AppServerConnection` 使用请求 ID 匹配乱序响应，`-32001` 过载有限重试。
- stdout 按 JSONL 增量读取，stderr 独立排水，通知队列容量为 256。
- 普通 JSONL 帧继续使用 `RawValue` 快路；仅 `imageGeneration` 帧定向解析，图片正文不进入 WebView。
- 前端只保留 1,024 条近期事件，流式文本按动画帧批量提交。
- 历史页每次读取 10 个 Turn，每个 Turn 的 Item 每页 100 条，同页 Turn 并发补全。
- 文件搜索索引排除 ignore 与隐藏项、按项目根短时复用，并通过会话令牌取消过期扫描。
- 附件按内容寻址去重；raw IPC 不产生 JSON 数组膨胀，宿主导入单遍完成哈希与落盘。
- 文本限制 1 MiB，文件合计 50 MiB，图片合计 512 MiB 且最多 1500 张；前后端均校验，Rust 为最终边界。
- 自定义背景读取通过 `tauri::ipc::Response` 返回 `ArrayBuffer`；设置缩略图和工作台壁纸直接使用动态授权的 asset URL，避免大图 JSON 序列化及 WebView 字节复制。
- 源码不存在 `new WebSocket`、Codexly `/v1/*` 调用或 mock 运行时；Bing 壁纸也通过原生命令获取。

## 证据索引

- 架构依据：`docs/architecture-research.md`
- Rust app-server 连接：`src-tauri/src/infrastructure/codex/connection.rs`
- 进程与版本：`src-tauri/src/infrastructure/codex/process.rs`
- 运行时发现与按需下载：`src-tauri/src/infrastructure/codex/runtime_manager.rs`
- 历史与 Item：`src-tauri/src/infrastructure/codex/conversation.rs`
- Tauri 事件状态：`src-tauri/src/application/state.rs`
- 左栏客户端：`src/platform/tauri/sidebar-client.ts`
- 文件与 Git：`src-tauri/src/infrastructure/workspace/`
- 宠物资产：`src-tauri/src/application/pet_commands.rs`, `pet_assets.rs`
- Bing 壁纸：`src-tauri/src/application/background_commands.rs`
- 自定义背景存储：`src-tauri/src/application/app_storage_commands.rs`, `src/platform/tauri/app-storage.ts`

## 参考资料

- [Codex App Server 官方文档](https://developers.openai.com/codex/app-server)
- [Codex 0.153.4 app-server README](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/app-server/README.md)
- [Codex 官方更新日志](https://developers.openai.com/codex/changelog)
- [Tauri Rust 到前端通信](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri 前端调用 Rust](https://v2.tauri.app/develop/calling-rust/)
- [Tauri Notification 插件](https://v2.tauri.app/plugin/notification/)
- [codex-webui](https://github.com/seo-rii/codex-webui)
- [CodexHarbor](https://github.com/adondada/codexharbor)
