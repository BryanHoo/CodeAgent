# CodeAgent 工程指南

## Scope

适用于根 Workspace、`apps/node-cli`、`apps/web` 和所有 `packages/*` 的持久工程约束。

## Naming

- 产品展示名称统一使用 `CodeAgent`。
- `apps/node-cli` 发布为 `@bryanhu/code-agent`，唯一 CLI 命令使用 `code-agent`，不提供额外兼容别名；根包仅作为 private Workspace 编排器。
- 内部私有 Workspace 包统一使用 `@code-agent/*` 作用域。

## Pre-Development Checklist

- 读取 `.superwork/config.json` 和相关层的 `index.md`。
- 读取变更所属层的 `index.md` 及其链接的具体规范。
- 用 `rg` 搜索已有入口、类型与实现，确认改动所属包。
- 检查 `dependency-cruiser.config.cjs`，避免反向依赖或跨包深层导入。

## Implementation Rules

- 先在变更所属包搜索可复用实现；只有至少两个真实消费者需要同一实现时才提取公共层。
- 公共协议归属 `packages/protocol`，领域规则归属 `packages/core`；跨包公共入口统一从包根 `src/index.ts` 导出。
- `packages/client` 只保留宿主无关 facade 与契约；HTTP/WebSocket 和 Tauri IPC 分别归属 `packages/transport-http`、`packages/transport-tauri`，`apps/web/src/app/create-host-client.ts` 是唯一宿主 Composition Root。
- 跨层协议变化必须同步更新 Schema、类型、边界适配和契约测试；外部数据在进入领域层前完成运行时校验。
- TypeBox 继续作为 TypeScript/Rust 公共协议单一来源；使用 `pnpm run protocol:rust:generate` 显式更新版本化 Schema 与 Rust DTO，`pnpm run protocol:rust:check` 只读检查 drift。复杂 Provider Event 在 Rust 侧先按同一 JSON Schema 校验，再进入 Runtime Event Stream。
- Provider 差异通过 Capability 或 `extensions` 表达，原始 Provider 结构不得泄漏到 Web。
- 项目命令使用 pnpm，Python 命令使用 `python3`；内部依赖使用 `workspace:*`，共享外部版本使用 `catalog:`。
- 根 `package.json` 是唯一产品版本源；CLI、native packages、Cargo workspace 与 Tauri config 必须由 `release:version:check` 保持一致。
- Desktop 和 CLI 仅支持 macOS 14+ Apple Silicon、Windows 10+ x64 与 Ubuntu 22.04+ x64 glibc；不得声明、解析、构建或发布 `darwin-x64`、Windows/Linux arm64 或 musl 产品 artifact。
- macOS Desktop 必须显式保持 `com.apple.security.app-sandbox = false`，发布门禁必须检查最终签名 entitlement；系统 App Sandbox 与 Codex `sandboxPolicy` 相互独立，任务隔离只由 Codex 控制。
- 子进程使用参数数组和 `shell: false`；路径、等待与资源清理必须跨平台且有界。
- Rust Runtime 只依赖 Core/Protocol ports；操作、幂等、事件与订阅队列必须有界，关闭使用协作取消并等待全部受跟踪任务。
- Desktop SQLite 由单独 owner thread 和有界 `sync_channel` 持有；附件使用 raw IPC 与受管 opaque asset protocol，Renderer capability 不授予任意 fs/shell。
- Desktop 与 Web 的目录/文件选择统一使用 Web FileTree Dialog，通过严格 Protocol、Client 和宿主 Transport 按需读取目录；禁止原生系统文件选择器，Renderer 不直接获得 dialog、notification、fs 或 shell capability。系统通知只允许通过严格 Tauri host command 调用。
- Desktop 只允许打包本地 origin 导航，生产 CSP 不使用 `unsafe-eval`；single-instance 只聚焦主窗口，退出按订阅、Runtime、Codex 子进程顺序幂等关闭。Tauri Command 错误必须返回稳定 `code`、原始 `message`、`retryable` 与非空 `correlationId`，Transport 和 Web 不得替换或吞掉底层错误消息。

## Verification Checklist

- 所有改动运行快速基线 `pnpm check`，统一覆盖格式、Lint、依赖边界、类型和 Vitest；`tests/tauri-phase-*.test.ts` 由该测试入口一次性收集，不再按迁移阶段累积执行。
- CI 与 npm 发布前运行 `pnpm check:ci`，在快速基线外执行生产依赖审计、Codex Schema 与 Rust Protocol drift、版本一致性、性能、生产构建、Bundle 预算和发布包检查。
- Rust Workspace 或 Tauri Desktop 改动额外运行 `pnpm check:rust`；Desktop 壳、资源或安全边界改动还必须运行 `pnpm run build:desktop` 和 `pnpm run desktop:artifact:check`。
- Protocol 或 Codex 适配改动分别运行 `pnpm run protocol:rust:check` 或 `pnpm run codex:schema:check`；升级 Codex 时显式运行 `pnpm run codex:schema:update` 并审查基线差异。
- Workspace 版本、native package 或发布结构改动运行 `pnpm run release:version:check` 和 `pnpm run package:check`；主包不得内嵌 `.node`，必须通过精确版本 `optionalDependencies` 选择平台包。
- 根 `build` 只生成 npm 发布所需的 Web 与 Node 产物；Desktop UI 和安装包分别使用 `build:desktop-ui`、`build:desktop`，不得进入 npm tarball。
- 涉及浏览器装配或用户流程时运行 `pnpm test:e2e`。
- CI 在 Ubuntu 与 Windows 完整门禁之外，必须保留 macOS 轻量 smoke，覆盖 CLI 宿主命令、native loader 和当前平台 addon 构建。
- 发布必须先使用 `pnpm pack` 生成 tarball，将 `catalog:` 和 `workspace:` 协议转换为 npm 可安装版本；先发布所有 native packages，再通过 npm CLI 发布主包，以完成 Trusted Publisher OIDC 认证。
- macOS Release 必须通过 Developer ID Application 签名、Tauri notarization/stapling、`codesign`、`spctl` 与最低系统版本检查；Apple 证书和 App Store Connect API 私钥只能来自 GitHub Secrets，失败产物必须保留在 draft Release 且不得公开。
- Windows Desktop 当前必须以 Preview / Unsigned 发布，不配置系统代码签名命令或证书门禁；Release 标题和用户文档必须明确未签名状态，但 updater artifact 仍必须生成并验证 `.sig`。
- 发布 artifact 必须在 macOS 14 Apple Silicon、Ubuntu 22.04 x64 和 Windows 10 x64 clean runner 完成 CLI、安装与启动 smoke；上一正式版本升级和篡改 updater 签名拒绝由受保护的 `release` Environment 审批，全部通过后才能发布 npm 和公开 GitHub Release。
- 原生运行时依赖不得因包含 `binding.gyp` 且缺少显式安装钩子而触发 npm 隐式 `node-gyp rebuild`；`package:check` 必须拒绝此类依赖。
- Web 与 Node 发布构建不得生成或打包 `.map` 源码映射，`package:check` 必须拒绝含 `.map` 的发布清单。
- `.agents/**` 属于代理技能资产，不进入产品 Prettier 与 ESLint 门禁；相关改动使用技能自身校验。
- 长时间命令使用非交互模式和明确超时。

## Update Triggers

- 新增或调整跨包依赖规则。
- 协议、Provider 能力或运行时生命周期形成稳定约束。
- 验证命令、构建产物或发布清单发生变化。
