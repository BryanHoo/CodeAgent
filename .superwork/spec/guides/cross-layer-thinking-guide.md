# 跨层变更检查指南

## Goal

确保 Web、Client、Protocol、Core、Provider 与 Server 之间的契约变化完整且单向。

## Checklist

- 从 `apps/web` 沿 `client -> protocol -> server -> core -> provider-codex` 跟踪输入与事件输出。
- 在边界入口校验不可信数据，Provider 原始结构不得直接泄漏到 Web。
- 协议变化同步更新 Schema、类型、两端适配和契约测试。
- Provider 差异通过 Capability 与 `extensions` 表达，不根据 Provider 名称在 Web 中分支。
- 运行 `pnpm run lint:architecture` 验证依赖方向。
