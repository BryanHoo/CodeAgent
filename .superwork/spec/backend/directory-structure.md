# 后端目录结构

## 包职责

- `src/cli.ts`：唯一公开 CLI 入口，只负责命令解析、配置装配和进程退出码。
- `packages/server`：Fastify 插件、HTTP/WebSocket、持久化适配和 Database Worker。
- `packages/provider-codex`：Codex Binary 定位、App Server 子进程、JSONL/RPC 和事件映射。
- `packages/core`：Provider 接口、领域状态机和用例；不得导入 Fastify、SQLite 或 Codex 实现。
- `packages/protocol`：Provider 无关的 Schema、类型和 API 版本。

## 规则

- Fastify 路由只做 Schema 校验、身份与 Project 校验、用例调用和响应映射。
- `packages/server/src/app.ts` 只装配 Fastify、共享资源、根级 Access Hook、错误处理和领域路由；HTTP/WebSocket 路由按 Access、Runtime、Project、Task、Turn、Event 领域放入 `routes/*-routes.ts` 插件。插件通过显式 `ServerRouteContext` 获取依赖，不自行关闭共享资源，也不引入字符串 Service Locator。
- `packages/provider-codex/src/agent-provider.ts` 只编排 RPC 与 Provider 生命周期；无状态的 Codex 协议转换放入纯映射模块，Task 运行状态、Pending Request 终态与定时器、Runtime Owner 分别由单一对象维护，禁止在 Provider 中复制同类 Map。
- Project Git 状态只通过固定的只读端点暴露，不接受浏览器传入的命令或文件路径；优先读取已配置 Project 根目录并同时返回当前分支和去重的本地/远端基础分支候选，远端默认分支可解析时必须排在首位。根目录不是 Git 仓库时仅聚合其直属子目录中的 Git 仓库，以子目录名作为变更路径前缀，并返回空分支上下文。
- Git 状态必须携带由分支、仓库模式和 staged/unstaged 变更计算的稳定 `snapshot`；固定 Git Mutation 只接受严格校验的 Project 相对路径、`snapshot`、message 与动作枚举，不接受命令。部分文件提交由 Server Git 服务使用 literal pathspec 和参数数组执行，保留未选 staged/unstaged 变更；push 不使用 force、不自动创建 upstream，并将 commit 成功后的 push 失败作为部分成功结果返回。聚合直属子仓库模式只允许读取，不允许跨仓库提交。
- Project 文件树只通过固定的只读端点读取已配置根目录；端点可接收经过严格校验的 Project 相对目录，每次只返回该目录的直接子项，不提供绝对路径或文件系统透传。目录解析必须沿根目录逐层应用任意层级的 `.gitignore`，不依赖根目录是否为 Git 仓库或是否存在根级规则，同时跳过符号链接、`.git` 与大型生成目录，并保留固定目录深度限制，不设置条目数量上限。
- Composer 宿主附件选择只通过固定的 `GET /v1/host-files` 浏览 CodeAgent 运行设备；端点从宿主主目录或严格校验的绝对目录开始，仅列出真实直接子目录和当前 `file | image` 种类支持的普通文件，跳过符号链接。确认选择后由 `POST /v1/projects/:projectId/attachments/:kind/host` 重新解析文件并流式写入统一 `AttachmentStore`，待提交预览只允许通过 `GET /v1/projects/:projectId/attachments/:attachmentId` 和随机附件 ID 读取，不能向 Web 或 Turn 透传宿主绝对路径，也不能建立第二套存储。
- Project 宿主打开能力只返回固定白名单中的具体应用 ID、名称与类别；普通打开菜单提交 Project 相对路径并拒绝符号链接和越界目标，AI 文件引用的显式绝对路径允许指向 Project 外的本机可读文件或目录。Server 按宿主实际可执行程序或应用包过滤目录，并使用参数数组和 `shell: false` 启动。文件交给编辑器或工具，文件管理器定位文件或打开其父目录，终端固定在文件父目录启动；`system-default` 只允许文件目标，并调用宿主系统的默认关联应用。
- Project 图片预览只允许 GIF、JPEG、PNG、WebP 的有效内容签名和有界普通文件；相对路径限制在 Project 内，显式绝对路径允许读取 Project 外目标。响应固定使用受检媒体类型与 `nosniff`，路径缺失、不可读、超限或签名不匹配统一返回不可用。
- Core、Protocol 和 Server 公开使用 Project/Task；Codex 原生 Thread 命名只允许出现在 `provider-codex` 适配边界。
- 基础设施通过 Core 端口接入，不让同步 SQLite 或子进程细节进入领域层。
- 每个包只从 `src/index.ts` 暴露公共入口。
- 不提供任意 JSON-RPC、文件系统或命令执行透传接口。
