# 跨平台与脚本指南

## Goal

确保 Node.js 24、pnpm 和 CI 中的工程脚本行为一致。

## Checklist

- Python 命令只使用 `python3`。
- 项目命令使用 pnpm，内部依赖使用 `workspace:*`，共享外部版本使用 `catalog:`。
- Node 子进程使用参数数组与 `shell: false`，不要拼接用户输入。
- 路径使用仓库相对路径或经过校验的绝对路径，不依赖当前 Shell 特性。
- 测试、迁移、构建和子进程等待必须设置合理超时。
