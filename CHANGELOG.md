# 更新日志

本文件记录 CodeAgent 的重要版本变化。版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [0.0.6] - 2026-07-31

### 新增

- 添加中栏标题任务重命名入口，并同步更新任务列表、固定任务和搜索缓存。
- 添加项目重命名与删除操作，保持展示名和磁盘目录隔离，并清理关联运行时状态。

## [0.0.5] - 2026-07-31

### 修复

- 修复 Windows Explorer 成功转交后误报失败，并强制 Windows Terminal 在项目目录打开独立窗口。
- 统一 Composer、Timeline 和 Inspector 中的 Skill 展示使用主题主色。

## [0.0.4] - 2026-07-31

### 修复

- 修复 Windows 通过 npm 全局安装时 `better-sqlite3` 触发 `node-gyp rebuild` 的问题。
- 添加原生发布依赖安装钩子校验，阻止需要本机构建工具的依赖进入发布包。

## [0.0.3] - 2026-07-31

### 修复

- 修复公开 npm 包名为 `@bryanhu/code-agent`，并同步安装文档与发布校验。

## [0.0.2] - 2026-07-31

### 修复

- 修复 npm 发布包保留 `catalog:` 依赖协议而导致安装失败的问题。

## [0.0.1] - 2026-07-31

### 新增

- 添加基于 Codex App Server 的本地 Web 工作台，支持 Project、Task、Turn、流式回复、审批、Skill、终端和上下文管理。
- 添加 `start`、`doctor` 和 `version` CLI 命令，并将 Web、Server、Provider 和 SQLite Worker 打包为单一公开 npm 包。
- 添加文件预览、Diff、历史图片、系统通知、全局默认设置及任务恢复能力。

### 优化

- 合并 Project 级实时连接与高频 Delta，限制长期运行内存并优化模型目录、快照和代码高亮加载。
- 完善桌面工作台布局、任务状态反馈、编辑器草稿恢复和移动端内容展示。

### 安全

- 使用官方 Codex CLI 登录状态，不在 Web 中读取或管理认证凭证。
- 添加 Sandbox 与命令审批，并通过受控附件端点读取历史图片。

[Unreleased]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.6...HEAD
[0.0.6]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/BryanHoo/CodeAgent/releases/tag/v0.0.1
