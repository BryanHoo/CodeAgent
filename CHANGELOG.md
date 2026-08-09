# 更新日志

本文件记录 CodeAgent 的重要版本变化。版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### 工程

- 升级内置 Codex 至 `0.147.0`，将任务固定迁移到原生 `Pinned` Section，并适配 MCP 未知认证状态和用户输入阻塞字段。

## [1.5.0] - 2026-08-07

### 新增

- 添加可持久化的临时 Task 入口，完整支持审批、Skill、MCP、后台终端和历史恢复，同时隔离 Project 文件与 Git 能力。
- 添加 Git 分支切换、分页提交历史和直属子仓库选择，支持在聚合目录中按仓库生成提交信息、提交并推送变更。
- 完善任务级 MCP 状态诊断与手动重载，并支持恢复历史 Task 后读取 MCP 服务。
- 支持展示 Codex 生成图片附件，并为纯 Skill Turn 写入可恢复索引、合并重复用户消息。

### 优化

- 重构提交变更抽屉、变更文件树和 Git 历史列表，将变更审核入口统一移至 Timeline。
- 折叠已完成 Turn 的中间执行过程，优化长会话浏览，并统一 CLI 中文终端输出和彩色提示。
- 优化浏览器会话监控与首屏加载，复用 Bundle 预算报告并减少非首屏模块的初始开销。
- 为 Codex RPC 过载添加有界抖动重试，保持原始总超时并避免不可重试错误被重复执行。

### 修复

- 修复移动端页面无法缩放的问题，恢复浏览器原生可访问性操作。
- 升级 Mermaid 并限制不可信图表配置，避免恶意内容改变安全级别。
- 修复侧边栏 Task 分页展开与历史 Task MCP 恢复流程中的状态错误。

### 工程

- 添加 Codex App Server Schema 漂移校验与锁定版本基线，并纳入本地和 CI 质量门禁。
- 扩展 Chromium、Firefox 和 WebKit 核心流程测试，更新 macOS 冒烟校验并加强跨平台覆盖。

## [1.4.0] - 2026-08-06

### 新增

- 添加 CodeAgent 在线更新能力，在工作台侧栏和“设置 > 关于”中展示 CodeAgent、Codex 版本及更新状态。
- 添加可取消的 Plan 模式和 Goal 模式，支持将计划构建为普通开发回合并展示自动审批审查生命周期。
- 按任务展示可读取的 MCP 服务并提供文件操作入口，补充用户输入回答和任务信息展示。
- 支持复用已打开的浏览器页面，并在 CodeAgent 服务重启后自动恢复连接。

### 优化

- 重构工作台运行环境面板、审查状态投影与界面模块，明确运行时和视图职责边界。
- 缓存并增量解析 Codex transcript Skill，异步读取历史附件，降低历史恢复的阻塞与重复工作。
- 延迟加载非首屏功能并加入 Bundle 预算门禁，控制 Web 首屏资源规模。
- 精简 Composer 命令和 Turn 操作，移除副任务、反馈与撤销旧流程。

### 修复

- 修复 Provider 历史同步前无法读取已提交附件，以及快照恢复控制器重复和项目重试覆盖不足的问题。
- 修复 Inspector 页签被运行时状态切换、空时间线项目选择器对齐及项目打开菜单图标尺寸问题。
- 修复 Git 状态刷新瞬时失败，并限制并发附件上传的条目数和总字节容量。
- 原样展示 Turn 错误信息，避免错误详情在时间线中被改写或丢失。

### 工程

- 修复生产依赖漏洞并将生产依赖审计纳入统一质量门禁。

## [1.3.0] - 2026-08-05

### 新增

- 支持通过 Web 目录树浏览运行设备并选择项目文件夹，移除对宿主系统目录选择器的依赖。
- 添加宿主文件附件选择与安全导入流程，可在 Composer 中浏览、导入并预览运行设备上的文件和图片。

### 优化

- 引入与现有设计令牌一致的项目自有基础组件，统一弹层、菜单、按钮、输入框和提示信息的交互与可访问性行为。
- 使用共享 Dropdown Menu、Context Menu 和 Tooltip 重构侧栏、项目打开及消息工具交互。

### 修复

- 移除外部组件生成配置及相关开发技能，统一通过项目内组件库维护和消费组件源码。

## [1.2.1] - 2026-08-04

### 修复

- 修复包含 URL 编码 UTF-8、未编码空白或字面百分号的本地文件引用无法正确打开预览的问题。

## [1.2.0] - 2026-08-04

### 新增

- 添加可信局域网配对访问控制，使用启动期配对码、限流和有界 Session 保护业务 HTTP 与 WebSocket 接口。
- 支持经认证预览和打开 Project 外的本机绝对文件引用，并保持内容签名、大小和路径边界校验。

### 优化

- 优化移动端工作台、Composer、Diff 审核与 Inspector 布局，完善动态视口、安全区域和触控交互。
- 调整 CLI 启动行为：本地模式自动打开浏览器，LAN 模式仅展示物理网络接口的私有 IPv4 地址且不自动打开浏览器。

### 修复

- 修复局域网配对输入框重复显示焦点轮廓的问题。
- 修复 Chromium 中末尾 Skill Token 阻断 `End` 定位，导致 Backspace 无法邻接删除的问题。

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

[Unreleased]: https://github.com/BryanHoo/CodeAgent/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/BryanHoo/CodeAgent/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/BryanHoo/CodeAgent/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/BryanHoo/CodeAgent/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/BryanHoo/CodeAgent/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/BryanHoo/CodeAgent/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/BryanHoo/CodeAgent/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.6...v1.0.0
[0.0.6]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/BryanHoo/CodeAgent/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/BryanHoo/CodeAgent/releases/tag/v0.0.1
