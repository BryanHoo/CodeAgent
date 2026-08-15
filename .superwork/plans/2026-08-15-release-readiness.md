# Desktop 与 CLI 发布就绪实施计划

**Goal:** 为 macOS 14+ Apple Silicon、Windows 10+ x64 和 Ubuntu 22.04+ x64 建立签名、最低系统 smoke、先验收后发布的 Desktop 与 CLI 正式发布门禁。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束产品目标、版本、签名、artifact 和发布验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束契约测试、跨平台边界和单文件上限。
- `.superwork/prd/2026-08-15-release-readiness-design.md` — 固定支持矩阵、签名方案、clean VM smoke 与发布依赖顺序。
- `docs/tauri-migration-plan.md` — 定义 Phase 9 与正式发布完成条件。

**Architecture:** 保留三平台托管原生构建；Windows 通过 Tauri custom sign command 在 bundler 内调用 Azure Artifact Signing；构建产物进入 macOS 14、Ubuntu 22.04 和 Windows 10 最低系统 smoke，三平台全部通过后才发布 npm 并将 GitHub draft Release 转为正式版本。

**Tech Stack:** GitHub Actions、Tauri v2、PowerShell、Bash、Node.js 24、pnpm、Vitest、Azure Artifact Signing。

## Global Constraints

- 产品目标固定为 `darwin-arm64`、`linux-x64-gnu` 和 `win32-x64-msvc`；不得加入 Intel macOS、Windows/Linux arm64 或 musl fallback。
- macOS build 固定使用 `macos-14` Apple Silicon，Linux 固定使用 `ubuntu-22.04`，Windows 10 smoke 固定使用 `self-hosted, Windows, X64, windows-10` runner。
- Windows Authenticode 必须发生在 Tauri updater 签名之前，签名或时间戳失败不得降级为未签名 artifact。
- npm publish 和 GitHub Release promotion 必须同时依赖三个最低系统 smoke 成功；失败 Release 保持 draft。
- 上一正式版本升级和篡改 updater 签名拒绝 smoke 必须由受保护的 `release` Environment 审批确认，并位于 npm publish 之前。
- Secret 只能由 GitHub Actions 环境注入，不写入仓库、Artifact 或日志。
- 发布与 smoke 脚本使用显式参数、非交互模式、有界等待和确定性清理；关键逻辑添加简短、清晰的中文注释。
- 单个生产或工具文件不超过 500 行；不启动开发服务器，不自动提交。

### Task 1: 建立 Windows Authenticode 签名门禁

**Files:**

- Modify: `tests/tauri-phase-9.test.ts`
- Create: `apps/desktop/scripts/sign-windows.ps1`
- Create: `tools/release/verify-windows-signatures.ps1`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `.github/workflows/release.yml`

**Interfaces:**

- Consumes: Tauri `bundle.windows.signCommand`、Azure Artifact Signing 六项环境变量、Tauri `%1` artifact path。
- Produces: 由固定版 `SignTool + Azure.CodeSigning.Dlib.dll` 签名的 CodeAgent executable、NSIS 和 MSI，以及 Authenticode `Valid` 与时间戳门禁。

**Behavior:**

- 先扩展 Phase 9 契约测试，要求 Windows custom sign command、固定工具版本、secret 完整性检查和签名验证步骤存在；实现 PowerShell wrapper，对单一绝对 artifact 路径与六项 Azure 配置执行非空校验，以结构化 metadata 和参数数组调用官方 `SignTool + dlib`，并让 workflow 在 Windows build 前安装固定版本、在 build 后验证产品主程序与安装器签名和时间戳。

**Stop Conditions:**

- 若 Tauri 当前 schema 不支持 `bundle.windows.signCommand`，停止并保留失败测试，不得改为 updater 签名后再修改安装器。
- 若官方 Artifact Signing Client dlib 与当前 Tauri 传入 artifact 类型不兼容，停止并记录真实命令错误，不得移除 Authenticode 门禁。
- 若签名验证无法排除 bundled Codex 第三方 executable，按确定的 bundle 目录和产品文件名收紧目标，不得断言第三方证书身份。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts`

Expected: Phase 9 测试锁定 Azure signing、Tauri 签名时序和最终 Authenticode 验证，全部通过。

### Task 2: 建立 CLI 与 Desktop 最低系统 smoke

**Files:**

- Modify: `tests/tauri-phase-9.test.ts`
- Create: `tools/release/smoke-cli.mjs`
- Create: `tools/release/smoke-desktop-macos.sh`
- Create: `tools/release/smoke-desktop-linux.sh`
- Create: `tools/release/smoke-desktop-windows.ps1`
- Modify: `.github/workflows/release.yml`

**Interfaces:**

- Consumes: 当前 workflow run 的 `npm-*` 与 `desktop-*` artifacts、当前平台 native target、三类安装包、clean runner 系统能力。
- Produces: CLI `--help`/`doctor` 结果、Desktop 安装与有界启动结果、Windows 安装后签名结果和确定性清理结果。

**Behavior:**

- 先添加最低系统 runner、artifact 下载和 smoke 依赖的失败契约；实现跨平台 CLI tarball 临时安装与诊断，分别实现 DMG、DEB/AppImage、NSIS/MSI 的唯一 artifact 解析、安装或挂载、限时进程存活检查、协作终止和清理；workflow 使用 `macos-14`、`ubuntu-22.04` 与带 `windows-10` 标签的自托管 runner 消费构建产物，不允许重新构建或使用 Windows Server smoke 代替 Windows 10。

**Stop Conditions:**

- 若安装包内部 executable 名称与 Cargo/Tauri product metadata 不一致，先从真实 bundle 清单解析并固定唯一名称，不得递归启动任意 `.exe`。
- 若 `code-agent doctor` 需要外部登录凭据，保留 native addon 与 bundled Codex/SQLite 的等价非认证诊断，不得把 secret 注入 smoke 用户目录。
- 若自托管 Windows runner 无法每次恢复干净快照，停止 Windows 10 smoke 接入，不得用残留安装状态产生通过结果。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts && node tools/release/smoke-cli.mjs --help`

