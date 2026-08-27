# Tauri IPC 契约

## 命令边界

- Tauri 命令按职责拆分在 `src-tauri/src/application/*_commands.rs`
- 命令通过 `AppState` 编排行为，不在入口中堆叠领域逻辑
- Web 端对应调用集中在 `src/platform/tauri/`

## 数据契约

- 对外结构使用 `serde(rename_all = "camelCase")`
- 事件枚举使用 `serde(tag = "type", content = "data")`
- IPC 结构变化时同步修改 `src/domain/` 中对应的 TypeScript 类型
- Channel 事件保持单调递增序号，前端据此忽略陈旧事件
- 为序列化结果编写精确 JSON 断言，防止字段名或标签漂移

## Provider 运行时

- WebView 必须先通过 `connect_runtime` 建立模块级 Channel，再调用 `start_runtime`
- Provider 可执行文件不得作为 Tauri Sidecar 打包
- `start_runtime` 只启动后端已发现并验证的绝对路径，不接收 WebView 传入的程序路径
- WebView 不得控制下载地址、安装目录、校验值或进程参数
- 未找到兼容版本时，必须由用户确认后安装到应用私有目录，禁止调用全局包管理器
- 版本匹配后必须完成 Provider 专属能力探测，安装和升级必须支持原子切换与回退
- Codex 进程不得覆盖 `CODEX_HOME`，应继承用户配置并由官方逻辑回退到默认 `~/.codex`
- stdio JSONL 路由必须区分响应、通知和带 `id` 的服务端请求，不能仅按 `id` 关联响应
- 协议测试使用内存 stdio 覆盖初始化顺序、乱序响应和双向请求 ID 碰撞

## Codex 工作台

- 工作台运行时固定使用 `codex-cli 0.149.0` 的 `codex app-server`，协议判断以本地 `rust-v0.149.0` 源码为准
- React 到 Codex 的运行链路必须保持 `Tauri invoke/Channel -> Rust -> stdio JSONL`，不得重新引入 HTTP、WebSocket 或 mock 运行时
- app-server 只维持一个长生命周期 Channel；事件序号、通知队列、历史页、命令输出和附件必须保持有界
- 分页历史使用 `thread/turns/list(itemsView: "notLoaded")`，再并发调用 `thread/items/list` 补全同页 Turn；必须拒绝空游标、重复游标和错误 `turnId`
- 文件、Git、附件和自定义资源均由 Rust 校验项目根或资源目录边界，WebView 不得获得通用 shell 与任意文件访问能力
- Bing 壁纸只允许 Rust 访问固定 HTTPS 元数据与图片端点；响应必须限制大小、校验 JPEG 并原子写入单日缓存，再按文件动态授权 asset protocol
- 新增或修改工作台能力时，同步更新 `docs/codexly-capability-matrix.md` 并运行真实 Codex 0.149 生命周期测试
