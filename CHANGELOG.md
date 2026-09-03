# Changelog

本项目的所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.5] - 2026-09-03

### Added

- 添加 Codex 协议契约校验，固定 `0.152.1` 协议快照并覆盖实验 API 差异。
- 添加文件变更操作分组与摘要，提升长任务时间线的浏览效率。

### Changed

- 重构 Provider 配置与模型目录持久化，统一自定义模型的读取和保存行为。
- 更新任务最近活动排序与窗口恢复行为，并保留任务切换时的检查器状态。

### Fixed

- 修复 Codex 通知背压阻塞响应、超大消息帧和图片存储占用问题。
- 修复自定义模型分页转换和 Codex RPC 错误详情丢失问题。
- 修复对话虚拟列表动态内容置底、滚动校正与定位问题。
- 修复运行时更新进度未知总量显示，以及 Windows Codex shim 调用失败问题。

## [0.1.4] - 2026-09-03

### Added

- 升级内置 Codex `0.152.1` 运行时与协议契约，补充线程计划配置、认证恢复通知和 MCP 表单降级支持。
- 添加任务看板的新完成任务标识，并在任务完成后同步已完成列表缓存。

### Changed

- 调整 Linux Wayland 会话的桌面宠物初始化，优先使用 X11 后端并在不可用时回退 Wayland。

### Fixed

- 修复入站文本附件的 `textElements` 字段解析，确保粘贴文本附件可正确恢复。
- 修复完成态时间线的后续用户引导、流式 Assistant 文本和空 reasoning 导致的操作分组异常。
- 修复浏览器质量门禁对虚拟列表 prepend 锚点的脆弱断言，避免虚拟节点卸载造成误报。
- 修复真实 Codex 运行时检查缺少进度 Channel 导致三平台发布门禁失败的问题。

## [0.1.3] - 2026-09-03

### Added

- 添加 Codex 运行时自动升级流程，在兼容版本变化时直接下载并切换到新版本。
- 添加运行时升级失败后的自动回退，并在界面展示升级与恢复进度。

## [0.1.2] - 2026-09-03

### Added

- 添加 Codex 运行时自动升级流程，在兼容版本变化时直接下载并切换到新版本。
- 添加运行时升级失败后的自动回退，并在界面展示升级与恢复进度。

## [0.1.1] - 2026-09-02

### Changed

- 将设置持久化迁移到本地原子存储，统一项目与全局设置的保存链路。
- 将 GitHub Release 工作流改为在质量门禁通过后直接正式发布。

### Fixed

- 修复设置自动保存、审批审核器参数及工作台背景草稿的同步问题。
- 修复对话虚拟列表滚动锚定冲突和瞬时活动项生命周期状态映射。

## [0.1.0] - 2026-08-31

### Added

- 添加基于 Tauri 与 React 的 CodeAgent 桌面工作台，支持项目、任务和多轮对话管理。
- 添加 Codex 本地运行时检测、校验、安装与断线恢复流程。
- 添加 Windows x64、Ubuntu x64 与 macOS Apple Silicon 的无签名预览构建。
- 添加设置、主题、通知、工作台背景、Git 工作流和桌面宠物能力。

### Security

- 添加最小化 Tauri 权限、依赖供应链审计与 Provider 运行时完整性校验。

[Unreleased]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BryanHoo/CodeAgent/releases/tag/v0.1.0
