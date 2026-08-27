# Web 前端质量规范

## 测试

- Query、事件排序、状态转换与 mock 传输使用 `src/**/*.test.ts` 下的 Vitest 单元测试
- 用户可见交互变更检查键盘操作、可访问名称及禁用状态
- 工作台布局至少验证 `1280×720` 与宽屏桌面视口，无页面级横向溢出
- 协议变更同时验证 `packages/protocol/` Schema 与 `packages/client/` 消费端

## 验证

- 运行 `pnpm check:web`
- 仅前端变更运行 `pnpm check:web`；涉及 Rust/Tauri 时额外运行 `pnpm check:rust`
- 跨前后端变更或合并前完整验证运行 `pnpm check`
