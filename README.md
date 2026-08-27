# CodeAgent

CodeAgent 桌面端脚手架。当前仅提供可编译、可测试的工程基础，不包含会话、审批、认证、
`codex app-server` 进程管理或其他业务实现。

## 技术栈

- Web：React 19、Vite 8、TypeScript 6、Tailwind CSS 4、shadcn/ui、AI Elements 源码模式。
- Desktop：Tauri 2、Rust 2024。
- 质量：pnpm 11、Oxlint 类型感知规则、Vitest、Clippy、GitHub Actions。
- 预置依赖：Streamdown、`react-virtuoso`；只有业务使用后才进入前端 bundle。

## 环境

- Node.js 24+
- pnpm 11+
- Rust 1.97+
- 对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## 常用命令

```bash
pnpm install
pnpm check:web
pnpm check:rust
pnpm check
pnpm tauri build --no-sign
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
授予通用 shell 或 opener 权限。后续实现约束见 [scaffold-guide.md](docs/scaffold-guide.md)。

## 跨平台构建

GitHub Actions 已覆盖 Windows x64、Ubuntu x64、macOS Apple Silicon 和 Intel。当前仅生成
无签名预览包，不配置证书、公证和自动更新；具体平台基线、发布步骤与安全限制见
[releasing.md](docs/releasing.md)。
