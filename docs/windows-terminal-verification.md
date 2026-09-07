# Windows 全量检查与终端验证记录

日期：2026-09-08（Asia/Shanghai）。基线：`0ee32d06ebc309a4d191136ca9773f314cff29d4`，包含拉取前已有的本地终端改动及本轮修复。远端从 `3fd6c83` 快进更新，未发生合并冲突。

## 环境

- Windows 11 企业版 LTSC，10.0.26100；真实 WebView2 152。
- Node 24.18.1、pnpm 11.22.0，依赖使用 `--frozen-lockfile` 安装。
- 原生测试使用 Release 构建，启用 `webview-tests` 和 `VITE_WEBVIEW_TEST=1`，不是可分发的生产安装包。
- 本机浏览器实际动画帧间隔约 20ms。终端默认 shell 为 Windows PowerShell；独立 ConPTY 集成测试还覆盖 cmd。
- PowerShell 执行策略阻止 `pnpm.ps1`，测试通过 `pnpm.cmd` 执行；Rust 仅加入当前命令进程的 PATH，未修改系统执行策略。

## 本轮修复与验证增强

1. 修复普通 Windows 构建的严格 Clippy 失败：`ChildExit.pid` 仅在 Unix 或 `webview-tests` 启用时保存，`Transport.outstanding_bytes` 仅在实际使用的测试/功能组合中编译。修复前普通功能集 Clippy 报两个 dead-code 错误，修复后普通功能集及 all-features 均通过。
2. 修复原生测试文件之间的 WebView 状态污染：embedded runner 复用应用时，后续测试现在重新加载已启动的 WebView，再安装独立 fixture。修复前组合运行到终端 UI 时找不到登录入口；修复后关键流程、终端协议和终端 UI 可在同一 runner 连续运行。
3. 新增显式 PowerShell ConPTY 输入/退出测试。`portable-pty` 在 Windows 的默认程序来自 `ComSpec`，原有默认 shell 测试与 cmd 测试不能作为 PowerShell 覆盖证据。
4. 新增真实 Windows 终端 UI 验证：PowerShell 输出 8192 行、每行超过 128 个字符，再输出拼接生成的中文完成标记；随后中断 30 秒 `Start-Sleep`，在 5 秒内确认下一条命令执行。标记使用字符串拼接，避免将命令输入回显误判为执行成功。
5. 终端延迟记录增加平台、输入到首个原生输出、输出到解析/渲染、动画帧间隔等分段信息，不采集终端文本。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过，包含版本、供应链策略、完整 Web 与 Rust 检查 |
| Web 单元测试 | 86 个文件，264 项通过 |
| Chromium / WebKit 浏览器测试 | 52 个文件，178 项通过 |
| 工程约束 / 预算测试 | 28 项工程约束、2 项预算测试通过 |
| lint、TypeScript、生产构建、包体预算 | 通过；初始依赖 419318 B，工作台依赖闭包 1449981 B，最大异步块 501239 B |
| Rust all-features 测试 | 293 项库测试通过，3 项协议集成测试通过，3 项 ConPTY 集成测试通过 |
| Rust 默认功能集与 all-features 严格 Clippy | 均通过；新增测试格式化后复核通过 |
| Rust 显式性能基线 | 文件读取、文件搜索两项通过 |
| 浏览器源码打开性能 | 256 KiB、2 MiB 两项通过 |
| 真实 WebView2 工作台流程 | 7 项通过 |
| 真实终端二进制协议 | 1 项通过：ArrayBuffer、PTY 标记和 97×31 resize |
| 真实终端 UI | Windows 适用的 5 项通过；3 项 macOS 专用测试跳过 |
| 真实 Codex 原生链路 | 1 项通过：运行时、项目、文件与 Git |
| Release WebView 性能基线 | 1 项通过 |
| Codex 0.153.4 协议快照 | 通过，使用应用私有 0.153.4；系统安装的 0.152.1 不满足精确版本要求 |
| 生产 Node 依赖审计 | 未发现已知漏洞 |
| 显式网络集成测试 | Bing JPEG 下载及 Codex 镜像压缩包完整性验证均通过 |

