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

## 后续迁移边界

| 顺序 | 待迁移职责 | 验收重点 |
|---|---|---|
| 1 | 完整消息投影、终态归并、快照与实时事件对账 | 原生消息身份稳定；读取快照期间发生的 delta 不丢失、不重复；历史分页不回滚 |
| 2 | 提交、建任务、启动/steer/排队编排及幂等 | 部分成功可恢复；重复请求不重复建任务或执行 |
| 3 | 异步问题回答关联、队列确认状态 | 按协议身份关联，多个窗口不独立推断业务结果 |
| 4 | Diff 统计/规范化与调度规则 | 摘要和正文分离；RRULE、时区和有效性统一由 Rust 判定 |
| 5 | 图片软件加工和结果缓存 | 真实 WebView 主线程负担下降，IPC 字节量与总内存不恶化 |

当前已迁移恢复元数据、失败终态错误规则、Skill 规范化及有界跨事件关联，没有迁移完整 `task-store-events.ts`、通用消息身份对账、前端事件历史和恢复重试器；不能视为主工作台已成为纯渲染层。
快照元数据和 checkpoint 在同一 Rust 临界区读取，但这不代表上游多个历史 RPC 与实时正文事件已经形成原子快照。

## 验证

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib snapshot --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib failure_projection --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib conversation_ --locked
pnpm exec vitest run src/features/conversation/runtime/task-store-context-usage.test.ts
pnpm exec vitest run src/features/conversation/runtime/task-store-terminal-error.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --lib skill --locked
pnpm exec vitest run src/features/conversation/runtime/task-store-skill-update.test.ts src/features/conversation/runtime/task-runtime-submission.test.ts
pnpm check
```

原生回归覆盖没有 WebView 时恢复元数据、项目/任务隔离、审批解决、任务删除、窗口重连、Provider 重启、任务数量/字节预算与超大字段。
前端回归验证原生用量覆盖旧值，以及原生 `null` 清除过期用量。
失败终态回归覆盖事件补齐、明确终态错误优先、成功/重试清理、延迟启动、新轮隔离、无 WebView 的快照恢复、身份隔离和数量/字节预算；前端验证不再从旧 Store 推断终态错误。
2026-09-12 四批迁移后的验证：`pnpm check` 全部通过。共 335 项前端测试、439 项 Rust 库测试（7 项按设计忽略）、6 项协议/PTY 集成测试及 3 项显式性能基线；供应链检查、格式、Clippy、类型检查、Modern/Legacy 构建和体积预算通过。前端删除旧归并测试，改为验证原生补丁契约。
真实原生 WebView 的完整销毁重建交互和性能对比需要另行实测，不能以单元测试代替。
