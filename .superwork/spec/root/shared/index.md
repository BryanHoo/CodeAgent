# 共享协议规格

## 附件契约

- `AgentMessageAttachment` 是提交、队列编辑和历史恢复共用的完整附件身份，必须保留 `id`、`kind`、`name`、`mediaType`、`size` 与 `path`
- 普通文件通过 `codexly-file:` `text_elements.placeholder` 携带固定大小元数据；关联的 `text` 仅保存本地缓存路径，不得作为可见正文渲染
- 生成图片正文只允许写入本地附件存储；跨 Rust、Tauri Channel 和 WebView 仅传固定大小附件元数据，不得传输 Base64 `result`

## 桌面宠物契约

- `DesktopPetState` 只同步宠物标识、活动动画、本地访问标志和最多 256 条任务气泡摘要；macOS 由原生窗口维护拖动，并以 AppKit 物理主键状态确认释放，前端维护动画生命周期，其他平台按帧合并物理坐标
- 宠物移动、状态更新和任务跳转使用固定 `desktop-pet://*` 事件，独立窗口不得连接 Provider Runtime

## 验证要求

- 覆盖普通文件提交后在队列编辑与历史恢复中的附件 chip 保留行为
- 覆盖生成图片落盘、Base64 移除和时间线附件映射行为
