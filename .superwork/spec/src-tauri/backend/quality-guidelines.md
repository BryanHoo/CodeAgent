# Tauri 后端质量规范

## 规则

- 保持 `unsafe_code = "forbid"`
- 错误统一转换为 `src-tauri/src/application/error.rs` 暴露的应用错误
- 对领域状态、序列化契约和错误分支添加就近单元测试
- 不在日志或 IPC 错误中暴露凭据、完整环境变量或敏感路径
- 覆盖日志脱敏、字段与单行上限、Codex stderr 有界排水、归档白名单和导出总量限制
- Git 仓库选择层统一规范化根仓库和子仓库路径，不能依赖上层调用者已处理 Windows 普通路径与 `\\?\` 路径差异。用中文父目录、中文项目及文件名覆盖真实 Git 状态和差异读取；保留仓库边界校验。状态错误应区分读取阶段与输出超限，不把输出超限归类为无效路径。

## 验证

- 格式检查：`pnpm rust:fmt:check`
- 静态检查：`pnpm rust:clippy`
- 测试：`pnpm rust:test`
- 完整后端检查：`pnpm check:rust`

- 手写源文件和测试文件不得超过 500 行；`pnpm source:lines` 覆盖已跟踪及新增文件，通过 `pnpm check:web` 和总入口 `pnpm check` 执行。
- `pnpm performance:rust` 必须使用 `--release`；Debug 功能测试结果不能作为发布性能基线。记录内存时区分索引预算、进程 RSS 采样和峰值。
