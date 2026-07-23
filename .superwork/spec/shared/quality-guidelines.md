# 共享契约质量规范

## Purpose

确保统一协议和领域边界可验证、可版本化且不泄漏 Provider 实现。

## Rules

- Project、Task 等 Protocol 类型必须有对应 JSON Schema 或明确生成来源，运行时边界不得只依赖 TypeScript 类型。
- `Project.rootPath` 由本地 Runtime 校验后随 Project 契约返回，用于当前工作台展示，并由 `ProjectSchema` 校验为非空字符串。
- Agent Event 保持版本字段、单调 `sequence` 和可判别事件类型。
- Provider 只发布不含 `sessionId`、`sequence`、`timestamp` 和 `version` 的统一事件；Server Event Stream 统一分配这些传输字段。
- Project 级 Provider 只发布已通过 Project 归属验证的 Task 事件，未知或其他目录的 `threadId` 不得进入 Event Stream。
- Task Snapshot HTTP 响应必须同时返回同一 Event Stream 的 `{ sessionId, sequence }` checkpoint，Client 不得猜测恢复序号。
- WebSocket 控制帧使用 `connection.ready` 和 `resync.required`；恢复原因只使用 Protocol 定义的判别值。
- Provider 专有数据只进入诊断字段或 `extensions`，未知事件记录告警但不破坏事件循环。
- Task Snapshot 必须保留归一化的 Turn 与 Tool 错误；Command Output 最多保留最新 `10,000` 行或 `1 MiB`，并携带截断状态。
- 变更按新协议逻辑实现并删除冗余旧路径；破坏性变更明确升级 API 或事件版本。
- 更新所有消费者、契约测试和架构文档后运行 `pnpm check`。
