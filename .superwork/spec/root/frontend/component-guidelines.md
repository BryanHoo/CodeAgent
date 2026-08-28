# Web 前端组件规范

## 规则

- 使用函数组件和显式 Props，保持单一 UI 职责
- 通用控件优先复用 `src/shared/components/core/`，图标使用 `lucide-react`
- 交互元素提供可访问名称、禁用状态和可见焦点反馈
- 工作台仅面向桌面端，使用全局设计 tokens 约束三栏布局、颜色、间距和交互状态，不增加移动端适配分支
- 对话、推理、工具调用、终端、计划、文件树和 Diff 优先复用 `src/shared/components/agent/`；菜单与弹窗使用 Radix 交互语义
- 服务端快照通过 TanStack Query 读取，实时任务状态通过功能域 Runtime/Store 的选择器读取，避免订阅无关状态
- `temporary` 是合成任务作用域；依赖真实 Project 或根目录的查询必须在该作用域禁用
- Inspector 始终显示可用 Tab；数据模块仅在存在实体时渲染，无内容时在面板内容区显示空状态
- `@pierre/diffs` 首次显示前按当前文件语言预加载高亮器，避免首个 Diff 异步初始化后保持空白
- 仅在多个调用方确有一致需求时提取通用组件
