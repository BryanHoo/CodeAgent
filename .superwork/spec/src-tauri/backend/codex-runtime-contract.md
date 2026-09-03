# Codex 0.152 运行时契约

## 版本与分发

- 应用私有 Codex 运行时固定为 `0.152.1`，全局安装提示使用 `npm install -g @openai/codex@0.152.1`
- 外部运行时仅接受 `>=0.152.1,<0.153.0`；拒绝预发行版、更低版本、`0.153.0` 及以上版本
- 私有下载仅使用 npm 官方的 Darwin arm64、Linux arm64/x64、Windows arm64/x64 五个平台包，并对完整内容校验官方 SHA-512 integrity
- 项目启用了 `experimentalApi`，未经源码和契约验证不得扩大兼容版本范围

## 线程协议

- 每个 `thread/start`、`thread/resume`、`thread/fork` 请求必须在 `config` 中传入 `tools.update_plan.enabled: true`
- 只使用请求级覆盖，不得改写用户全局 `config.toml`
- `thread/resume` 不传 `cwd`，由 Codex 从已保存线程恢复工作目录；恢复响应新增字段必须保持可解析
- `project/list` 接受项目的 `recencyAt` 字段，但不得请求 `recencyAt` 排序，产品顺序继续由 `position` 决定

## 新增通知与请求

- `modelProvider/authRecoveryStarted` 和 `modelProvider/authRecoveryCompleted` 必须校验 `threadId`、`turnId`、`provider`、`message` 后显式消费；当前不投影到 UI
- MCP elicitation 的 `openaiForm` 与旧 `openai/form` 均映射为 `unsupported`，不得按标准 `form` 渲染或提交
- 不启用 `omit_app_server_notification_media`，生成图片链路仍依赖通知中的媒体数据落盘

## 验证要求

- 覆盖版本上下界、五个平台 URL 与 SHA-512、安装命令和前端恢复提示
- 覆盖所有线程创建路径、恢复与 Fork 的计划工具配置，并断言恢复请求不携带 `cwd`
- 覆盖 `recencyAt` 兼容、认证恢复通知结构和 `openaiForm` 降级
- 使用本机 `codex-cli 0.152.1` 运行真实 App Server 生命周期冒烟，并运行 `pnpm check`
