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
    │   │   └── 0.153.4/
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

Codex 适配器仅接受精确版本 `0.153.4`，启动时仍必须完成 app-server 初始化与能力探测；
预发布版本和无法严格解析的版本必须拒绝。应用私有回退包继续精确锁定版本与完整性摘要。

## 按需安装

未找到兼容版本时，界面提供以下操作：

- 安装当前适配器要求的版本。
- 选择本机已有可执行文件。
- 暂不启用该 Provider。

应用不得静默安装，也不得执行全局 `npm install -g`、Homebrew、WinGet 或系统包管理器命令。
界面可以展示固定的全局安装命令供用户自行执行，并必须明确区分全局安装与应用私有下载；用户
完成外部安装后可手动重新检测，私有下载完成后应用必须自动复检，兼容后再进入工作台。
按需安装使用 Provider 官方安装包，并写入应用私有目录。Codex 优先从 `registry.npmmirror.com`
下载相同版本和架构的包，网络、中断、大小或校验失败时回退一次 `registry.npmjs.org`。两个源
使用应用内固定的同一份官方 SHA-512 integrity；磁盘写入失败直接报错，不重复下载。
重定向只允许 HTTPS 的 `registry.npmmirror.com`、`cdn.npmmirror.com` 和 `registry.npmjs.org`，
仅使用标准端口、禁止 URL 凭据并限制跳转次数。连接超时为 8 秒，读取停滞超时为 15 秒，
镜像单次请求最多 90 秒，官方回退最多 15 分钟。切源时重置下载字节数和临时文件，进度序号继续递增。

安装流程：

1. 读取应用内固定的版本、目标架构、下载源和官方 checksum。
2. 将目标架构的文件下载到同文件系统的临时目录。
3. 校验来源、版本、目标平台、架构和 npm SHA-512 integrity；官方提供签名时必须同时校验签名。
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
`active.json` 同时作为用户已选择应用私有安装的持久标记。CodeAgent 升级后，启动检测会自动将
这类安装更新到新版本固定的 Codex 依赖；系统安装和用户显式指定的安装不会被静默修改。自动更新
失败时保留并继续探测 `active.json` 指向的上一可用版本，并在下次启动重试。
启动界面必须展示旧版本到目标版本、真实下载进度以及校验安装阶段；回退成功后进入工作台，并以
非阻塞通知说明当前继续使用的版本和重试入口。

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
