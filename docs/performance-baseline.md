# 性能基线

本文用于复测文件搜索、源码打开、Runtime IPC、React commit 与前端 Chunk 体积。

## 运行基准

运行 Rust 文件系统基准：

```bash
pnpm performance:rust
```

运行 Chromium 源码打开基准：

```bash
pnpm performance:browser
```

构建后检查初始加载和异步 Chunk 预算：

```bash
pnpm build
pnpm performance:budget
```

`pnpm check:web` 已包含 Chunk 预算，CI 另行运行 Chromium 源码打开基准。

## 采样口径

| 指标 | 口径 |
|---|---|
| 文件搜索冷启动 | 每次清空 5 秒索引缓存后，在 5,000 文件工作区搜索 |
| 文件搜索热启动 | 复用内存索引搜索 |
| 取消延迟 | 发出 `cancel` 到搜索任务结束 |
| 源码读取 | Rust 完整读取 256 KiB 或 2 MiB 文件的所有 256 KiB 分页 |
| 源码打开 | Chromium 调用生产 `CodeBlock`，记录调用到首个 React commit |
| DOM 节点数 | 源码 commit 完成并经过两帧后的基准根节点后代数 |
| 最长主线程任务 | 源码打开期间 Long Task API 返回的最大 `duration` |
| React 渲染 | React Profiler 的 `actualDuration` P50、P95 |
| Delta 到 commit | Rust 写入 `receivedAtUnixMs` 到根 React Profiler commit 的 P95 |
| IPC | Rust Runtime 的已收事件、已发布事件、events/s、合并率和队列高水位 |
| Chunk | 生产构建的原始字节数；初始依赖图总量与所有非初始 JS 单 Chunk 最大值 |

## 当前基线

采样环境：macOS 26.6.2 arm64、Node.js 24.19.0、Rust 1.97.1、Playwright 1.62.1。

| 场景 | P50 | P95 | 其他 |
|---|---:|---:|---:|
| 文件搜索冷启动 | 20.960 ms | 22.486 ms | 5,000 文件 |
| 文件搜索热启动 | 0.040 ms | 0.048 ms | 内存索引 |
| 文件搜索取消 | 0.083 ms | 0.195 ms | 10 次 |
| Rust 读取 256 KiB | 0.127 ms | 0.294 ms | 单页 |
| Rust 读取 2 MiB | 1.078 ms | 1.415 ms | 8 页 |
| Chromium 打开 256 KiB | 4.400 ms | 28.600 ms | 168 DOM，Longest Task 0 ms |
| Chromium 打开 2 MiB | 7.600 ms | 24.600 ms | 168 DOM，Longest Task 0 ms |
| Profiler 256 KiB | - | 9.300 ms | `actualDuration` |
| Profiler 2 MiB | - | 11.900 ms | `actualDuration` |

构建体积基线：初始加载 `381,225 B`，最大异步 Chunk `501,239 B`。CI 预算分别为 `420,000 B` 和 `525,000 B`，定义在 `performance-budget.json`。

## 采集实时链路

以 `?performance-profile=1` 启动主窗口后，在 WebView DevTools 执行：

```js
window.__CODEAGENT_PERFORMANCE__?.snapshot()
```

返回 React `actualDuration`、Rust Delta 到 React commit、前端 IPC 接收速率、接收缓存高水位和 Long Task 分布。Rust IPC 的合并率与有界队列高水位通过 `TauriRuntimeClient.getPerformanceMetrics()` 读取。Profiler 默认在开发环境启用；生产环境必须显式添加查询参数，避免常驻测量开销。
