# 脚手架开发约束

## 已建立的边界

```text
React feature
    ↓ selector
Runtime Store
    ↓ normalized AppEvent
module-level Tauri Channel
    ↓
application command/state
    ↓
provider runtime（待实现）
```

- `src/domain/agent-item.ts` 是 UI 的稳定视图模型，不能导入 Codex 或 AI SDK 协议类型。
- `src/platform/tauri` 只负责 IPC，不能维护业务实体。
- `src/stores` 只保存可重建的渲染投影，输入框等瞬时状态留在组件本地。
- `src-tauri/src/application` 负责命令注册、Channel 生命周期和错误序列化。
- provider 运行时、JSONL 请求路由和进程管理应放入后续新增的 Rust infrastructure 模块。

## 新增功能顺序

1. 先在 Rust domain 定义归一化事件，并为序列化结构补测试。
2. 在 application 注册职责单一的 Tauri command；禁止增加通用 shell command。
3. 在 Web domain 定义对应视图类型，通过纯 reducer 更新 Store。
4. feature 只通过 selector 和平台适配器访问状态，不直接调用原始协议。
5. 使用功能后再复制对应 AI Elements 组件，并裁剪不需要的依赖和分支。

## AI Elements

AI Elements 以源码组件方式使用。添加组件时使用项目的包执行器：

```bash
pnpm dlx ai-elements@latest add message
```

生成代码需要适配 Vite、`AgentItemView` 和 Tauri transport。禁止引入 Next.js runtime、
`useChat` 或本地 HTTP 服务。

## 质量门禁

```bash
pnpm lint            # Oxlint + type-aware rules
pnpm typecheck       # TypeScript project references
pnpm test:run        # Vitest
pnpm build           # Vite production build
pnpm check:rust      # rustfmt + clippy + cargo test
```

CI 必须使用 `pnpm install --frozen-lockfile` 和 Cargo `--locked`。单个业务代码文件不得超过
500 行；达到边界前按职责拆分。

## 调研依据

官方资料：

- [Tauri Create a Project](https://v2.tauri.app/start/create-project/)
- [Tauri Vite configuration](https://v2.tauri.app/start/frontend/vite/)
- [Tauri Calling the Frontend](https://v2.tauri.app/develop/calling-frontend/)
- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [shadcn/ui for Vite](https://ui.shadcn.com/docs/installation/vite)
- [AI Elements Setup](https://elements.ai-sdk.dev/docs/setup)
- [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html)

社区项目只用于验证工程实践，不作为协议规范：

- [seo-rii/codex-webui](https://github.com/seo-rii/codex-webui)
- [lezi-fun/codex-webui](https://github.com/lezi-fun/codex-webui)
- [kitlib/tauri-app-template](https://github.com/kitlib/tauri-app-template)
