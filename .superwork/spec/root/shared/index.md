# 共享协议规格

## 附件契约

- `AgentMessageAttachment` 是提交、队列编辑和历史恢复共用的完整附件身份，必须保留 `id`、`kind`、`name`、`mediaType`、`size`，图片固定保留 `detail: auto`
- Codex 原生媒体必须分别映射为 `localImage` 与 `localAudio`；普通文件通过 `codexly-file:` `text_elements.placeholder` 携带固定大小元数据，关联的 `text` 仅保存本地缓存路径，不得作为可见正文渲染
- 浏览器附件必须通过 raw IPC 上传，宿主文件必须单遍流式缓存；不得把二进制转换为 JSON `number[]` 或 Base64
- 附件超过类型上限时必须跨 Workspace、Tauri IPC 和 WebView 保留 `ATTACHMENT_TOO_LARGE`，前端展示本地化限制说明，不得降级为通用文件系统错误
- 生成图片正文只允许写入本地附件存储；跨 Rust、Tauri Channel 和 WebView 仅传固定大小附件元数据，不得传输 Base64 `result`

## 桌面宠物契约

- `DesktopPetState` 只同步宠物标识、活动动画、本地访问标志和最多 256 条任务气泡摘要；macOS 由原生窗口维护拖动，并以 AppKit 物理主键状态确认释放，前端维护动画生命周期，Linux Wayland 会话优先使用 XWayland 后端，Linux 与 Windows 按帧合并物理坐标
- 任务动画和气泡摘要必须由 Rust `TaskActivityState` 投影；主 WebView 只能配置宠物标识，不得回传任务活动状态
- 宠物移动、状态更新和任务跳转使用固定 `desktop-pet://*` 事件，独立窗口不得连接 Provider Runtime

## 状态栏任务契约

- Rust 独占最多 256 条任务活动摘要，统一归约运行、等待、完成、失败、元数据与任务移除事件，并更新状态栏数量、动态菜单和桌面宠物
- `TaskActivitySnapshot` 必须由 Rust 同时投影 `status`、`requiresApproval` 与当前 Turn 的可选 `startedAt`；`waiting` 仅表示等待用户处理，只有 `command_approval`、`terminal_input_approval`、`file_change_approval`、`permissions_approval` 和 `mcp_elicitation` 可以进入待审批看板，WebView 不得把普通 `user_input` 推断为审批
- 主 WebView 不得写入原生任务活动状态；重建时只能通过 `get_task_activities` 读取 Rust 完整快照，恢复全部侧栏标记与 Project 事件归属
- Rust 必须按持久化通知与语言偏好发送 Task 终态、失败及待处理请求系统通知，不得依赖主 WebView 是否存在、可见或处于前台
- 状态栏图标左键必须显示任务菜单，不得直接恢复主窗口；应用恢复只能由菜单命令或任务项触发
- 状态栏任务点击必须恢复主窗口并跳转对应任务；普通 Project 使用 `/p/:projectId/t/:taskId`，`temporary` 作用域使用 `/temporary/t/:taskId`
- 主窗口关闭后从状态栏菜单、任务项或通知恢复时必须清除原生全屏状态，并以带窗口控件的普通窗口显示；主窗口未关闭时，这些入口只能聚焦或导航，不得改变用户当前全屏状态

## 性能观测契约

- Rust 映射实时 Delta 时写入 Unix 毫秒字段 `receivedAtUnixMs`；合并 Delta 保留该合并组首个事件的接收时间，前端只对实际进入可见 Task Store 的事件计算 React commit 延迟
- `get_runtime_performance_metrics` 按项目返回 Provider 接收数、IPC 发布数、最近 1 秒 events/s、合并率与有界事件队列高水位
- App-server 背压缓冲只允许淘汰可由快照恢复的 Delta；`turn/*`、`item/*` 生命周期、服务端请求与终态通知不得丢弃。发生淘汰时必须按 Project 发送 `resync.required`，原因固定为 `event_retention_exceeded`

