# 前端状态管理

## Purpose

区分瞬时 UI、HTTP Snapshot 和实时 Agent Event 状态。

## Rules

- 瞬时 UI 状态默认保留在最近组件或功能内。
- HTTP Snapshot 由服务端状态层持有；实时事件按实体 ID 归一化合并。
- `sequence` 是 Runtime Session 内的事件顺序依据；断线恢复先刷新 Snapshot，再从检查点补发。
- Approval、Error 和 Terminal State 不得因合并或反压丢失。
- 在真正引入状态库前，不预先创建抽象 Store 或空 Slice。
