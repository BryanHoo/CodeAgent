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
- Project Git 状态只通过固定的只读端点暴露，不接受浏览器传入的命令或文件路径；优先读取已配置 Project 根目录并同时返回当前分支、当前分支优先的去重本地分支切换候选和本地/远端基础分支候选，远端默认分支可解析时必须排在基础分支首位。根目录不是 Git 仓库时仅聚合其直属子目录中的 Git 仓库，以子目录名作为变更路径前缀，并返回空分支上下文。
- Project Git 历史只通过固定的只读分页端点读取已配置根目录；根仓库不接受仓库参数，非根仓库只允许选择最新枚举出的直属 Git 子目录。历史命令固定以所选仓库当前 `HEAD` 为起点，不使用 `--all` 或接受其他分支名称；每次响应必须从同一仓库目录读取并返回该仓库可空的当前分支。响应返回有界子仓库 Tab 列表，每页固定最多 20 条提交和下一页游标，不跨子仓库混合记录，也不暴露宿主绝对路径。历史命令必须复用受控 `simple-git` Adapter，并使用固定参数数组与 NUL 字段分隔解析。
- Git 提交审核只接受历史响应中的 40 至 64 位十六进制 SHA、最新枚举的仓库和严格 Project 相对路径。提交文件每页最多返回 `100` 条；单文件 Diff 按选择读取，响应最多保留前 `512 KiB` UTF-8 内容并返回截断状态。文件清单与 Diff 命令必须使用固定参数数组、`--no-ext-diff`、`--no-textconv` 和 `--no-renames`，不得接受任意 revision、pathspec 或 Git 参数。
- Git 状态必须携带由分支、仓库模式和 staged/unstaged 变更计算的稳定 `snapshot`；固定 Git Mutation 只接受严格校验的结构化字段，不接受命令。Git 读取与分支命令统一通过受控 `simple-git` Adapter 执行，必须保留参数数组边界、硬超时、合并输出上限、危险 Git 环境变量过滤和 `GIT_OPTIONAL_LOCKS=0`；精确部分提交继续使用支持 stdin 与 literal pathspec 的专用执行器，但必须复用同一受控环境构造，只能额外设置提交所需的非交互变量。环境过滤回归测试必须覆盖 `GIT_CONFIG_COUNT`、`GIT_EXEC_PATH`、`GIT_EXTERNAL_DIFF`、`GIT_SSH_COMMAND` 和 `GIT_ASKPASS`。部分文件提交必须保留未选 staged/unstaged 变更；push 不使用 force、不自动创建 upstream，并将 commit 成功后的 push 失败作为部分成功结果返回。分支切换只允许根仓库模式、匹配当前 `snapshot` 且存在于最新本地分支候选中的精确名称，通过参数数组执行 `git switch --no-guess`；分支创建同样只允许根仓库模式和匹配当前 `snapshot`，必须先用 `git check-ref-format --branch` 校验不存在的精确名称，再通过参数数组执行 `git switch -c`。两种 Mutation 都返回重新读取的完整 Git 状态，不得接受远端引用、命令或自动猜测分支。提交、分支切换和分支创建共享 Project 级 Git Mutation 锁；聚合直属子仓库提交必须先选择最新枚举出的真实直属 Git 目录，并以所选仓库自己的相对路径和 `snapshot` 生成 message、提交与推送，不得跨仓库混合变更。
- Project 文件树只通过固定的只读端点读取已配置根目录；端点可接收经过严格校验的 Project 相对目录，每次只返回该目录的直接子项，不提供绝对路径或文件系统透传。目录解析必须沿根目录逐层应用任意层级的 `.gitignore`，不依赖根目录是否为 Git 仓库或是否存在根级规则，同时跳过符号链接、`.git` 与大型生成目录，并保留固定目录深度限制，不设置条目数量上限。
- Project 文件搜索必须复用文件树的 Project 根目录、分层 `.gitignore`、生成目录、符号链接和深度边界，只按文件名匹配并稳定返回最多 `50` 个 Project 相对普通文件。Turn 提交必须重新解析并授权每个引用，拒绝重复、越界、目录、符号链接和已忽略文件，再映射为 Provider 文件 `mention`；不得信任搜索结果或接收宿主绝对路径。
- Composer 宿主附件选择只通过固定的 `GET /v1/host-files` 浏览 CodeAgent 运行设备；端点从宿主主目录或严格校验的绝对目录开始，仅列出真实直接子目录和当前 `file | image` 种类支持的普通文件，跳过符号链接。确认选择后由 `POST /v1/projects/:projectId/attachments/:kind/host` 重新解析文件并流式写入统一 `AttachmentStore`，待提交预览只允许通过 `GET /v1/projects/:projectId/attachments/:attachmentId` 和随机附件 ID 读取，不能向 Web 或 Turn 透传宿主绝对路径，也不能建立第二套存储。
- Project 宿主打开能力只返回固定白名单中的具体应用 ID、名称与类别；普通打开菜单提交 Project 相对路径并拒绝符号链接和越界目标，AI 文件引用的显式绝对路径允许指向 Project 外的本机可读文件或目录。Server 按宿主实际可执行程序或应用包过滤目录，并使用参数数组和 `shell: false` 启动。文件交给编辑器或工具，文件管理器定位文件或打开其父目录，终端固定在文件父目录启动；`system-default` 只允许文件目标，并调用宿主系统的默认关联应用。
- Project 图片预览只允许 GIF、JPEG、PNG、WebP 的有效内容签名和有界普通文件；相对路径限制在 Project 内，显式绝对路径允许读取 Project 外目标。响应固定使用受检媒体类型与 `nosniff`，路径缺失、不可读、超限或签名不匹配统一返回不可用。
- Core、Protocol 和 Server 公开使用 Project/Task；Codex 原生 Thread 命名只允许出现在 `provider-codex` 适配边界。
- 基础设施通过 Core 端口接入，不让同步 SQLite 或子进程细节进入领域层。
- 每个包只从 `src/index.ts` 暴露公共入口。
- 不提供任意 JSON-RPC、文件系统或命令执行透传接口。
