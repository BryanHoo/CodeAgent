# Tauri IPC 契约

## 命令边界

- Tauri 命令定义在 `src-tauri/src/application/commands.rs`
- 命令通过 `AppState` 编排行为，不在入口中堆叠领域逻辑
- Web 端对应调用集中在 `src/platform/tauri/`

## 数据契约

- 对外结构使用 `serde(rename_all = "camelCase")`
- 事件枚举使用 `serde(tag = "type", content = "data")`
- IPC 结构变化时同步修改 `src/domain/` 中对应的 TypeScript 类型
- Channel 事件保持单调递增序号，前端据此忽略陈旧事件
- 为序列化结果编写精确 JSON 断言，防止字段名或标签漂移
