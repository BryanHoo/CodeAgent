# Tauri IPC 契约

## 命令边界

- Tauri 命令按职责拆分在 `src-tauri/src/application/*_commands.rs`
- 命令通过 `AppState` 编排行为，不在入口中堆叠领域逻辑
- Web 端对应调用集中在 `src/platform/tauri/`
- 新增 Tauri 命令必须同时登记到 `build.rs` 的应用命令清单，并加入目标窗口的最小 capability；测试必须覆盖命令注册与窗口授权，避免已实现命令在运行时被 ACL 拒绝

## 数据契约

- 对外结构使用 `serde(rename_all = "camelCase")`；带标签枚举的变体字段必须同时使用 `rename_all_fields = "camelCase"`，防止嵌套字段退化为 snake_case
- 事件枚举使用 `serde(tag = "type", content = "data")`
- Codex 线程被其他 writer 占用时返回 `{ code: "CODEX_THREAD_BUSY", message }`；其他 Codex RPC 错误返回 `{ code: "CODEX_RPC_ERROR", message, rpcCode }`，保留上游错误信息供用户处理，非 RPC 的传输与解析错误继续使用通用错误
- Tauri 框架以字符串拒绝参数或 ACL 错误时，WebView 客户端必须包装为 `Error` 并保留原始消息，不得在 Composer 中退化为无上下文兜底文案
- IPC 结构变化时同步修改 `src/domain/` 中对应的 TypeScript 类型
- Channel 事件保持单调递增序号，前端据此忽略陈旧事件
- 为序列化结果编写精确 JSON 断言，防止字段名或标签漂移

## Provider 运行时

- WebView 必须先通过 `connect_runtime` 建立模块级 Channel，再调用 `start_runtime`
- Provider 状态与故障恢复不得依赖 WebView Channel 是否存在；Rust supervisor 对启动失败和异常退出使用 1–30 秒有界退避，稳定运行后重置退避
- Provider 可执行文件不得作为 Tauri Sidecar 打包
- `start_runtime` 只启动后端已发现并验证的绝对路径，不接收 WebView 传入的程序路径
- WebView 不得控制下载地址、安装目录、校验值或进程参数
- 未找到兼容版本时，必须由用户确认后安装到应用私有目录，禁止调用全局包管理器
- `inspect_codex_runtime` 只返回后端发现的版本状态；`install_codex_runtime` 不接收 WebView 下载参数，必须使用应用内固定的官方包地址与完整性校验值，安装后由前端再次检测。全局安装命令仅供展示，不得由应用执行
- `inspect_codex_runtime` 与 `install_codex_runtime` 通过专用 Channel 发送 `{ sequence, phase, currentVersion, targetVersion, downloadedBytes, totalBytes }`；`phase` 必须精确表达 `preparing`、`downloading`、`installing`、`ready` 或 `failed`。序号必须单调递增，WebView 必须忽略陈旧事件；已知总量时至多按每个整数百分比上报一次，未知总量时按有界字节间隔上报，避免高频 IPC 和重复渲染
- 版本匹配后必须完成 Provider 专属能力探测，安装和升级必须支持原子切换与回退
- Codex 进程不得覆盖 `CODEX_HOME`，应继承用户配置并由官方逻辑回退到默认 `~/.codex`
- stdio JSONL 路由必须区分响应、通知和带 `id` 的服务端请求，不能仅按 `id` 关联响应
- 协议测试使用内存 stdio 覆盖初始化顺序、乱序响应和双向请求 ID 碰撞

## 诊断日志

- Rust、WebView 与 Codex stderr 统一写入带 `schemaVersion`、`timestamp`、`sessionId`、`source`、`level` 和稳定 `event` 的 JSONL；所有来源必须在 Rust 边界脱敏，凭据和提示内容不得落盘，路径必须替换，Project/Task/Thread 标识仅保留会话内稳定伪名
- Codex RPC 最终失败必须记录 `codex_rpc_request_failed`，并保留经过格式校验的 `rpcMethod`、数字 `rpcCode` 与经过脱敏的原始错误消息；重试中的瞬时过载错误不得重复记录
- Codex stderr 必须使用 JSON 格式、受控 `RUST_LOG`、有界单行读取和有界队列；丢弃 `debug/trace`，非法、超长或队列溢出只记录计数，不得回显原始内容
- 本地日志写入系统应用日志目录，单文件不超过 5 MiB，并最多保留 5 份历史日志；正常退出删除运行标记，残留标记在下次启动时记录异常退出事件
- `record_frontend_diagnostic` 只接受有界结构化上下文；`export_diagnostics` 必须先由用户选择保存位置，再流式生成不超过 30 MiB 的 ZIP，归档白名单仅包含 `codeagent*.log`、版本清单、已脱敏运行指标和说明文件，响应不得返回完整保存路径

## Codex 工作台

