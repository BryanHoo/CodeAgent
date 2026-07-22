# 共享契约质量规范

## Purpose

确保统一协议和领域边界可验证、可版本化且不泄漏 Provider 实现。

## Rules

- Project、Task 等 Protocol 类型必须有对应 JSON Schema 或明确生成来源，运行时边界不得只依赖 TypeScript 类型。
- Agent Event 保持版本字段、单调 `sequence` 和可判别事件类型。
- Provider 专有数据只进入诊断字段或 `extensions`，未知事件记录告警但不破坏事件循环。
- 变更按新协议逻辑实现并删除冗余旧路径；破坏性变更明确升级 API 或事件版本。
- 更新所有消费者、契约测试和架构文档后运行 `pnpm check`。
