# 安全策略

## 支持范围

安全修复只发布到最新版本。报告问题前，请先确认使用的是 npm 上的最新版本。

## 报告漏洞

请通过 [GitHub 私密漏洞报告](https://github.com/BryanHoo/CodeAgent/security/advisories/new) 联系维护者，不要创建公开 Issue。报告中请提供受影响版本、运行平台、复现步骤、影响范围和必要的脱敏证据。

不要提交 Token、Cookie、Prompt、完整命令输出、文件内容、本地路径或其他敏感数据。

## 安全边界

- 本地模式只监听 `127.0.0.1`；`--lan` 必须显式启用，并通过一次性配对码和限时 Session 认证。
- LAN 模式使用未加密 HTTP，只适用于可信局域网，不应通过端口转发或公网代理暴露。
- 浏览器只通过 CodeAgent Server 的受控 API 工作，不直接连接 Codex App Server、数据库或本地文件系统。
- Secret 不进入命令行参数、日志、Web 响应或仓库；认证 Cookie、审批和 Provider 请求必须在服务端校验。
- Project 路径和宿主文件操作必须执行真实路径、目标类型和授权范围校验。
- RPC、文件与网络操作、进程关闭及数据库 Worker 调用必须设置有界超时和清理流程。
