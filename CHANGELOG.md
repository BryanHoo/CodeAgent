# Changelog

本项目的所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

[Unreleased]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/BryanHoo/CodeAgent/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/BryanHoo/CodeAgent/releases/tag/v0.1.0
