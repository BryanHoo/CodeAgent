# 更新日志

本文件记录 CodeAgent 的重要版本变化。版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [0.0.1] - 2026-07-31

### 新增

- 添加基于 Codex App Server 的本地 Web 工作台，支持 Project、Task、Turn、流式回复、审批、Skill、终端和上下文管理。
- 添加 `start`、`doctor` 和 `version` CLI 命令，并将 Web、Server、Provider 和 SQLite Worker 打包为单一 `code-agent` npm 包。
- 添加文件预览、Diff、历史图片、系统通知、全局默认设置及任务恢复能力。

### 优化

- 合并 Project 级实时连接与高频 Delta，限制长期运行内存并优化模型目录、快照和代码高亮加载。
- 完善桌面工作台布局、任务状态反馈、编辑器草稿恢复和移动端内容展示。

### 安全

- 使用官方 Codex CLI 登录状态，不在 Web 中读取或管理认证凭证。
- 添加 Sandbox 与命令审批，并通过受控附件端点读取历史图片。

[Unreleased]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/BryanHoo/CodeAgent/releases/tag/v0.0.1
