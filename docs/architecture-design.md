# 架构设计

## Project 真相源

Codex App Server `0.149.0` 是 Project 身份、顺序和有序 `roots[]` 的唯一真相源。`packages/provider-codex` 完整映射 `projectId` 与 roots；`packages/server` 只在 SQLite 中维护可重建投影：

- `projects` 保存 Project 元数据。
- `project_roots(project_id, position, root_id, path)` 保存稳定根身份、路径及顺序。
- `roots[0]` 是 primary folder，供 Task cwd、配置和 Skill 使用；全部有序 roots 通过 `thread/start|resume|fork.runtimeWorkspaceRoots` 进入 Codex 运行上下文与沙箱授权。

启动同步以 Codex 列表覆盖本地投影，因此 Codex Desktop/CLI 已有聚合项目会直接出现在 CodeAgent。

## 根级数据流

浏览器为文件、Git、历史、审核和系统打开请求显式发送 `rootPath`。Server 先按 `projectId` 读取 Project，再要求该绝对路径是 `roots[]` 的精确成员，之后才允许访问文件系统或 Git。

```text
Codex Project roots[]
        |
        v
Provider mapping -> SQLite projection -> Project HTTP snapshot
                                           |
                                           v
                                  Web selected root
                                           |
                           +---------------+---------------+
                           |               |               |
                        Files/Git       History         Open
                           |               |               |
                           +------- Server membership ------+
```

根相关 Query Key、Git Mutation 锁、分支缓存和文件树状态均包含 `projectId + rootPath`，避免聚合项目的根之间串数据。

## Web 状态

Web 只保存 `{ projectId, rootId }` 形式的当前主目录选择，并始终根据最新 Project roots 派生有效值。缺少选择、项目变化或根被 Codex 移除时回退首根。Task Runtime 始终持有 Project 的全部 roots；界面在 Composer 底部路径旁切换主目录，并同步更新路径、分支、文件树、变更、历史、预览和 Git 活动刷新等全部根级视图。文件引用携带 `rootId + rootPath + path`，序列化为宿主绝对路径，避免不同根的同名相对路径冲突。

临时 Task 不属于聚合 Project，继续使用 Server 管理的临时工作区。
