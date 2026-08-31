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
  <a href="./README.en.md">English</a>
  ·
  <a href="./LICENSE">许可证</a>
</p>

CodeAgent 将 AI 编程任务、对话、审批、项目文件和 Git 操作集中在一个桌面工作台中，适合持续处理真实项目，而不必在多个工具之间切换。

## 主要功能

- 运行项目任务或临时任务，实时查看回复、命令、计划、审批和文件变更
- 使用持久化任务队列安排后续工作，并在执行前编辑、排序或取消消息
- 添加文件与图片、使用 `@` 引用项目文件、调用 Skills，并处理 MCP 输入请求
- 为每个任务选择模型、思考量、快速模式、审批方式和文件访问范围
- 管理多个项目根目录、临时任务和归档任务，并从现有对话分叉新任务
- 浏览和管理项目文件，审查 Diff、未提交变更与提交历史
- 创建或切换 Git 分支和 worktree，选择文件后提交或推送变更
- 支持简体中文与 English、系统通知、托盘控制和工作台宠物

## 快速开始

1. 从 [Releases](https://github.com/BryanHoo/CodeAgent/releases) 下载适合当前平台的发布包。
2. Windows 直接运行免安装 EXE；其他平台安装后启动 CodeAgent。
3. 首次启动时按照界面提示完成配置，然后添加项目并创建任务。

当前提供无签名预览包，系统可能显示来源或安全提示。支持平台如下：

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| Windows 10/11 | x86_64 | EXE（免安装） |
| Ubuntu 24.04+ | x86_64 | DEB、AppImage |
| macOS 14+ | Apple Silicon | app、DMG |

## 使用方式

处理仓库时，先添加一个或多个本机目录作为项目根，再创建任务并提交需求。无需项目上下文时，可直接创建临时任务。消息可以附加文件或图片，也可以引用项目文件和 Skills。

任务运行期间，可以立即发送补充要求，也可以将后续消息加入队列。任务控件用于设置模型、思考量、快速模式、审批方式和文件访问范围。

工作台提供项目文件、代码变更、Git 历史、分支、worktree、审查、提交和推送操作。归档任务可恢复，也可在确认后永久删除。

## 从源码运行

环境要求：

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- 对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/BryanHoo/CodeAgent.git
cd CodeAgent
pnpm install
pnpm tauri dev
```

常用检查与构建命令：

```bash
pnpm check:web
pnpm check:rust
pnpm check
pnpm tauri build
```

## 获取帮助

- [问题反馈](https://github.com/BryanHoo/CodeAgent/issues)
- [版本发布](https://github.com/BryanHoo/CodeAgent/releases)

## 许可证

[MIT](LICENSE)
