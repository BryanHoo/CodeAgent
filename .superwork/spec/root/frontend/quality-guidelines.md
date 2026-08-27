# Web 前端质量规范

## 测试

- Reducer、事件排序和状态转换使用 `src/**/*.test.ts` 下的 Vitest 单元测试
- 用户可见交互变更检查键盘操作、可访问名称及禁用状态
- IPC 变更同时验证 Rust 序列化契约

## 验证

- 运行 `pnpm check:web`
- 跨层变更额外运行 `pnpm check:rust`
- 合并前的完整验证运行 `pnpm check`
