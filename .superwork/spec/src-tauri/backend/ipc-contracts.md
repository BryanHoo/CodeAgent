# Tauri IPC 契约

## 命令边界

- Tauri 命令按职责拆分在 `src-tauri/src/application/*_commands.rs`
- 命令通过 `AppState` 编排行为，不在入口中堆叠领域逻辑
- Web 端对应调用集中在 `src/platform/tauri/`

## 数据契约

- 对外结构使用 `serde(rename_all = "camelCase")`
- 事件枚举使用 `serde(tag = "type", content = "data")`
- Codex 线程被其他 writer 占用时返回 `{ code: "CODEX_THREAD_BUSY", message }`；其他 Provider 错误继续使用通用错误，避免透传底层敏感细节
- IPC 结构变化时同步修改 `src/domain/` 中对应的 TypeScript 类型
- Channel 事件保持单调递增序号，前端据此忽略陈旧事件
- 为序列化结果编写精确 JSON 断言，防止字段名或标签漂移

## Provider 运行时

- WebView 必须先通过 `connect_runtime` 建立模块级 Channel，再调用 `start_runtime`
- Provider 可执行文件不得作为 Tauri Sidecar 打包
- `start_runtime` 只启动后端已发现并验证的绝对路径，不接收 WebView 传入的程序路径
- WebView 不得控制下载地址、安装目录、校验值或进程参数
- 未找到兼容版本时，必须由用户确认后安装到应用私有目录，禁止调用全局包管理器
- `inspect_codex_runtime` 只返回后端发现的版本状态；`install_codex_runtime` 不接收 WebView 下载参数，必须使用应用内固定的官方包地址与完整性校验值，安装后由前端再次检测。全局安装命令仅供展示，不得由应用执行
- 版本匹配后必须完成 Provider 专属能力探测，安装和升级必须支持原子切换与回退
- Codex 进程不得覆盖 `CODEX_HOME`，应继承用户配置并由官方逻辑回退到默认 `~/.codex`
- stdio JSONL 路由必须区分响应、通知和带 `id` 的服务端请求，不能仅按 `id` 关联响应
- 协议测试使用内存 stdio 覆盖初始化顺序、乱序响应和双向请求 ID 碰撞

## Codex 工作台

- 工作台运行时固定使用 `codex-cli 0.151.0` 的 `codex app-server`，协议判断以本地 `rust-v0.151.0` 源码为准
- React 到 Codex 的运行链路必须保持 `Tauri invoke/Channel -> Rust -> stdio JSONL`，不得重新引入 HTTP、WebSocket 或 mock 运行时
- app-server 只维持一个长生命周期 Channel；事件序号、通知队列、历史页、命令输出和附件必须保持有界
- 分页历史使用 `thread/turns/list(itemsView: "notLoaded")`，再并发调用 `thread/items/list` 补全同页 Turn；必须拒绝空游标、重复游标和错误 `turnId`
- 文件、Git、附件和自定义资源均由 Rust 校验项目根或资源目录边界，WebView 不得获得通用 shell 与任意文件访问能力
- 附件必须映射为 Codex 0.151 原生 `text` 或 `localImage` 输入；文本在 Rust 缓存边界校验 UTF-8 且不超过 1 MiB，前端不得展示 PDF、Office 等无原生输入支持的二进制格式
- `McpServerStatus.runtimeStatus` 必须映射 `notStarted`、`starting`、`connected`、`authenticationRequired`、`failed`、`cancelled` 与 `disabled`；`null` 按配置切换中的过渡状态处理，不得丢弃服务
- `functionCallOutput` 必须作为已完成工具项进入时间线；`sendMessage`、`followupTask`、`interruptAgent` 与 `listAgents` 必须映射为稳定的 Agent 工具标识
- `item/commandExecution/requestApproval.kind` 必须严格接受 `command` 或 `writeStdin`；终端输入必须按 0.151 固定命令结构解析并保留 `approvalId`、`processId`、`stdin` 与 `cwd`，未知或畸形请求必须拒绝
- Guardian `writeStdin` action 必须映射为独立的终端输入审批时间线项；WebView 必须使用 `terminal_input_approval` 独立判别并展示终端会话上下文
- `CodexErrorInfo.rateLimitExceeded` 必须映射为稳定的 `rate_limit_exceeded` IPC 错误码，不得退化为未知错误
- `mcpServer/event/stream/notification` 与三类 `thread/realtime/item/*` 通知在没有完整 Hosted MCP 订阅或 Realtime 音频产品流程时显式忽略，避免暴露不可操作状态和引入高频无效传输
- 附件上传与宿主文件导入是应用私有缓存能力，不得调用 `project/read`；必须支持没有真实 Codex Project 的 `temporary` 作用域，任务发送阶段再校验 Project/Task 归属
- Bing 壁纸只允许 Rust 访问固定 HTTPS 元数据与图片端点；响应必须限制大小、校验 JPEG 并原子写入单日缓存，再按文件动态授权 asset protocol
- 新增或修改工作台能力时，同步更新 `docs/codexly-capability-matrix.md` 并运行真实 Codex 0.151 生命周期测试
- CodeAgent 自身偏好写入 Tauri `app_data_dir()/app.json`，自定义背景写入 `app_data_dir()/backgrounds/custom/`；写入必须有界、校验资源标识并原子替换
- 桌面宠物透明窗口由 Rust 创建和销毁；宠物与按需气泡必须共用一个 WebView，命令校验固定窗口标签，并按气泡实际高度调整透明、无边框、置顶窗口的紧凑点击区域
- macOS 桌面宠物窗口必须注册为带 `FullScreenAuxiliary`、`CanJoinAllSpaces` 与非激活样式的浮动 `NSPanel`；`tauri-nspanel` 的转换、配置和销毁必须通过 `run_on_main_thread` 执行，动态转换后需补齐防激活标记；CodeAgent 未激活时面板必须拒绝成为 key window，已激活时继续支持键盘操作
- macOS 桌面宠物拖动只向主线程提交一次原生拖拽，并低开销轮询 AppKit 主键状态直至物理释放；释放后在应用已激活时恢复 main key window，并一次性钳制、布局和持久化；单一 `NSPanel` 调整气泡布局时必须保持宠物屏幕坐标稳定，其他平台的物理坐标命令继续按帧合并
- CodeAgent 存储迁移不得修改 `CODEX_HOME`；Codex 配置、认证、线程与 SQLite 始终由官方目录管理