## MCP Elicitation 契约

- form 模式仅在 `accept` 时携带结构化 `content`；URL 模式的 `accept` 只发送 `action`，`decline` 与 `cancel` 均不发送 `content`

## 应用更新契约

- `get_app_info` 只从 `BryanHoo/CodeAgent` 的 GitHub Releases 检查新版本，并限制请求超时、重定向和响应体大小
- 仅 `0.1.0` 初始版本可在仓库没有公开 release 时视为最新；后续版本缺失或无法解析 release 时返回 `check-failed`
- 关于页始终提供内置当前版本日志；发现新版本时改为显示远程 release 正文，并提供项目仓库与远程 `CHANGELOG.md` 链接
- `install_app_update` 必须通过 Tauri updater 从固定的 GitHub `latest.json` 下载并校验签名；WebView 只提交已展示的目标版本，不得控制下载地址、公钥或安装参数
- 安装前必须重新检查并精确匹配目标版本；下载进度使用单调 `sequence` 和累计字节，通过专用 Channel 有界投影，安装完成后由原生层重启应用
- 正式 release 必须生成 updater artifact、`.sig` 与 `latest.json`，使用仓库 Secret 中的长期签名私钥；Windows 必须同时发布无 Authenticode 签名的 portable EXE 与可更新的 NSIS 安装包，portable 不得作为更新目标
- 每个发布版本必须在 `CHANGELOG.md` 中包含 `## [版本] - YYYY-MM-DD` 条目，GitHub release 正文必须由该条目生成

## Skills 市场契约

- 已安装 Skill 必须以 Codex `skills/list` 为发现来源，一次传入全部左栏 Project roots，按绝对路径去重并保留 `path`、`scope`、`enabled` 与 Project 归属；启停必须使用 `skills/config/write` 的绝对路径选择器，文件管理器打开前必须再次匹配已发现路径
- 已安装 Skill 必须依次按“系统”“全局”和左栏 Project 顺序分组展示，各分组默认展开；Project Skill 必须显示在所属 Project 分组中，不得合并为通用“项目”分组
- ClawHub 包必须以 `ownerHandle/slug` 作为完整身份；列表与搜索只能读取目录中的名称、简介与统计信息，不得下载 `SKILL.md`；详情与安装阶段必须排除声明 OpenClaw 专属 `config`、`envVars`、`primaryEnv`、`install`、`nix`、`skillKey`、`requires.env`、`requires.bins`、`requires.anyBins` 或 `requires.config` 的 Skill
- 安装前必须重新读取详情与安全扫描，仅允许 `clean` 包；托管 ZIP 与 `public-github` handoff 均限制响应大小、文件数和解压体积，拒绝路径穿越与符号链接，GitHub handoff 还必须限制 HTTPS host、提取指定子目录并验证 `contentHash`
- 全局 Skill 安装到 `~/.agents/skills/<slug>`，项目 Skill 必须从左栏 Project 中显式选择，并安装到其已校验 root 下 `.agents/skills/<slug>`；安装使用同目录 staging 与原子替换，并写入 `.clawhub/origin.json`，更新前必须验证发布者身份和已安装内容指纹，存在本地修改时不得覆盖
- 安装请求期间仅实际触发的目标按钮显示 loading，其他安装入口保持禁用；安装成功后关闭详情弹窗，安装失败时保留弹窗以便重试

## 定时任务契约