标准 Rust 测试报告的 5 项 ignored 中，2 项性能基线及 2 项网络测试已分别显式运行。剩余私有 Codex 安装/生命周期测试按现有 Windows CI 的边界通过真实应用链路验证，未运行 Windows Rust 测试宿主中的该项。生成图片 RSS 基线仅支持 macOS/Linux，不在 Windows 编译。

MSVC 链接器将“正在创建库”的普通输出报告为 `linker_messages` warning；它不代表链接失败。原生 runner 另有无法探测磁盘空间的诊断 warning，测试仍正常执行。

## 终端功能与性能边界

已验证懒创建、PowerShell/cmd 输入输出、中文输出、超过传输窗口的大量输出、Ctrl+C、二进制 Channel、resize、可见布局、隐藏恢复不重复创建、200 次保留标签切换、退出码 7 保留和标签移除。

最终组合回归的分段观测（2026-09-08 06:26，200 个输入样本）：

| 观测 | P95 |
| --- | ---: |
| UI 单字符 paste → xterm onRender | 40.6ms |
| 输入 → 首个原生输出到达 WebView | 1.8ms |
| 首个原生输出 → 最新解析完成 | 21.2ms |
| 首个原生输出 → onRender | 39.1ms |
| 保留标签切换 → onRender | 35.8ms |
| 浏览器动画帧间隔 | 20.1ms |

输入 P95 超过 30ms 目标，标签切换低于 50ms 目标；未放宽预算。输入通常跨越两个动画帧，分段证据将主要等待定位到输出后的解析/渲染阶段，但不能仅凭这些数据认定具体根因或全部归因于刷新率。首个原生输出可能包含控制序列；“输出到最新解析完成”也可能跨越多个输出块，不等同于解析器 CPU 耗时。尚未实施未经根因验证的渲染调度修改。

最终组合回归的 5 个原生测试文件全部通过（15 项通过、3 项 macOS 专用项跳过）。普通工作台的启动到可交互约 56.6ms，Runtime delta 渲染 P95 约 19.1ms。上述数字均包含测试驱动影响；onRender 不是显示器实际呈现时间。

原始终端数据：[`artifacts/terminal/release-render-latency.json`](../artifacts/terminal/release-render-latency.json)，每次复测会覆盖，查看 `measuredAt` 和 `platform` 确认所属运行。真实截图：[`artifacts/terminal/native-terminal.png`](../artifacts/terminal/native-terminal.png)。历史失败截图不作为通过证据。

尚未覆盖 Windows 可信系统键盘事件、原生关闭对话框的确认/取消、Release 多终端 CPU/RSS 压测，以及文档已列出的启动到 Job Object 归属竞态和阻塞 I/O 取消边界。项目的相关系统按键、原生对话框和资源采样工具目前仅支持 macOS。终端核心功能通过不代表 Windows Release 性能验收全部完成。

## 复现

在项目目录运行，先构建再启动原生测试：

```powershell
$env:PATH = 'C:\Users\bryanhu\.cargo\bin;' + $env:PATH
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test:browser
pnpm.cmd performance:browser
pnpm.cmd performance:webview:build
$env:CODEAGENT_WEBVIEW_RELEASE = '1'
$env:CODEAGENT_REAL_RUNTIME_TEST = '1'
pnpm.cmd exec wdio run wdio.conf.ts --spec tests/webview/critical-flows.spec.ts --spec tests/webview/terminal-protocol.spec.ts --spec tests/webview/terminal-ui.spec.ts --spec tests/webview/real-codex-runtime.spec.ts --spec tests/webview/performance.spec.ts
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

本次未改变协议或新增架构规则，规格分类结果为 `no-update`；简化审查为 `no-change`，修复保持在已复现问题范围内。
