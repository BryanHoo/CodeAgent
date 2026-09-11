<p align="center">
  <img src="./public/brand/codeagent-mark.svg" alt="CodeAgent" width="88" />
</p>

<h1 align="center">CodeAgent</h1>

<p align="center">
  本地优先的桌面 AI 编程工作台。
</p>

<p align="center">
  <a href="#主要功能">主要功能</a>
  ·
  <a href="#快速开始">快速开始</a>
  ·
  <a href="./docs/installation.md">安装与卸载</a>
  ·
  <a href="./README.en.md">English</a>
  ·
  <a href="./LICENSE">许可证</a>
</p>

CodeAgent 将 AI 编程任务、对话、审批、项目文件和 Git 操作集中在一个桌面工作台中，适合持续处理真实项目，而不必在多个工具之间切换。

## 主要功能

- 运行项目任务或临时任务，实时查看回复、命令、计划、审批和文件变更
- 在独立透明小窗中持续查看任务输出，不占用主工作台空间
- 使用持久化任务队列安排后续工作，并在执行前编辑、排序或取消消息
- 添加文件与图片、使用 `@` 引用项目文件，并打开临时任务文件或复制文件绝对路径
- 在扩展中心安装和管理 Skills、官方插件与第三方市场，并管理 MCP 服务和运行时热重载
- 在固定问答区处理异步问题，通过跨客户端任务锁避免并发交互冲突，并在续聊时恢复线程模型与思考量
- 使用项目级原生集成终端运行命令，并在多个持久会话之间切换
- 使用全局快捷键快速创建任务、切换区域和执行常用工作台操作
- 使用可视化重复规则创建定时任务，按工作日、周末、星期或月份配置计划，并预览后续执行时间
- 自动安装并校验应用私有 Codex 运行时，无需配置全局 Codex
- 为每个任务选择模型、思考量、快速模式、审批方式和文件访问范围
- 管理多个项目根目录、临时任务和归档任务，并从现有对话分叉新任务
- 使用可折叠搜索快速筛选当前项目中的任务
- 浏览和管理项目文件，审查 Diff、未提交变更与提交历史，并复制保留原始格式的 Markdown 消息
- 创建或切换 Git 分支和 worktree，选择文件后提交或推送变更
- 支持简体中文与 English、系统通知、托盘控制和工作台宠物

## 快速开始

1. 从 [Releases](https://github.com/BryanHoo/CodeAgent/releases) 下载发布包，按[安装指南](./docs/installation.md)安装。
2. 启动 CodeAgent，等待应用自动安装并校验私有 Codex 运行时。
3. 添加项目或创建临时任务，开始使用。

支持 Windows、Ubuntu 和 macOS；架构、最低系统版本及 Modern / Legacy 选择见安装指南。

## 使用方式

处理仓库时，先添加一个或多个本机目录作为项目根，再创建任务并提交需求。无需项目上下文时，可直接创建临时任务。消息可以附加文件或图片，也可以引用项目文件和 Skills。

任务运行期间，可以立即发送补充要求，也可以将后续消息加入队列。任务控件用于设置模型、思考量、快速模式、审批方式和文件访问范围。

工作台提供项目文件、代码变更、Git 历史、分支、worktree、审查、提交和推送操作。归档任务可恢复，也可在确认后永久删除。

## 文档

- [安装、更新与卸载](./docs/installation.md)
- [源码开发与构建](./docs/development.md)
- [macOS 分档构建](./docs/macos-build-profiles.md)
- [发布指南](./docs/releasing.md)
- [更新日志](./CHANGELOG.md)

## 获取帮助

- [问题反馈](https://github.com/BryanHoo/CodeAgent/issues)
- [版本发布](https://github.com/BryanHoo/CodeAgent/releases)

## 许可证

[MIT](LICENSE)