Expected: 契约测试通过，CLI smoke 脚本可独立展示严格参数接口；真实平台脚本仅在匹配 artifact 与系统上运行。

### Task 3: 强制支持矩阵与先验收后发布

**Files:**

- Modify: `tests/tauri-phase-8.test.ts`
- Modify: `tests/tauri-phase-9.test.ts`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Interfaces:**

- Consumes: 三个平台 build/smoke job 结果、npm tarballs、draft GitHub Release、根产品版本。
- Produces: 仅含 DMG、NSIS/MSI、DEB/AppImage 的 Desktop matrix，以及 `build -> smoke -> publish -> promote` 发布顺序。

**Behavior:**

- 锁定 macOS 14 Apple Silicon、Ubuntu 22.04 x64 和 Windows x64 三个构建目标；将 Tauri bundles 限制为各平台支持的 installer；CI macOS smoke 使用明确 Apple Silicon runner；自动 smoke 后由受保护的 `release` Environment 审批确认 updater 升级与篡改拒绝结果，`publish` 依赖该审批，保持 native npm packages 先于 CLI，所有 npm 成功后才使用 `gh release edit --draft=false` 公开 Release。

**Stop Conditions:**

- 若 `macos-14` runner 在执行期间被 GitHub 下线，停止并要求配置同标签 Apple Silicon runner，不得切换 Intel runner 或删除 macOS 14 验证。
- 若 Tauri updater 对限制后的 bundle 集无法生成三个平台的 `latest.json`，停止并修复 bundle 选择，不得恢复 RPM 或未支持架构填充平台。
- 若 promotion 前无法确认同 tag draft Release 唯一存在，保持 draft 并失败，不得创建第二个 Release。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-8.test.ts tests/tauri-phase-9.test.ts && pnpm run release:version:check`

Expected: 支持矩阵、bundle allowlist、job 依赖与版本集合一致，npm 和正式 Release 均位于 smoke 之后。

### Task 4: 更新用户安装说明与发布运行手册

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/releasing.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: 已实现的平台、签名、smoke、失败恢复与发布顺序。
- Produces: 中英文用户支持矩阵和 Desktop/CLI 安装入口，以及维护者 Azure、Windows runner、draft promotion 操作契约。

**Behavior:**

- README 同步说明 Desktop 下载与 CLI npm 安装、三平台最低版本和架构、不支持目标；发布指南记录 Azure secrets、`windows-10` runner、Windows 签名检查、三平台 smoke、先验收后 npm 与 promotion 失败恢复；工程规范固化最低系统与发布门禁；迁移文档只标记仓库实现完成，不把尚未执行的真实 tag smoke 声称为已验收。

**Stop Conditions:**

- 若 README 的 GitHub Release 下载链接或 artifact 名称无法从 workflow 确定，使用稳定 Releases 页面和格式说明，不编造具体文件名。
- 若真实签名或最低系统 tag run 尚未执行，Phase 9 保持“门禁已实现、发布验收待执行”，不得标记整体完成。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts && pnpm exec prettier --check README.md README.zh-CN.md docs/releasing.md docs/tauri-migration-plan.md .superwork/spec/guides/index.md`

Expected: 文档与 workflow 使用同一支持矩阵、secret 名称、runner 标签和发布顺序，且不宣称未执行的外部验收。

### Task 5: 执行发布边界最终验证

**Files:**

- Modify: `.superwork/plans/2026-08-15-release-readiness.md`

**Interfaces:**

- Consumes: Tasks 1–4 的实现、测试、文档和工作区 diff。
- Produces: 本地可执行门禁证据、外部 tag dry run 前置条件清单和完成状态。

**Behavior:**

- 运行完整 TypeScript、Rust、版本、package 和 Desktop artifact 门禁；检查所有修改文件不超过项目允许上限，审查 workflow 权限与 secret 输出，确认本地验证与仍需真实 runner 执行的外部验收边界。

**Stop Conditions:**

- 任一 `pnpm check`、Rust、package、Desktop build/artifact 或定向测试失败时停止完成声明并修复根因。
- 本机缺少 updater 私钥、Apple/Azure secret 或目标系统时，记录真实 tag dry run 尚未执行，不得生成、替换或伪造签名材料。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm check:rust && pnpm run release:version:check && pnpm run package:check && pnpm run build:desktop && pnpm run desktop:artifact:check`

Expected: 所有本地门禁通过；外部剩余项仅为使用受控 secrets 和三个最低系统 runner 执行同 tag release workflow。
