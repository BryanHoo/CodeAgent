# 项目结构

多根 Project 相关职责分布如下：

```text
packages/protocol/src/
  project-root.ts              根路径、根实体和查询 Schema
  project.ts                   Project.roots 与多根创建契约

packages/provider-codex/src/
  codex-project-repository.ts  Codex project/* 映射与同步
  runtime-provider.ts          使用 primary root 创建 Task Runtime

packages/server/src/
  project-root-scope.ts        根成员授权与 primary 解析
  sqlite-state-migrations.ts   project_roots 投影迁移
  routes/project-*-routes.ts   文件、Git、打开的根级路由

apps/web/src/features/projects/
  project-root-selection.ts    默认、失效回退、排序和 primary 选择
  project-query-options.ts     根隔离 Query/Mutation

apps/web/src/features/workbench/components/
  project-root-selector.tsx    Composer 底部多根主目录选择器
  workbench-shell-runtime.tsx  当前根派生和根级 UI 状态
```

依赖方向保持 `protocol -> core/client -> provider/server -> web`。Provider 原生 Codex 类型不得越过适配边界；Server 不生成 Project 身份，Web 不复制或修改 `roots[]` Server State。Core 的 `AgentTaskScope` 同时携带 primary `rootPath` 与完整 `runtimeWorkspaceRoots`，Provider 在 `thread/start|resume|fork` 中分别映射 cwd 和运行时工作区根。
