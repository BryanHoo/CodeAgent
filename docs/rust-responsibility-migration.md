# Rust 职责迁移

目标：Rust 管理业务状态、执行编排和数据加工；WebView 保留输入、交互状态及增量渲染。
Codex `app-server` 继续拥有线程历史和执行事实，Rust 不建立第二份持久化会话数据库。

## 已实施：会话恢复元数据

`read_task` 原先从历史接口得到空的 `contextUsage`、`plan`、`pendingRequests`，前端仅对用量保留旧 Store 兜底。
WebView 重建后无法通过旧 Store 恢复这些信息。

现在 Rust 在事件投递前保存最近计划和用量；读取任务时补齐这些字段，并从原生审批注册表选择同项目、同任务的待处理请求。
窗口断开或不 ACK 不影响这份元数据；WebView 直接消费返回值，包括表示当前没有保留值的 `null`。

- 缓存最多 256 个任务、4 MiB 编码字节，单字段最多 256 KiB，按最近更新或读取淘汰。
- 超大字段清除旧值，避免恢复时展示过期计划；缓存被淘汰后须等待新的相关事件才能恢复该字段。
- WebView 重连保留缓存；Provider 重新启动清空；项目和任务删除释放对应缓存。
- 事件写入前的字节计数和克隆在 Runtime 锁外执行，文本 delta 不进入元数据缓存，也不增加 IPC 调用。
- 待审批请求复用原生注册表，不创建第二套审批状态机；最终解决或过期后不再出现在恢复快照中。

这些限制是缓存内容的编码预算，不代表 Rust/WebView 进程 RSS 上限。缓存不跨应用重启持久化。

## 已实施：失败终态错误归并

Rust 在原生事件投递前，使用同项目、同任务、同回合的不可重试 `provider.error`，补齐失败 `turn.completed` 缺失的错误正文。明确的终态错误优先；成功或中断终态不补入旧错误，重试错误不作为终态失败依据。
`read_task` 使用同一保留值补齐历史快照中的失败回合，不修改上游状态或已有错误。前端删除终态错误兜底，直接展示原生结果，包括 `null`。

- 每个任务只保留最近一轮失败原因，最多 128 个任务、1 MiB 字符串字节，单条连同项目/任务/回合身份最多 64 KiB；更新或读取按最近使用淘汰。
- 超限错误仍原样投递当前事件，但不保留恢复副本，并清除之前的旧错误；不截断或伪造上游错误正文。
- 新回合、任务删除、项目删除、Provider 重启释放对应记录；延迟到达的同轮启动事件不清除已收到的错误。
- delta 不进入失败缓存，不增加 IPC 或历史 RPC。容量淘汰、新回合开始及应用重启后，不保证恢复上游未持久化的旧错误。

## 已实施的消息子集：Skill 规范化

Rust `map_turn` 统一处理历史读取、启动响应及回合事件中的相邻 Skill 展开项：合并到前一条用户消息，保留原 ID、附件和相对顺序，Skill 按名称稳定去重；不跨活动项归并，也不吞掉包含正文或附件的独立消息。
`map_item` 与回合映射共用正文规范化，只移除已结构化 Skill 对应的连续开头 `$name` 引用，未知引用及正文内引用保持原样。

- Rust 在正文清理前为纯 Skill 展开项设置 `skillExpansion: true`，普通消息省略该字段；前端不再以规范化后的空正文猜测身份。
- 前端删除 `normalizeSubmittedSkillText` 和整回合重复扫描；提交路径只补齐本地乐观消息与附件。逐项实时展开的目标关联也已迁入 Rust。
- 回合项使用原位压缩、Skill 元数据移动，连续展开项合并后只进行一次去重和前缀扫描；回合规范化本身不新增缓存、历史 RPC 或 IPC 调用。
- 回归覆盖多个连续展开、重复 Skill、Unicode 空白、未知引用、独立 `$skill` 输入、附件保留、活动边界、原生历史/回合/单项事件一致性，以及前端提交占位和附件补齐。

## 已实施：跨事件 Skill 关联

Rust 在统一事件发布入口关联同项目、同任务、同回合内的相邻用户项，将纯展开事件替换为 `message.skills_updated`。事件明确携带目标 `itemId`，正文和 Skill 列表是该字段的最新完整值；不重传附件、不增加事件数。前端删除 `task-store-skill.ts`，仅原位更新目标用户项的 `text`、`skills`，保留 Store 身份、附件和顺序。

