# React 组件规范

## Purpose

约束 `apps/web` 内组件的职责、可访问性和渲染边界。

## Rules

- 每个组件只承担一个可描述的界面职责，紧凑工作台界面避免装饰性嵌套卡片。
- 工作台左栏先展示产品标识与名称，再按常显搜索框、“新建任务”、可选 `Pinned`、`Projects` 排列；没有固定 Task 时不渲染 `Pinned` 区域。
- Project 名称和右侧箭头都只切换任务树的展开状态，不导航或选中 Project；Task 链接继续负责工作台导航。
- 通过显式 Props 或专用 Hook 获取数据，不从组件内部访问 Server 或 Provider。
- 长列表使用稳定尺寸与虚拟化；流式 Item 独立订阅，避免整个 Task 重渲染。
- Task Timeline 必须显示失败 Turn 的归一化错误，并明确标识已截断的 Command Output，不能把错误或截断状态静默隐藏。
- 交互控件使用语义化元素并提供可访问名称、键盘行为和明确状态。
- 可能位于裁剪容器或视口边缘的 Tooltip 必须脱离局部层叠上下文渲染，并在桌面与窄屏中自动翻转、限制到视口安全边距；同时验证 Hover 和键盘焦点行为。
- `shared/styles/globals.css` 是颜色、字体、间距、圆角、阴影、动效和固定布局尺寸的唯一设计 Token 来源；组件使用语义化 Tailwind Token，不散落视觉字面值。
- 浅色与深色主题在同一语义 Token 中使用 `light-dark()` 定义，`data-theme` 只切换 `color-scheme`，禁止复制整套主题变量。
- 主题色固定为浅色 `surface #ffffff`、`ink #171717`、`accent #006aff`、`diffAdded #28a948`、`diffRemoved #eb001d`、`skill #a100f8`，深色 `surface #181818`、`ink #ffffff`、`accent #339cff`、`diffAdded #40c977`、`diffRemoved #fa423e`、`skill #ad7bf9`；浅色大面积区域保持纯白，不添加固定浅灰底。
- 工作台区域优先使用材质背景、淡阴影和留白区分层级，不使用贯穿面板的高对比边框；视口进入覆盖模式时关闭已打开的桌面面板。
- 永久 Sidebar 和 Inspector 使用连续同色背景，仅在其纵向边界添加低对比单像素分隔；侧栏顶栏不与下方内容分隔，主内容 Toolbar 保留单像素底部分隔。不使用模糊或多层重阴影，浮动阴影只用于 Composer、弹层和独立表面。
- 视觉系统变更使用 Playwright 检查 computed style、桌面与移动溢出、窗口缩放和控制台错误。
- 只有形成稳定复用模式后才写入本规范。