- 工作台协议基线使用 `codex-cli 0.151.0` 的 `codex app-server`，外部稳定运行时接受 `0.151.0` 及以上版本并完成初始化握手；应用私有回退包固定版本和完整性摘要
- React 到 Codex 的运行链路必须保持 `Tauri invoke/Channel -> Rust -> stdio JSONL`，不得重新引入 HTTP、WebSocket 或 mock 运行时
- app-server 只维持一个长生命周期 Channel；事件序号、通知队列、历史页、命令输出和附件必须保持有界
- 分页历史使用 `thread/turns/list(itemsView: "notLoaded")`，再并发调用 `thread/items/list` 补全同页 Turn；必须拒绝空游标、重复游标和错误 `turnId`
- 文件、Git、附件和自定义资源均由 Rust 校验项目根或资源目录边界，WebView 不得获得通用 shell 与任意文件访问能力
- 临时任务必须在 `app_data_dir()/temporary-workspaces/` 分配独立 `cwd`；生成文件预览必须由 Rust 通过 `thread/read.cwd` 解析根目录，并验证为受控目录的直接子目录；删除任务只能清理通过该验证的目录
- 附件必须映射为 Codex 0.151 原生 `text`、`localImage` 或 `localAudio` 输入；图片固定使用 `detail: auto`，普通二进制仅作为带身份元数据的本地路径引用，不得伪装成上游不存在的 `input_file`
- 附件 raw IPC、缓存和提交边界必须校验名称、类型、实际大小与聚合预算；文本不超过 1 MiB，文件合计不超过 50 MiB，图片合计不超过 512 MiB 且最多 1500 张
- `McpServerStatus.runtimeStatus` 必须精确映射 `notStarted`、`starting`、`connected`、`authenticationRequired`、`failed`、`cancelled` 与 `disabled`；`null` 映射为 `unknown`，未登录时按官方 TUI 规则映射为 `authenticationRequired`，不得用启动通知缓存覆盖线程权威快照
- MCP 清单 IPC 只传 `displayName`、`name`、`status` 与 `toolCount`；`mcpServer/startupStatus/updated` 仅负责使当前 Task Query 失效，不得向 WebView 传输完整工具定义或维护第二份连接状态
- `functionCallOutput` 必须作为已完成工具项进入时间线；`sendMessage`、`followupTask`、`interruptAgent` 与 `listAgents` 必须映射为稳定的 Agent 工具标识
- `item/commandExecution/requestApproval.kind` 必须严格接受 `command` 或 `writeStdin`；终端输入必须按 0.151 固定命令结构解析并保留 `approvalId`、`processId`、`stdin` 与 `cwd`，未知或畸形请求必须拒绝
- Guardian `writeStdin` action 必须映射为独立的终端输入审批时间线项；WebView 必须使用 `terminal_input_approval` 独立判别并展示终端会话上下文
- `CodexErrorInfo.rateLimitExceeded` 必须映射为稳定的 `rate_limit_exceeded` IPC 错误码，不得退化为未知错误
- `mcpServer/event/stream/notification` 与三类 `thread/realtime/item/*` 通知在没有完整 Hosted MCP 订阅或 Realtime 音频产品流程时显式忽略，避免暴露不可操作状态和引入高频无效传输
- 附件上传与宿主文件导入是应用私有缓存能力，不得调用 `project/read`；必须支持没有真实 Codex Project 的 `temporary` 作用域，任务发送阶段再校验 Project/Task 归属
- Bing 壁纸只允许 Rust 访问固定 HTTPS 元数据与图片端点；响应必须限制大小、校验 JPEG 并原子写入单日缓存，再按文件动态授权 asset protocol
- 新增或修改工作台能力时，同步更新 `docs/codexly-capability-matrix.md` 并运行真实 Codex 0.151 生命周期测试
- CodeAgent 自身偏好写入 Tauri `app_data_dir()/app.json`，自定义背景写入 `app_data_dir()/backgrounds/custom/`；写入必须有界、校验资源标识并原子替换
- 全局与 Project 的模型、推理、审批和沙箱默认值写入 `app_data_dir()/agent-settings.json`，不得写入 Codex 配置；更新必须整文件原子替换并返回实际变化字段，相同值不得触发磁盘写入或下游刷新
- 偏好、编辑器输入缓存与待办更新必须进入 Rust 单写者有界队列，由底层覆盖合并和失败重试；WebView 不得持有定时合并器或持久化 Promise 队列
- Rust `TaskActivityState` 是任务运行、等待、完成、失败及项目/标题元数据的唯一原生事实来源，并统一驱动系统通知、状态栏、桌面宠物和 WebView 恢复快照
- 任务取消订阅的终态触发、busy 重试和新回合取消必须由 Rust lease 管理器执行；WebView 只声明任务消费者挂载或卸载
- 桌面宠物透明窗口由 Rust 创建和销毁；宠物与按需气泡必须共用一个 WebView，命令校验固定窗口标签，并按气泡实际高度调整透明、无边框、置顶窗口的紧凑点击区域
- macOS 桌面宠物窗口必须注册为带 `FullScreenAuxiliary`、`CanJoinAllSpaces` 与非激活样式的浮动 `NSPanel`；`tauri-nspanel` 的转换、配置和销毁必须通过 `run_on_main_thread` 执行，动态转换后需补齐防激活标记；CodeAgent 未激活时面板必须拒绝成为 key window，已激活时继续支持键盘操作
- macOS 桌面宠物拖动只向主线程提交一次原生拖拽，并低开销轮询 AppKit 主键状态直至物理释放；释放后在应用已激活时恢复 main key window，并一次性钳制、布局和持久化；单一 `NSPanel` 调整气泡布局时必须保持宠物屏幕坐标稳定，其他平台的物理坐标命令继续按帧合并
- CodeAgent 存储迁移不得修改 `CODEX_HOME`；Codex 配置、认证、线程与 SQLite 始终由官方目录管理
