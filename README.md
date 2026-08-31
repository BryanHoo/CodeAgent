<p align="center">
  <img src="./public/brand/codeagent-mark.svg" alt="CodeAgent" width="88" />
</p>

<h1 align="center">CodeAgent</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-24-339933" alt="Node.js" />
  <img src="https://img.shields.io/badge/React-19-149eca" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff" alt="Vite" />
  <img src="https://img.shields.io/badge/Tauri-2-24c8db" alt="Tauri" />
  <img src="https://img.shields.io/badge/OpenAI_Codex-0.151-412991" alt="OpenAI Codex" />
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-0f766e" alt="MIT" />
  </a>
</p>

<p align="center">
  直接连接 Codex 的本地优先桌面 AI 编程工作台。
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

CodeAgent 通过 Tauri 直接连接 `codex app-server`，在一个桌面工作台中组织项目、任务、对话、审批、文件和 Git 工作流。应用使用 Rust stdio JSONL 链路通信，不依赖本地 HTTP、WebSocket 或 Node.js 服务，并与 Codex CLI 共享认证、配置和会话。

## 主要功能

- 运行项目任务或临时任务，实时查看回复、命令、计划、审批和文件变更
- 使用持久化任务队列安排后续工作，并在执行前编辑、排序或取消排队消息
- 添加文件与图片、使用 `@` 引用项目文件、调用 Skills，并处理 MCP 服务的输入请求
- 为每个任务选择模型、思考量、快速模式、审批方式和文件系统访问范围
- 管理多根项目、临时任务和归档任务，并从现有对话分叉新任务
- 浏览、预览、重命名和删除项目文件，审查 Diff 与提交历史
- 创建或切换 Git 分支和 worktree，选择文件后提交或推送变更
- 支持简体中文与 English、系统通知、托盘控制和工作台宠物

## 环境要求

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- 对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

当前版本严格支持 `codex-cli 0.151.0`。CodeAgent 会查找本机兼容运行时；未找到时，可在启动页选择全局安装或下载到应用私有目录。使用前需通过官方 Codex CLI 完成认证：

```bash
codex login
```

如需指定已有的 Codex 可执行文件，请将 `CODEAGENT_CODEX_BIN` 设置为其绝对路径。CodeAgent 继承 `CODEX_HOME`；未配置时使用 Codex 的默认目录。

## 快速开始

克隆仓库并安装依赖：

```bash
git clone https://github.com/BryanHoo/CodeAgent.git
cd CodeAgent
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` 会启动 Vite 和 Tauri 桌面应用。首次启动时，运行时检查会引导你安装或选择兼容的 Codex。

## 使用方式

处理仓库时，先添加一个或多个本机目录作为项目根，再创建任务并提交需求。无需项目上下文时，可直接创建临时任务。消息可以附加文件或图片、引用项目文件和 Skills；任务运行期间可继续发送引导，或将后续消息加入队列。

任务控件用于设置模型、思考量、快速模式、审批方式和沙盒范围。工作台同时提供项目文件、代码变更、Git 历史、分支、worktree、审查、提交和推送操作。

## 常用命令

```bash
pnpm check:web    # 检查 Web 端
pnpm check:rust   # 检查 Rust 端
pnpm check        # 执行完整质量检查
pnpm tauri build  # 构建当前平台安装包
```

## 项目结构

```text
src/
├── app/                    # 应用装配、路由与页面外壳
├── components/             # 通用 UI 组件
├── domain/                 # Provider 无关的稳定视图模型
├── features/               # 会话、项目、设置和工作台功能
├── platform/tauri/         # invoke / Channel 适配层
├── stores/                 # WebView 渲染状态投影
└── styles/                 # Tailwind 主题与全局样式

src-tauri/src/
├── application/            # Tauri 命令、状态与错误边界
├── domain/                 # Rust 到 WebView 的稳定 IPC 契约
└── infrastructure/         # Codex、Git、文件系统等实现
```

Web 层不直接接触 Codex JSON-RPC，Tauri 也不向 WebView 授予通用 Shell 权限。进一步了解实现和约束：

- [工作台能力矩阵](docs/codexly-capability-matrix.md)
- [Provider Runtime Manager](docs/provider-runtime-management.md)
- [性能基线](docs/performance-baseline.md)
- [跨平台发布](docs/releasing.md)

## 平台支持

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| Windows 10/11 | x86_64 | NSIS |
| Ubuntu 24.04+ | x86_64 | DEB、AppImage |
| macOS 14+ | Apple Silicon | app、DMG |

当前版本生成无签名预览包。安装限制与平台注意事项见 [跨平台发布](docs/releasing.md)。

## 获取帮助

- [问题反馈](https://github.com/BryanHoo/CodeAgent/issues)
- [版本发布](https://github.com/BryanHoo/CodeAgent/releases)

## 许可证

[MIT](LICENSE)
