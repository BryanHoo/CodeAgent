# Web 前端类型安全

## 规则

- 保持 TypeScript `strict` 检查通过，不使用 `any` 绕过边界
- IPC 类型集中定义在 `src/domain/`，组件不得重复声明对应结构
- Rust `serde(rename_all = "camelCase")` 与 TypeScript 字段保持一致
- 可辨识联合的 `type` 标签与 Rust `serde(tag = "type", content = "data")` 保持一致
- 捕获外部错误时使用 `unknown`，在边界内完成收窄或转换
