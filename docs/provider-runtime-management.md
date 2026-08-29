# Provider Runtime Manager

## 目标

CodeAgent 不将 Codex、Claude Code 等 Provider 可执行文件作为 Tauri Sidecar 打包。应用优先
复用本机兼容版本；未找到兼容版本时，由用户确认后按需安装到应用私有目录。

该方案用于控制安装包体积，并保证未来增加 Provider 时，基础安装包不会随外部运行时数量线性增长。

## 运行时来源

Provider Runtime Manager 按以下顺序查找可执行文件：

1. 用户显式选择的可执行文件。
2. CodeAgent 私有目录中已安装的兼容版本。
3. 当前进程 `PATH` 中的可执行文件。
4. 当前平台的常见官方安装目录。

所有候选项必须解析为绝对路径。WebView 只能选择已发现的候选项或触发受控安装，不能向 Rust
传入任意程序和参数。

## 目录布局

```text
appData/
└── providers/
    ├── codex/
    │   ├── bin/
    │   │   └── 0.149.0/
    │   ├── active.json
    │   └── logs/
    └── claude/
        ├── bin/
        │   └── <version>/
        ├── active.json
        └── logs/
```

`bin/<version>/` 保存应用按需安装的原生运行时，`active.json` 记录当前选定版本和已验证路径。
该文件通过同目录临时文件原子替换，避免依赖 Windows 符号链接权限。CodeAgent 不覆盖 Provider
官方状态目录；Codex 继承进程环境中的 `CODEX_HOME`，未配置时由官方逻辑读取默认 `~/.codex`。
因此 Codex CLI 与 CodeAgent 共享认证、项目、会话和配置。

## 发现与兼容性检查

应用启动后异步执行检测，不阻塞主界面：

1. 使用短超时运行 Provider 官方版本命令，例如 `codex --version` 或 `claude --version`。
2. 限制 stdout、stderr 最大读取量，拒绝无法解析或超时的候选项。
3. 将版本与当前 Provider 适配器声明的兼容策略比较。
4. 版本匹配后执行能力探测，例如启动 `codex app-server` 并完成初始化握手。
5. 缓存绝对路径、文件元数据、版本和探测结果；文件变化后缓存失效。

首版按精确版本匹配。适配器具备多版本回归测试后，可以扩展为受控版本范围，但能力探测仍是
启动前的必要条件。

## 按需安装

未找到兼容版本时，界面提供以下操作：

- 安装当前适配器要求的版本。
- 选择本机已有可执行文件。
- 暂不启用该 Provider。

应用不得静默安装，也不得执行全局 `npm install -g`、Homebrew、WinGet 或系统包管理器命令。
界面可以展示固定的全局安装命令供用户自行执行，并必须明确区分全局安装与应用私有下载；用户
完成外部安装后可手动重新检测，私有下载完成后应用必须自动复检，兼容后再进入工作台。
按需安装必须使用 Provider 官方分发源，并写入应用私有目录：

1. 下载版本元数据、签名或 checksum manifest。
2. 将目标架构的文件下载到同文件系统的临时目录。
3. 校验来源、版本、目标平台、架构和 SHA-256；官方提供签名时必须同时校验签名。
4. 设置最小必要的文件权限并再次执行版本探测。
5. 原子移动到 `bin/<version>/`，验证通过后更新 `active.json`。
6. 保留上一个可用版本，确认新版本稳定后再清理旧版本。

下载失败、磁盘不足、校验失败或进程被中断时，不得改变当前可用版本。应用不得重新托管第三方
二进制，正式接入 Provider 前还需确认其下载自动化和分发条款。

## 升级与回退

CodeAgent 版本与 Provider 适配器共同声明已验证的运行时版本。应用升级后重新检测，不兼容时提示
用户安装新版本，不覆盖或降级系统安装。

应用私有运行时由 CodeAgent 控制升级。需要精确版本的 Provider 应关闭自身自动更新，防止协议在
应用运行期间漂移。新版本必须先安装、校验和探测，再原子切换；启动失败时自动回退到上一版本。

## 性能与安全约束

- 检测和下载均在后台执行，只有用户启动 Provider 时才要求运行时进入 `ready`。
- 同一 Provider 的检测和安装任务必须去重，避免重复进程和重复下载。
- 不使用登录 shell 查找可执行文件，不向 WebView 授予通用 shell 权限。
- 日志不得记录认证信息、完整环境变量或下载凭据。
- 只启动已完成版本和能力验证的绝对路径。
- 不同 Provider 的进程、应用日志和可重建缓存必须隔离；Codex 状态统一由官方 `CODEX_HOME` 管理。

## 运行时状态

Provider Runtime Manager 至少需要表达以下状态：

```text
unchecked -> checking -> ready
                     ├-> missing
                     ├-> incompatible
                     └-> failed

missing | incompatible -> installing -> ready | failed
```

状态事件应包含 Provider、检测到的版本、要求版本、来源类型和可恢复错误码。安装进度可以进入
Channel，但可执行文件路径、下载地址和安装参数不能由 WebView 控制。
