# Codexly Workbench Migration Plan

**Goal:** 在 CodeAgent 中完整运行 Codexly Web 工作台，并且不依赖现有 HTTP 或 WebSocket 后端。
**Scope:** 完整替换根包 `src/` Web 实现；迁入 Codexly 前端生产代码与协议类型；仅保留本地 mock 连接边界。
**Acceptance:** `pnpm check:web` 通过，桌面浏览器中可使用项目、任务、会话、检查器、Git、设置及相关弹窗交互。

### Task 1: 建立无后端前端数据边界

**Files:**

- Add: `src/mock/`
- Test: `src/mock/mock-fetch.test.ts`

**Behavior:**

- 提供确定性的认证、项目、任务和工作台数据，禁止请求真实后端。

**Proof:** `pnpm vitest run src/mock/mock-fetch.test.ts`

**Stop Conditions:**

- Mock 响应无法满足 Codexly Client 的协议校验。

- [ ] **Task Status:** pending

### Task 2: 完整替换 Web 工作台

**Files:**

- Replace: `src/`
- Add: `packages/client/`
- Add: `packages/protocol/`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `vite.config.ts`

**Behavior:**

- 迁入 Codexly Web 的全部生产页面、组件、状态、样式、国际化及桌面交互，并删除旧工作台实现。

**Proof:** `pnpm typecheck && pnpm build`

**Stop Conditions:**

- 源工作台存在无法从前端隔离的服务端执行依赖。

- [ ] **Task Status:** pending

### Task 3: 完成本地交互闭环

**Files:**

- Modify: `src/mock/`
- Modify: `src/features/projects/project-queries.ts`
- Modify: `src/app/providers.tsx`

**Behavior:**

- 项目与任务增删改、会话提交、设置、文件树、Git 与检查器在 mock 数据上产生可见结果。

**Proof:** `pnpm test:run && pnpm build`

**Stop Conditions:**

- 新增交互需要真实文件系统或 Agent 执行结果且无法合理 mock。

- [ ] **Task Status:** pending

### Task 4: 验证完整桌面工作台

**Files:**

- Modify: `src/` only when verification exposes a migration defect

**Behavior:**

- 桌面视口中工作台无空白、遮挡或运行时错误，主要导航与弹窗均可操作。

**Proof:** `pnpm check:web` 加桌面浏览器截图与交互检查

**Stop Conditions:**

- 构建或浏览器错误来自仓库外不可用依赖。

- [ ] **Task Status:** pending
