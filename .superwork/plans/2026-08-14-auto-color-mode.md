# Feature Implementation Plan

**Goal:** 在全局设置中提供默认选中的自动颜色模式，并在系统深浅色变化时实时同步应用主题。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 适用项目级实现、性能和验证约束。
- `.superwork/spec/frontend/component-guidelines.md` — 约束设置控件、可访问性、本地化和共享组件使用方式。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束浏览器媒体查询订阅及副作用生命周期。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest 与 Playwright 行为验证。

**Architecture:** 将持久化的 `ThemePreference` 扩展为 `auto | light | dark`，同时保持根节点 `data-theme` 只接收已解析的 `light | dark`。应用启动时注册单一 `prefers-color-scheme: dark` 监听器，自动偏好下随系统变化更新；设置界面仅负责保存偏好并立即应用解析结果。

**Tech Stack:** TypeScript、React、Vitest、Playwright、i18next、Lucide React

## Global Constraints

- 保持主题状态为浏览器本地偏好，不修改服务端 `AgentGlobalSettings` 协议。
- 默认值必须是 `auto`；无效或损坏的本地数据也必须回退到 `auto`。
- 系统主题变化只通过一个应用级媒体查询监听器处理，避免组件重复订阅。
- 保持所有生产源文件不超过 500 行，并优先采用常数时间、无额外渲染的实现。
- 保留工作区中与本任务无关的已有改动，且不启动开发服务器。

### Task 1: 实现自动主题偏好与系统监听

**Files:**

- Modify: `apps/web/src/features/settings/theme-preference.ts`
- Test: `apps/web/src/features/settings/theme-preference.test.ts`

**Interfaces:**

- Consumes: `window.localStorage`、`window.matchMedia("(prefers-color-scheme: dark)")`、`document.documentElement`
- Produces: `ThemePreference = "auto" | "dark" | "light"`、按系统偏好解析并应用实际主题的启动逻辑

**Behavior:**

- 在没有有效持久化值时返回 `auto`，保存并读取三个合法偏好；应用 `auto` 时根据当前媒体查询写入实际 `data-theme`，系统颜色模式变化时仅在当前偏好为 `auto` 时同步更新。

**Stop Conditions:**

- 如果运行环境无法提供标准 `MediaQueryList` 的 `change` 事件接口，则停止并确认浏览器支持边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/settings/theme-preference.test.ts`

Expected: 主题偏好单元测试通过，并覆盖默认自动、显式偏好和系统主题变化。

### Task 2: 在设置界面添加自动颜色模式

**Files:**

- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-model.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Test: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

**Interfaces:**

- Consumes: `ThemePreference`、`applyThemePreference`、设置页 `ThemeButton`、`settings.appearance` 本地化命名空间
- Produces: 自动、浅色、深色三段式颜色模式控件和双语可访问名称

**Behavior:**

- 在现有颜色模式分段控件首位添加自动选项，默认显示选中；用户选择任一模式后立即持久化偏好并按当前系统状态应用实际主题。

**Stop Conditions:**

- 如果三项标签在设置面板现有宽度下无法保持无溢出的可访问布局，则停止并调整控件布局而不是缩小字体。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

Expected: 设置对话框测试通过，并验证自动模式的中英文文案与默认选中状态。

### Task 3: 验证浏览器内自动切换与持久化

**Files:**

- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`

**Interfaces:**

- Consumes: Playwright `page.emulateMedia`、全局设置对话框、根节点 `data-theme`、浏览器 `localStorage`
- Produces: 自动模式跟随系统切换且显式模式不再跟随系统的端到端回归证据

**Behavior:**

- 从默认自动模式启动，模拟系统浅色和深色变化并断言根主题同步；选择显式主题后再次改变系统模式，断言用户选择保持不变，并在重开设置后保持对应选中项。

**Stop Conditions:**

- 如果测试夹具不能触发 `prefers-color-scheme` 的运行时变化事件，则停止并使用同等真实浏览器事件证据替代，不以直接修改 DOM 代替。

- [x] **Task Status:** completed

Run: `pnpm test:e2e tests/e2e/app-shell-settings-navigation.spec.ts --project=chromium --grep "edits global defaults"`

Expected: 目标 Chromium E2E 用例通过，证明自动与显式颜色模式在真实浏览器中的切换边界。
