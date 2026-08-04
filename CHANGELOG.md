# 更新日志

本文件记录 CodeAgent 的重要版本变化。版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

## [1.1.0] - 2026-08-04

### 新增

- 升级内置 Codex 至 `0.146.0`，接入原生任务固定状态，并保持固定、重命名和归档操作与 Codex 数据一致。
- 添加 Markdown 文件引用的分类预览与安全打开、消息图片页内预览和会话文本附件展示。
- 添加系统默认应用打开方式，统一 Inspector、文件审核和消息引用中的项目文件打开流程。
- 将文件审核导航改为紧凑文件树，并为截断的命令标题添加完整内容提示。

### 优化

- 重构任务 Snapshot 与实时事件的消息匹配、修订推进和终态合并，保持恢复后的会话内容与运行状态一致。
- 保持提交操作计时直至助手回复可见，准确反馈提交信息生成和 Git 操作的完整耗时。

### 修复

- 修复 Safari 输入法候选确认误提交、Skill Token 邻接删除及光标定位问题。
- 修复流式回复代码复制、新聊天项目选择器尺寸与直接提交后的文件审核滚动。
- 修复系统通知打开错误页面，以及摘要 Snapshot 丢失未重复携带的 Turn Item。

### 工程

- 隔离各 Playwright Worker 的 Fake Server，并等待 Shimmer 动画时间轴初始化，降低端到端测试相互干扰。

## [1.0.0] - 2026-08-02

CodeAgent 首个稳定版本，集中发布本地 Coding Agent 工作台的完整交互、运行时治理与跨平台能力。

### 新增

- 添加项目文件树、Git 变更检查、选中文件提交、推送及外部应用打开能力。
- 添加图片、文件和大段粘贴文本附件输入，以及项目级 MCP 服务检查器。
- 添加 Web 界面国际化、全局设置、跟进消息排队、Markdown 源文件预览和回复耗时展示。
- 添加由临时 Codex 任务生成提交信息的流程，支持基于选中变更提供受限 Diff 上下文。

### 优化

- 虚拟化长会话 Turn，拆分任务运行时与 Item Store，并批量读取 Git 工作树以降低长任务资源占用。
- 为事件流、任务状态、模型目录、Git 读取和附件上传添加字节、并发、缓存及生命周期预算。
- 统一 Project Runtime 释放、Snapshot 恢复与实时事件校准，减少导航、重连和关闭阶段的状态残留。

### 修复

- 修复 WebSocket 初始化及交错 Delta 的事件顺序问题，保持实时消息与终态一致。
- 修复异步重复点击、文件切换审核滚动、项目文件夹展开及 Linux 目录选择取消等交互问题。
- 修复任务恢复失败后的重试与活动请求重建，避免失败原因或待处理状态被错误覆盖。

### 安全

- 限制 Codex JSONL 帧、Git 工作树、事件历史和附件内容的资源规模，并隐藏协议错误中的原始内容。
- 强化附件流式上传、路径边界和符号链接校验，避免非受控文件内容越过 Server 边界。

### 工程

- 添加性能验收门禁、Web 静态检查和 macOS smoke，并启用编译前 TypeScript 架构依赖分析。
- 锁定生产构建的浏览器支持边界，明确 Chrome/Chromium、Firefox 和 Safari 的最低版本。

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

[Unreleased]: https://github.com/BryanHoo/CodeAgent/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/BryanHoo/CodeAgent/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.6...v1.0.0
[0.0.6]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/BryanHoo/CodeAgent/releases/tag/v0.0.1
