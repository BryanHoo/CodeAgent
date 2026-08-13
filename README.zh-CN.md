# CodeAgent

[English](README.md) | 简体中文

CodeAgent 是一个在浏览器中使用 Codex 的本地 AI 编程工作台。它可以围绕你的项目创建多个任务，展示 Codex 的回复和执行过程，并帮助你查看文件、审查代码、管理 Git 变更。

CodeAgent 运行在你的电脑上，既可以本机使用，也可以在可信局域网中从其他设备访问。

## 主要功能

- 使用浏览器与 Codex 对话，实时查看回复、命令执行和文件修改
- 按项目管理任务，支持搜索、固定、重命名和归档
- 无需添加项目即可使用临时任务
- 添加图片或文件、使用 `@` 引用项目文件，并调用已配置的 Skills 和 MCP
- 使用 ChatGPT 官方登录或连接自定义 OpenAI-compatible API
- 读取当前服务的模型列表，并选择模型、思考量、审批方式和文件访问范围
- 浏览和渐进预览项目文件，查看代码变更、当前分支和 Git 历史
- 发起代码审查，生成提交信息，并完成提交或推送
- 在手机、平板或其他电脑上通过可信局域网访问

## 使用前准备

请先准备：

- Node.js 24 或更高版本
- Chrome/Chromium 116+、Firefox 124+ 或 Safari 17.4+

CodeAgent 通过 `@openai/codex` 自带受支持的 Codex CLI 二进制，无需单独安装。如需在诊断或启动时使用其他可执行文件，可传入 `--codex-bin <path>` 或设置 `CODE_AGENT_CODEX_BIN`。

## 快速开始

无需安装，直接运行最新版本：

```bash
npx --package @bryanhu/code-agent@latest code-agent start
```

CodeAgent 启动后会自动打开浏览器。若浏览器没有自动打开，请手动访问：

```text
http://127.0.0.1:3210
```

运行 CodeAgent 的终端需要保持打开。完成使用后，在终端按 `Ctrl+C` 停止。

首次打开时，在页面中选择 ChatGPT 官方登录，或填写自定义 API 的 Base URL 和可选 API key。自定义服务必须兼容 OpenAI Responses API，并在 `<base-url>/models` 提供模型列表。API key 由 Codex 凭证系统管理，CodeAgent 的本地数据库只保存连接模式、Base URL 和已验证的模型目录。

### 全局安装

需要经常使用时，可以全局安装：

```bash
npm install --global @bryanhu/code-agent
code-agent start
```

## 基本用法

### 直接开始临时任务

打开 CodeAgent 后，点击左侧的“新建任务”，输入需求并提交。临时任务适合咨询、分析或不依赖特定项目文件的工作。

### 在项目中工作

1. 点击 Projects 旁的 `+`。
2. 在目录选择器中找到并添加项目文件夹。
3. 点击项目旁的 `+` 创建任务。
4. 输入要完成的工作，按需添加图片、文件或 Skill，然后提交。
5. 在执行过程中查看 Codex 的回复、工具操作和审批请求。

项目文件夹来自运行 CodeAgent 的电脑。通过其他设备访问时，目录选择器仍显示运行端电脑上的文件。在 Windows 上，可以通过磁盘选择器浏览任意可访问盘符中的文件夹。

通过文件树条目的 `...` 按钮或右键菜单，可以复制名称或项目相对路径、选择支持的应用打开，或将文件和目录引用追加到当前 Composer 草稿。

Inspector 的“来源”区域会集中展示当前任务使用过的附件。图片和源码可以直接在 CodeAgent 中预览，长文本文件会按需继续加载；其他文件会交给系统默认应用打开。本机附件选择器同样支持在 Windows 的可访问盘符之间切换。

### 调整任务设置

发送消息前，可以在输入框下方调整模型、思考量、审批方式和文件访问范围。需要先梳理方案或持续推进目标时，可在命令菜单中选择 Plan 或 Goal 模式。