- 每个任务只保留最近用户项及已关联展开项的别名；最多 128 个任务、8 MiB 字符串字节，单记录最多 1,100,000 字节，Skill 和别名各最多 128 个，身份与 Skill 名称各最多 1024 字节。这不是进程 RSS 上限，也不是完整会话历史副本。
- 本机 Codex 源码 `codex-rs/core/src/session/mod.rs` 的用户项发布顺序为 `started` → `completed`。只从启动事件建立新关联；已知身份的完成事件更新原目标，没有已知身份的迟到完成原样保留，禁止猜测新目标。
- 活动项和 delta 关闭相邻归并窗口，已知别名仍可更新原项；无法关联或超过预算时原样投递。缓存淘汰、新用户项替换、身份不匹配后不保证继续归并旧展开项。
- `read_task` 只按精确身份叠加已保留 Skill，并移除已知展开别名。读取前后的项目序号、Channel 代次和 Provider 重启代次都未变化时，才允许从运行中快照末尾补种关联，避免迟到快照覆盖实时状态。
- 窗口重连保留投影，任务/项目删除及 Provider 重启释放；delta 不复制正文，用户输入准备在 Runtime 锁外完成，不新增历史 RPC。
- 回归覆盖无 WebView 恢复、原生 Channel 补丁、迟到生命周期事件、重复事件、跨项目/回合隔离、缓存预算、快照读取竞态和前端 Store/附件/顺序保留。

## 已实施：Diff 行数统计

`AgentFileChange` 和 Project Git 状态中的文件变更现在必须携带 `stats: { additions, removals }`。Rust 在 Codex 历史/回合项映射、`file_change.updated` 以及 Git 详情读取时统一计算；前端删除逐行扫描，`getFileChangeStats` 只读取这两个数字。

- Codex 新增/删除携带原始内容，空行与末尾换行按实际内容计数；更新及 Git 已跟踪文件按补丁统计。Git 未跟踪文件按实际生成的添加行计数，不能将补丁头计入新增文件行数。
- hunk 内以 `+++`、`---` 开头的代码行正常计入，文件头、模式变更和二进制提示不计入。
- Rust 借用正文逐行处理，不创建行数组，不新增常驻缓存或 IPC 请求；传输只增加固定数量字段。
- 统计只覆盖本次返回正文。实时/Git 既有截断预算保留，不推测省略内容；轻量 Git 查询仍不加载正文，详情只在 snapshot 匹配时展示。提交历史的文件导航不展示行数，正文仍按选中文件加载。
- 前端保留按展示分组求和、同路径保留最终项以及 staged/unstaged 合并；补丁规范化已继续迁移，预览解析属于渲染器职责。

## 已实施：Diff 补丁规范化

Rust 将 Codex 原始新增/删除内容、缺少头部或 hunk 的更新，以及 Git 未跟踪文本转换为补丁。`diff` 仅保存规范化结果，不另传原文；Git 已跟踪文件及提交历史已有完整补丁，继续原样传输。Modern 与 Legacy 删除 `normalizeFileChangePatch` 调用及实现，直接消费 `change.diff`。

- 原始内容即使包含 `+++`、`---` 或 `@@` 也按正文处理；保留空行、CRLF、尾部空格，无末尾换行时生成标准标记。更新补丁不再执行前端 `trimEnd()`，已有上下文前缀不会重复添加。
- 生成器借用逐行切片，按剩余预算写入；实时总正文仍不超过 512 KiB，Git 未跟踪文件保留单文件 512 KiB 和总量预算。补丁头和行前缀计入预算，不新增 IPC 或常驻缓存。
- 合成 hunk 截断时只保留完整行，并按保留内容重建行数；连文件头都无法容纳时返回空正文。完整上游补丁仍可能被既有预算截断，预览器继续承担不完整补丁的容错；统计不推测省略内容。
- 实时 `originalByteLength` 表示上游原文大小，生成头部使结果超限也设置 `truncated`。语法高亮、预览解析和虚拟行布局继续由渲染器处理。

## 已实施：队列相邻移动

`move_queued_submission` 替代 WebView 的全量重排命令；前端只提交 `queuedSubmissionId` 和 `offset: -1 | 1`。Rust 根据当前队列计算相邻交换，条目已出队或无相邻项返回 `{ moved: false }`，不执行写入。前端删除列表复制、索引查找和交换逻辑，三种结果（移动、无变化、失败）均刷新该任务的队列查询，错误继续向调用方传播。

