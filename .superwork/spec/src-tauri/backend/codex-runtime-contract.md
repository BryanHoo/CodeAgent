# Codex 0.154.0 运行时契约

## 版本与分发

- 仅运行应用私有目录中的 Codex `0.154.0`；首次启动缺失、损坏或版本不符时自动安装，不扫描或回退全局安装
- `active.json` 仅提供上次安装版本，不控制启动路径；正常检测不联网、不写清单，安装结果直接复用
- 日常版本探测限时 3 秒；刚解包的二进制安装校验单独限时 10 秒，保留原始探测错误。两条路径均维持输出上限与超时终止，不因首次系统验证增加日常启动等待。
- 下载失败停留在运行时页面并提供重试；后台进程就绪时恢复窗口跳过检测
- 运行时仅接受精确版本 `0.154.0`；拒绝其他 patch、预发行版和构建元数据版本
- 私有下载仅使用 npm 官方的 Darwin arm64/x64、Linux arm64/x64、Windows arm64/x64 六个平台包，并对完整内容校验官方 SHA-512 integrity
- 项目启用了 `experimentalApi`，未经源码和契约验证不得扩大兼容版本范围
- CI 使用 `codex-cli 0.154.0` 生成带 `--experimental` 的 JSON Schema bundle，并与已提交快照执行字节级差异检查

## 线程协议

- `retain_task_subscription` 接收 `projectId` 与 `taskId`，以 `thread/resume(excludeTurns:true)` 确认写入权并恢复服务端通知订阅，不发送 Turn。仅在 154 明确返回当前线程没有 rollout 时，用轻量 `thread/read(includeTurns:false)` 确认该新线程仍由本进程载入后复用，不能将任意恢复失败视为可写。跨客户端 writer 冲突保留 `CODEX_THREAD_BUSY`，不转换为网络断开；释放必须等待挂载检查结束，迟到结果不得覆盖新挂载的状态，不增加轮询。

- 每个 `thread/start`、`thread/resume`、`thread/fork` 请求必须在 `config` 中传入 `tools.update_plan.enabled: true`
- 只使用请求级覆盖，不得改写用户全局 `config.toml`
- `thread/resume` 不传 `cwd`，由 Codex 从已保存线程恢复工作目录；恢复响应新增字段必须保持可解析
- Project 任务列表必须使用 `thread/list` 的 `recency_at` 倒序；Codex 在 `TurnStarted` 时单调推进该字段，确保用户再次发送消息后任务回到左栏首位
- `project/list` 接受项目的 `recencyAt` 字段，但不得请求 `recencyAt` 排序，产品顺序继续由 `position` 决定

## 无项目任务存储

- 常规设置中的无项目任务根目录属于 CodeAgent 本地偏好，通过原生目录选择器验证可写后原子保存，不写入 Codex `config.toml`；更改根目录仅影响新任务。
- 取消选择或规范化后仍为原目录时返回 `null`，不探测写权限、不写配置、不更新缓存或提示成功；此设置自行控制成功提示，禁用全局 Mutation 成功通知。
- 新建和分叉的无项目任务必须使用各自任务 ID 子目录；`thread/start` 返回 ID 后，在首个 Turn 前使用 `thread/settings/update.cwd` 绑定最终目录。恢复仍不传 `cwd`，以 Codex 保存的线程设置为准。
- 输入附件和任务专属设置保存到任务目录；草稿暂存文件可能被重试或排队编辑引用，不能移动或提前删除。Codex 会话日志、全局索引和应用缓存仍由各自原生存储管理，不能宣称所有内部数据均迁入工作目录。
- 用应用私有目录中的任务路径索引校验访问和清理，不根据当前根设置推断旧任务位置；拒绝路径穿越、同名目录接管与符号链接替换。分叉拥有独立工作文件，删除不得清理父任务目录。
- 新任务和重新打开的任务只动态授权各自附件目录的 asset protocol 访问，不授权整个自选根目录；否则重启后自选位置的图片附件无法预览。
- 验证根目录切换、取消与保存失败、任务 ID 绑定、附件重试去重、分叉隔离和安全清理；运行 Chromium/WebKit 设置交互测试及 `pnpm check`。

## 智能体默认设置

- 智能体默认值通过不带 `cwd` 的 `config/read` 读取，通过 `config/batchWrite` 写入用户全局 `config.toml`，由 Codex 解析 `CODEX_HOME`；写入启用 `reloadUserConfig`，只提交变化的标准键
- 模型、推理强度、审批策略、审核方、沙箱、网页搜索和输出详细程度分别映射标准配置键；快速模式读取 `fast` / `priority`，启用写入 `priority`，关闭写入 `default`；空详细程度使用 `null` 删除覆盖
- `agent-settings.json` 只持久化应用专属偏好及按项目隔离的覆盖值，不再读取旧智能体全局字段；项目未保存覆盖值时继承最新 Codex 全局默认值，显式保存后不随全局值改变
- 普通任务和计划任务的运行参数共用 Codex 全局配置读取；项目覆盖读取不触发全局写入，Codex 写入失败不得继续保存应用偏好
- 验证配置键映射、变更批写、失败传播、空值删除、快速模式及项目覆盖隔离；运行 `pnpm check:rust`