输入 `@` 可以搜索并引用项目文件。CodeAgent 会将校验后的项目相对路径提交给 Codex，不会暴露运行端的绝对路径。在第一行或最后一行使用方向键 `↑` 和 `↓` 可以浏览历史输入，返回最新位置后会恢复当前草稿。

在输入框开头输入 `/`，还可以使用代码审查、上下文压缩、任务续接等操作。可用选项会根据当前任务显示。已配置 MCP 服务的启动或失败状态会实时更新。

### 查看和提交代码变更

项目存在 Git 变更时，可以在右侧面板查看变更摘要和文件差异，也可以切换分支或查看当前分支的提交历史。

点击“提交”后选择要包含的文件，确认或编辑提交信息，再执行提交。已有上游分支时，也可以选择“提交并推送”。提交前请检查文件和差异内容。

## 局域网访问

默认从端口 `3210` 启动。如果端口被占用，CodeAgent 会逐个尝试后续端口，直到找到可用端口。本机或局域网启动都可以通过 `--port` 指定其他起始端口：

```bash
code-agent start --port 4567
```

需要从同一局域网内的手机、平板或其他电脑访问时，在运行端执行：

```bash
code-agent start --lan
```

默认情况下，终端会显示局域网访问地址和随机访问密码。在其他设备的浏览器中打开该地址，再输入密码即可。

可以通过 `--lan-password` 指定自己的强密码。密码长度必须为 16 至 128 个字符，并同时包含大写字母、小写字母、数字和符号。密码含有 Shell 特殊字符时请使用引号包裹。CodeAgent 会在启动前验证密码，且不会将密码回显到终端：

```bash
code-agent start --lan --lan-password 'Strong-Lan_Pass9!'
```

通过反向代理将外部域名转发到 CodeAgent 时，必须显式允许该精确域名。需要允许多个域名时，可重复传入 `--allowed-host`：

```bash
code-agent start --allowed-host code.example.com
```

参数值只能是域名，不能包含协议、端口或通配符。该选项只扩展精确 `Host` 白名单，不信任 `X-Forwarded-Host`，也不会改变监听地址或增加认证。

未设置 TTL 时，会话在当前 CodeAgent Server 进程运行期间永不过期。`--session-ttl` 接受带 `ms`、`s`、`m`、`h` 或 `d` 单位的任意正整数时长，例如：

```bash
code-agent start --lan --session-ttl 12h
```

显式配置过期时间后，会话会在固定截止时间失效，请求不会延长有效期。局域网模式使用未加密的 HTTP，仅应在你信任的网络中使用。不要将访问地址暴露到互联网。重启 CodeAgent 后，原访问密码和已有会话都会失效，包括未配置 TTL 的会话。

## 更新 CodeAgent

在交互式终端中执行 `code-agent start` 时，CodeAgent 会在启动前检查新版本。确认提示后会安装新版本，并使用原启动参数自动重新启动；拒绝后则继续使用当前版本。

CodeAgent 运行期间会在侧栏提示可用更新。打开“设置 > 关于”可以重新检查、查看目标版本的更新日志或执行安装。从浏览器安装更新后，停止并重新启动 CodeAgent 即可生效。

全局安装的用户也可以在终端更新：

```bash
npm install --global @bryanhu/code-agent@latest
```

通过 `npx` 启动时，再次运行快速开始命令即可使用最新版本。

## 常见问题

### 提示 Codex 不可用或需要登录

回到页面中的模型服务连接界面重新登录，或在“设置 > 模型服务”检查自定义 API。自定义服务需要支持 Responses API 和 `GET /models`；确认 Base URL 已包含正确的 API 版本路径。

### 页面没有自动打开

确认终端中已显示“CodeAgent 已启动”，然后手动打开终端输出的访问地址。

### 启动或数据检查失败

运行诊断命令：

```bash
code-agent doctor
```

根据终端中失败的检查项处理 Node.js、Codex 或本地数据问题。

### 起始端口已被占用

CodeAgent 会自动递增端口，找到可用端口后输出实际访问地址。可以执行 `code-agent start --port 4567` 从其他端口开始探测。

## 获取帮助

- [问题反馈](https://github.com/BryanHoo/CodeAgent/issues)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [版本记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE)