- 读取最多 100 页、每页 100 项，累计 ID 正文最多 256 KiB，单个 ID/游标最多 4096 字节；拒绝重复 ID、空或重复游标、超限页面。读取与重排共用 30 秒超时，不因分页倍增等待时间。
- 原生只反序列化 ID，不再映射队列提示正文、附件和 Skill；不新增常驻队列副本。WebView 写请求由全量 ID 数组变为固定字段，但新增了按需原生分页读取，Codex 的 list 响应仍含正文，不能宣称端到端延迟或 Provider 传输量下降。
- Codex 0.154.0 的 `state/src/runtime/queued_items.rs::reorder` 在事务内校验完整 ID 集合。读取后发生增删会被拒绝，本应用不额外重试；该接口没有顺序版本或 CAS，同一集合的外部并发重排仍可能后写覆盖前写。
- 新命令只授权主窗口，旧 WebView 重排入口、客户端方法和协议 Schema 已移除。相对移动不提供虚假的幂等键参数；完整提交幂等与队列确认状态仍待迁移。

## 已实施：队列完整读取

`list_queued_submissions` 只接受任务作用域，响应改为 `{ data }`；Rust 在一次任务校验后完成分页。前端删除 `listAllQueuedSubmissions` 循环，直接消费 `AgentQueuedSubmissionSnapshot`，旧分页 Schema 和 Cursor 参数同步移除。N 页队列的 WebView 读取由 N 次 invoke 降为一次；Provider 仍需 N 次分页请求，但任务归属校验不再逐页重复。

- 最多 100 页、每页 100 项；分页共用 30 秒超时。按序列化后的 JSON 字节限制完整结果为 4 MiB，包括转义、信封、逗号和编辑状态补齐；计数不分配第二份 JSON 正文。拒绝重复 ID、空/重复游标、超过 4096 字节的游标和超大页，任何失败都丢弃部分结果。
- 编辑状态在全部页面读取完成后补齐，避免第二页的编辑项被第一页误清。只有与读取前相同且仍缺失的编辑项才清理，读取期间切换到其他条目的新编辑状态保留。
- 未新增常驻快照缓存；这里的完整结果仅表示已遍历所有页面，并非 Provider 原子快照。外部并发增删导致的分页一致性仍受官方接口约束；实际端到端延迟和真实 WebView 内存尚未测量。

## 已实施：任务创建幂等

前端原有任务创建键现在通过 `start_task` 传入 Rust。`TaskCreationRegistry` 在执行创建前登记身份，同项目同键共享一次创建及临时工作区绑定，返回同一成功摘要或原始错误；跨项目复用键直接拒绝。重放摘要不是任务当前状态，后续读取仍以 Provider 为准。

- 记录位于 `AppState`，跨 WebView 重建和 Provider 重启保留，不跨应用重启。保留窗口从注册时起计算 15 分钟；在途记录即使过期也不淘汰。过期完成项在下次请求时清理，窗口外同键可能重新创建。
- 最多保留 128 项，容量耗尽在执行副作用前拒绝。键和项目身份分别限制为 128、1024 字节；单项结果字符串正文或错误 JSON 最多 8 KiB，超大结果保留固定不确定错误，预算不代表进程 RSS 上限。
- 每次调用最多等待 120 秒，超时或调用方取消只结束等待，创建与工作区收尾继续；后续同键可取得最终结果。工作异常退出保留不确定记录，不接管重跑。
- 失败在保留窗口内也会重放，不能通过同键自动重试创建；新尝试需要新键，并先核对任务列表以避免重复。完整失败重试交互、创建后启动首轮的恢复编排及 Turn 幂等尚未迁移。

## 后续迁移边界

| 顺序 | 待迁移职责 | 验收重点 |
|---|---|---|
| 1 | 完整消息投影、终态归并、快照与实时事件对账 | 原生消息身份稳定；读取快照期间发生的 delta 不丢失、不重复；历史分页不回滚 |
| 2 | 提交、创建后启动/steer/排队编排及幂等 | 原生创建去重已完成；继续实现部分成功恢复、失败重试交互和执行幂等 |
| 3 | 异步问题回答关联、队列确认状态 | 按协议身份关联，多个窗口不独立推断业务结果 |
| 4 | Diff 摘要/正文按需读取与剩余调度规则 | 统计与补丁规范化已迁移；继续减少未打开详情的正文传输 |
| 5 | 图片软件加工和结果缓存 | 真实 WebView 主线程负担下降，IPC 字节量与总内存不恶化 |

当前已迁移恢复元数据、失败终态错误规则、Skill 规范化及有界跨事件关联、Diff 行数统计与补丁规范化、队列相邻移动及完整读取、任务创建幂等，没有迁移完整 `task-store-events.ts`、通用消息身份对账、前端事件历史和恢复重试器；不能视为主工作台已成为纯渲染层。
快照元数据和 checkpoint 在同一 Rust 临界区读取，但这不代表上游多个历史 RPC 与实时正文事件已经形成原子快照。

