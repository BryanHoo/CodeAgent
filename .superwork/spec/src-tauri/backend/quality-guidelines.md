# Tauri 后端质量规范

## 规则

- 保持 `unsafe_code = "forbid"`
- 错误统一转换为 `src-tauri/src/application/error.rs` 暴露的应用错误
- 对领域状态、序列化契约和错误分支添加就近单元测试
- 不在日志或 IPC 错误中暴露凭据、完整环境变量或敏感路径

## 验证

- 格式检查：`pnpm rust:fmt:check`
- 静态检查：`pnpm rust:clippy`
- 测试：`pnpm rust:test`
- 完整后端检查：`pnpm check:rust`
