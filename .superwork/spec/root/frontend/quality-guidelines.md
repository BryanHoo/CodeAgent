# Web 前端质量规范

## 测试

- Query、事件排序、状态转换与 mock 传输使用 `src/**/*.test.ts` 下的 Vitest 单元测试
- 用户可见交互变更检查键盘操作、可访问名称及禁用状态
- 工作台布局至少验证 `1280×720` 与宽屏桌面视口，无页面级横向溢出
- 对话虚拟化必须在 Chromium 与 WebKit 双引擎验证至少 207 个动态高度 Turn、约 11,505 个 Timeline Item，覆盖有界 DOM、冷跳无空白、prepend 锚点、流式增长置底和用户向上阅读
- 协议变更同时验证 `src/protocol/` Schema 与 `src/client/` 消费端

## 验证

- 运行 `pnpm check:web`
- 仅前端变更运行 `pnpm check:web`；涉及 Rust/Tauri 时额外运行 `pnpm check:rust`
- 跨前后端变更或合并前完整验证运行 `pnpm check`