## Provider 配置

- Codex `config.toml` 只写入标准 Provider 字段：内置 OpenAI 覆盖使用 `openai_base_url`，自定义 Provider 使用 `model_provider` 与 `model_providers.<id>`
- CodeAgent 自有的模型目录不得写入 `desktop.codeagent.provider`；应原子保存到应用数据目录，并按 `providerId` 与 `baseUrl` 精确匹配，防止跨端点复用模型
- 重新连接未提交模型列表时复用当前端点的本地目录；旧 `desktop.codeagent.provider.customModels` 仅允许作为一次性迁移来源，成功保存后清理整个旧配置段

## 新增通知与请求

- MCP `toolsError` 表示未获得工具目录；存在字符串错误时，仅将 `connected` / `unknown` 摘要映射为 `failed`，不得覆盖认证、启动或禁用态。IPC 仍只传名称、显示名、状态和工具数量，不传错误正文或工具定义。
- MCP `openai/userVerification` 使用 `description` 显示不支持提示，不读取旧 `message` 字段、不传 `challenge`；只允许 `cancel` / `decline` 且响应 `content: null`，后端必须拒绝 `accept`。本地 154 的 `userVerification/*` 尚无原生实现，不声明具备设备验证能力。
- 线程新增 `originator`、`environments`、`daybreakEnabled` 不进入桌面投影；`thread/list` 不发送仅托管端支持的非空 `originators`。保持恢复/分叉 `excludeTurns: true` 及 `thread/read(includeTurns: false)`。
- 沿用 Codex 154 的无订阅空闲线程默认 60 秒卸载；活跃或被订阅线程不得主动卸载，不增加轮询或修改用户 `thread_unload_delay_secs`。
- 原始 `configuration_update` 属于 `ResponseItem`，不作为 UI `ThreadItem`；继续在握手中关闭 `rawResponseItem/completed`，避免新增无效事件传输。
- 仅 `delivery: async` 的 `agentMessage.questions` 映射为结构化问题；实时与历史共用映射，问题树不进入 Delta 热路径。每个 Item 最多 16 题、每题最多 32 项，标题/选项分别不超过 4096/1024 字节，总文本不超过 64 KiB；超预算时保留官方 `text` 展示，不渲染巨大表单
- 异步问题只沿用普通用户消息回复，不调用阻塞请求响应协议；`item/completed` 不得结束 Turn 或进入审批队列
- `Thread.model` 与 `Thread.reasoningEffort` 通过现有 `thread/read` 投影到快照 `threadConfiguration`，接受空值；新任务的乐观快照不伪造该字段。它们用于 Composer 恢复续聊模型与推理强度，不是逐回合遥测；任务设置提供空值回退，用户手动选择具有更高优先级，不为恢复额外 resume、轮询或自动写回配置
- `update_task_settings` 可携带点击时捕获的 `turnId`。仅审核方变化时发送 `turn/settings/update`，补丁只含 `threadId`、`turnId`、`approvalsReviewer`，不启用 `step_model_switching`，不改变沙箱、已捕获步骤或已有审批
- 运行中审核方更新被拒绝时不保存任务设置；`targetUnavailable` 时仅保存未来设置并明确告知。UI 必须区分 `applied` 与 `targetUnavailable`，不得把已结束的目标自动改为新回合；项目默认值必须在任务更新成功后保存
- `plugin/reconcile` 和 App 按账户审批配置暂不新增产品入口；项目未提供插件管理，不在事件热路径主动同步插件
- `ResponseUsageMetadata.metadata` 不进入 WebView；上下文占用继续使用 `thread/tokenUsage/updated` 的有界摘要
- `modelProvider/authRecoveryStarted` 和 `modelProvider/authRecoveryCompleted` 必须校验 `threadId`、`turnId`、`provider`、`message` 后显式消费；当前不投影到 UI
- MCP elicitation 的 `openaiForm` 与旧 `openai/form` 均映射为 `unsupported`，不得按标准 `form` 渲染或提交
- 不启用 `omit_app_server_notification_media`，生成图片链路仍依赖通知中的媒体数据落盘

## 验证要求

- 覆盖精确版本门禁、六个平台 URL 与 SHA-512、安装命令和前端恢复提示
- 覆盖所有线程创建路径、恢复与 Fork 的计划工具配置，并断言恢复请求不携带 `cwd`
- 覆盖 Project 任务 `recency_at` 排序、项目 `recencyAt` 兼容、认证恢复通知结构和 `openaiForm` 降级
- 覆盖 Provider 重连、端点隔离、旧模型目录迁移及 `desktop.codeagent.provider` 清理
- 使用本机 `codex-cli 0.154.0` 运行真实 App Server 生命周期冒烟，并运行 `pnpm check`
- 运行 `pnpm codex:protocol:check` 验证实验协议 schema 未发生漂移
- 覆盖异步问题在历史与实时 Item 中的结构一致性、预算降级和同步消息隔离；覆盖空值/非空线程配置快照，断言读取请求数量不增加
- 覆盖运行中审核方更新的精确目标、最小补丁、`applied`/`targetUnavailable` 和托管策略拒绝；覆盖问答预选不自动发送、自由回答、失败重试、断线禁用和虚拟卸载恢复
