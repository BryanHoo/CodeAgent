# CodeAgent

CodeAgent 是直接连接 `codex app-server` 的桌面工作台。左栏项目与任务、中心会话、审批、
认证、设置、文件与 Git 工作流均通过 Tauri `invoke` / `Channel` 和 Rust stdio JSONL 链路运行，
不需要本地 HTTP、WebSocket 或 Node.js 服务。

## 技术栈

- Web：React 19、Vite 8、TypeScript 6、Tailwind CSS 4、shadcn/ui、AI Elements 源码模式。
- Desktop：Tauri 2、Rust 2024。
- 质量：pnpm 11、Oxlint 类型感知规则、Vitest、Clippy、GitHub Actions。
- 预置依赖：Streamdown；只有业务使用后才进入前端 bundle。

## 环境

- Node.js 24+
- pnpm 11+
- Rust 1.97+
- 对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

开发环境默认从 `PATH` 和平台常见目录查找 `codex`，也可通过 `CODEAGENT_CODEX_BIN` 指定
绝对路径。当前适配器严格要求 `codex-cli 0.149.0`，并继承用户的 `CODEX_HOME`；未配置时由
Codex 使用官方默认目录，因此 CLI 与 CodeAgent 共享认证、配置和会话。

生产版本不将 Codex、Claude Code 等 Provider 可执行文件作为 Sidecar 打包。当前版本只复用
本机兼容运行时；正式分发前的应用私有按需安装、校验和回退方案见
[Provider Runtime Manager](docs/provider-runtime-management.md)。

## 常用命令

```bash
pnpm install
pnpm check:web
pnpm check:rust
pnpm check
pnpm tauri build --target aarch64-apple-darwin --no-sign
```

开发时可使用 `pnpm tauri dev`，本次脚手架交付不自动启动开发服务器。

## 目录边界

```text
src/
├── app/                    # 应用装配与页面外壳
├── components/             # 通用 UI 与按需复制的 AI Elements 源码
├── domain/                 # Provider 无关的稳定视图模型
├── platform/tauri/         # invoke / Channel 适配层
├── stores/                 # WebView 渲染状态投影
└── styles/                 # Tailwind 主题与全局样式

src-tauri/src/
├── application/            # Tauri 命令、状态与错误边界
└── domain/                 # Rust 到 WebView 的稳定 IPC 契约
```

模块级 Channel 在 React 挂载前只初始化一次。Web 层不直接接触 Codex JSON-RPC，Tauri 也不
授予通用 shell 或 opener 权限。完整能力和验证索引见
[Codexly 工作台能力矩阵](docs/codexly-capability-matrix.md)。

## 跨平台构建

GitHub Actions 已覆盖 Windows x64、Ubuntu x64 和 macOS Apple Silicon。当前仅生成
无签名预览包，不配置证书、公证和自动更新；具体平台基线、发布步骤与安全限制见
[releasing.md](docs/releasing.md)。