## 验证

2026-09-13 第九批任务创建幂等迁移的 `pnpm check` 通过：333 项前端测试、476 项 Rust 单元测试、6 项集成测试和 3 项既有性能基线通过，另有 7 项测试默认忽略；Modern/Legacy 构建、类型检查、格式检查、Clippy 和体积预算通过。新增 8 项原生回归覆盖重放、并发及取消等待、失败、身份校验、容量与过期、超大结果和工作异常退出；前端协议、客户端与提交定向测试共 11 项通过。真实 Codex 0.154.0 私有安装与 app-server 生命周期测试通过，但该生命周期测试不经过新增注册表；未实测 120 秒等待超时、应用重启恢复或真实 WebView 端到端创建幂等。

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib snapshot --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib failure_projection --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib conversation_ --locked
pnpm exec vitest run src/features/conversation/runtime/task-store-context-usage.test.ts
pnpm exec vitest run src/features/conversation/runtime/task-store-terminal-error.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib skill --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib file_change_stats_should --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib file_patch_should --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib native_queue_move_should --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib queue_snapshot_should --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib task_creation_should --locked
pnpm exec vitest run src/protocol/task-creation.test.ts src/platform/tauri/sidebar-client.test.ts src/features/workbench/composer-state-submission.test.ts
pnpm exec vitest run src/features/conversation/runtime/task-store-skill-update.test.ts src/features/conversation/runtime/task-runtime-submission.test.ts
pnpm exec vitest run src/features/diff/file-change.test.ts src/features/workbench/components/workbench-inspector-git-status.test.ts
pnpm exec vitest run src/platform/tauri/queue-command-contract.test.ts src/platform/tauri/sidebar-client.test.ts
pnpm exec vitest run --config vitest.browser.config.ts src/features/workbench/hooks/use-composer-queue.browser.test.tsx
pnpm check
```

原生回归覆盖没有 WebView 时恢复元数据、项目/任务隔离、审批解决、任务删除、窗口重连、Provider 重启、任务数量/字节预算与超大字段。
前端回归验证原生用量覆盖旧值，以及原生 `null` 清除过期用量。
失败终态回归覆盖事件补齐、明确终态错误优先、成功/重试清理、延迟启动、新轮隔离、无 WebView 的快照恢复、身份隔离和数量/字节预算；前端验证不再从旧 Store 推断终态错误。
2026-09-12 第六批迁移的前端及供应链检查通过：330 项前端测试、Modern/Legacy 构建、类型检查和体积预算通过。合成补丁截断及反斜杠正文回归修正后，Rust 再次完整验证：454 项单元测试、6 项集成测试通过，7 项默认忽略；格式检查与 Clippy 通过。
额外验证 Chromium/WebKit 下补丁直传、Legacy 实际解析渲染、操作分组及关键操作共 12 项浏览器测试，以及真实 Codex 0.154.0 私有安装与 app-server 生命周期测试。Modern 渲染器使用替身核对接收到的完整正文，另以真实 `@pierre/diffs` 解析器核对新增、删除和无 hunk 片段的 3 份规范化样例；这些结果不等于真实 WebView 性能实测。
既有 3 项 Rust 性能基线通过，但未测量本次 Diff 迁移的性能收益。真实原生 WebView 的完整销毁重建交互和性能对比需要另行实测，不能以单元测试代替。

2026-09-13 第七批队列移动迁移的 `pnpm check` 通过：331 项前端测试、Modern/Legacy 构建、类型检查、体积预算及命令授权检查通过；461 项 Rust 单元测试、6 项集成测试、3 项既有性能基线、格式检查与 Clippy 通过，另有 7 项测试默认忽略。定向回归覆盖 7 项原生队列移动测试，以及 Chromium/WebKit 共 8 项队列交互测试。真实 Codex 0.154.0 私有安装和 app-server 生命周期测试通过，但未执行真实队列并发交互或测量本次移动延迟。

2026-09-13 第八批队列读取迁移的 `pnpm check` 通过：332 项前端测试、468 项 Rust 单元测试、6 项集成测试和 3 项既有性能基线通过，另有 7 项测试默认忽略；Modern/Legacy 构建、类型检查、格式检查、Clippy 和体积预算通过。新增 7 项 Rust 队列读取与编辑状态回归，协议及客户端定向测试共 11 项通过，Chromium/WebKit 队列交互共 8 项通过。真实 Codex 0.154.0 生命周期测试通过；完整读取的并发一致性与真实 WebView 性能仍未实测。