- 定时任务只在桌面应用进程存活时运行，每次触发必须创建独立 Codex Task；项目作用域同时支持已配置 Project 与 `temporary`
- 调度配置支持未来单次时间与 RFC 5545 `RRULE`；IPC 中单次时间固定使用 `atUnixMs`，重复起点固定使用 `startAtUnixMs`；重复规则必须自动绑定当前电脑的 IANA 时区且不显示时区配置，拒绝小于 60 秒的重复间隔，并按本地墙钟时间正确跨越夏令时
- 调度器必须使用单调休眠与变更通知，不得轮询；离线错过多个时点只补跑一次，同一任务不得并发启动，冲突触发记录为 `skipped` 并推进到未来时点
- 任务、提示词、附件身份、Skill 引用和完整 Turn 设置必须原子持久化；运行记录最多保留 20 条，异常退出遗留的 `running` 记录必须在重启时修复为 `failed`
- 定时任务 Composer 必须复用普通任务的附件上传、Skill、项目文件引用、权限、模型、推理强度与快速模式逻辑；保存配置不得启动即时 Turn
- 定时任务的搜索与创建动作固定在内容区任务列表顶部，创建使用带可访问名称的紧凑主色 `Plus` 图标按钮，任务总数紧随列表标题；启停开关固定在任务列表项；Composer 内不显示提交按钮及分支状态行，保存必须使用编辑器标题栏中的明确按钮，新建任务默认启用；任务名、有效调度或可提交的提示词、附件与 Skill 任一缺失时，保存必须保持灰色禁用
- 已保存任务的“立即运行”固定在编辑器标题栏左侧，与右侧保存操作分离；删除固定在运行记录后的独立危险操作区，始终使用红色危险按钮，并提供可取消的二次确认
- 触发时间必须使用应用内日期时间选择器，显示语言跟随应用设置，并按当前电脑本地时区读写；时间支持分钟级自由输入，不得强制固定时间间隔，也不得依赖原生 `datetime-local` 的系统语言界面；日期弹层打开不得改变相邻表单字段的位置，选中日期悬停时必须保持主色背景与高对比度文字
- 无人值守任务应优先使用 `approvalPolicy: never` 与满足任务所需的最小 `sandboxMode`；其他审批策略允许保存，但可能使创建的 Task 等待用户处理

## 验证要求

- 覆盖远程 release 新旧版本映射、仅 `0.1.0` 允许空 release、关于页常驻日志入口、安装 IPC 单调进度，以及签名 artifact 与 `latest.json` 发布约束
- 覆盖普通文件和原生媒体提交后在队列编辑与历史恢复中的附件 chip 保留行为
- 覆盖宿主附件超限错误码透传、本地化提示及超长路径下选择器操作按钮不溢出行为
- 覆盖生成图片落盘、Base64 移除和时间线附件映射行为
- 覆盖性能分位数、IPC 合并统计、源码虚拟化 DOM 上限和生产 Chunk 预算
- 覆盖超过 512 条 Delta、生命周期与审批请求混合事件的背压压力测试，断言事实流完整且 Delta 淘汰触发 `resync.required`
- 覆盖 MCP form/URL Resolution Schema 差异，以及 URL 外部打开成功后才提交 `accept` 的交互顺序
- 覆盖状态栏计数清零、Provider 终态归约、左键菜单、前后台系统通知、运行态恢复、菜单目标解析和普通/`temporary` 任务跳转
- 覆盖全屏主窗口关闭后从状态栏或通知恢复为非全屏普通窗口，以及未关闭时通知聚焦保持全屏状态
- 覆盖 Rust 任务活动的运行、等待、完成、失败、运行时崩溃和 WebView 重建恢复
- 覆盖五类审批请求、普通用户输入排除、运行开始时间恢复及看板运行时长投影
- 覆盖 Skills 市场兼容性过滤、Codex 路径启停、ZIP 路径穿越、GitHub 子目录提取、内容指纹冲突以及安装/更新浏览器交互
- 覆盖 RRULE 时区与夏令时、漏跑合并、并发跳过、崩溃恢复、原子持久化、前端输入从创建落盘到认领完成、嵌套调度字段 camelCase、Tauri 命令注册与窗口授权、IPC CRUD 映射、内容区列表操作、紧凑主色图标创建按钮、日期时间选择器语言切换、任意分钟输入、弹层布局稳定性与选中日期悬停状态、提示词区域无底部分割线、表单不完整时保存禁用、运行与删除操作分区、删除危险色与可取消确认、保存失败仅显示一个具体错误 Toast，以及 Composer 捕获不启动即时 Turn
