# 发布 CodeAgent

本文面向仓库维护者，说明 npm 与带签名 Updater 的 Desktop 制品发布流程。Desktop 更新检查和下载统一使用 GitHub Releases。

## 发布目标

根 `package.json` 是产品版本源且保持 `private: true`。公开 npm 包位于 `apps/node-cli`：

- `@bryanhu/code-agent`：CLI、Web 静态资源、Server Delivery 和 native loader。
- `@bryanhu/code-agent-darwin-arm64`：macOS Apple Silicon addon。
- `@bryanhu/code-agent-linux-x64-gnu`：Linux x64 glibc addon。
- `@bryanhu/code-agent-win32-x64-msvc`：Windows x64 MSVC addon。

主包用精确版本 `optionalDependencies` 选择当前平台包，不包含本地 `.node`、安装脚本或 `node-gyp` fallback。Desktop 与 CLI 只支持 macOS 14+ Apple Silicon、Windows 10+ x64 和 Ubuntu 22.04+ x64 glibc；不发布 Intel macOS、Windows/Linux arm64 或 musl artifact。

## 发布前配置

在 npm 的每个公开包中配置相同的 GitHub Actions Trusted Publisher：

| 配置项               | 值            |
| -------------------- | ------------- |
| Organization or user | `BryanHoo`    |
| Repository           | `CodeAgent`   |
| Workflow filename    | `release.yml` |
| Environment name     | `npm`         |
| Allowed actions      | `npm publish` |

GitHub 必须存在 `npm` Environment。工作流使用 OIDC 和 npm provenance，不保存长期 npm Token。另建受保护的 `release` Environment 并配置 Required reviewers；审批人只有在 draft artifacts 完成上一正式版本升级和篡改 updater 签名拒绝 smoke 后才能放行。

配置一台每次 job 前恢复干净快照的 Windows 10 x64 自托管 runner，并添加 `self-hosted, Windows, X64, windows-10` 标签。Windows Server runner 只负责可复现构建，不替代 Windows 10 最低系统验收。

在 GitHub Repository Actions Secrets 中配置：

| Secret                               | 用途                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`          | Tauri updater 私钥完整内容，只用于 CI 生成更新包签名。 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；当前私钥无密码时可不配置。                   |
| `APPLE_CERTIFICATE`                  | `Developer ID Application` `.p12` 文件的单行 Base64。  |
| `APPLE_CERTIFICATE_PASSWORD`         | 导出 `.p12` 时设置的密码。                             |
| `APPLE_SIGNING_IDENTITY`             | 完整 Developer ID identity。                           |
| `APPLE_API_ISSUER`                   | App Store Connect API Issuer ID。                      |
| `APPLE_API_KEY`                      | App Store Connect API Key ID。                         |
| `APPLE_API_PRIVATE_KEY`              | `AuthKey_*.p8` 文件完整内容。                          |

公钥已提交到 `apps/desktop/src-tauri/tauri.conf.json`。私钥不得提交到仓库、Artifact 或日志；本地 updater 私钥固定使用 `~/.tauri/code-agent-updater.key`，必须另行存入受控密码库并保留离线备份。丢失私钥后，已安装版本将无法验证后续更新。

在 Apple Developer 中创建 `Developer ID Application` 证书，将证书及私钥导出为带密码的 `.p12`，再生成 `APPLE_CERTIFICATE`：

```bash
openssl base64 -A -in DeveloperIDApplication.p12 -out certificate-base64.txt
```

在 App Store Connect 的 Users and Access > Integrations 创建具有 Developer 权限的 API Key。下载只能获取一次的 `AuthKey_*.p8`，将完整文件内容保存为 `APPLE_API_PRIVATE_KEY`。Workflow 只在 macOS runner 中将它写入 `RUNNER_TEMP` 的 `0600` 临时文件，并通过 `APPLE_API_KEY_PATH` 交给 Tauri；仓库不保存 `.p12` 或 `.p8`。

`APPLE_SIGNING_IDENTITY` 必须使用 `security find-identity -v -p codesigning` 显示的完整 `Developer ID Application: Organization Name (TEAMID)`。Tauri 配置显式启用 Hardened Runtime、要求 `minimumSystemVersion: "14.0"`，并在 `Entitlements.plist` 中将 `com.apple.security.app-sandbox` 固定为 `false`。macOS 系统 App Sandbox 必须保持关闭，任务与命令隔离由 Codex 自己的 `sandboxPolicy` 独立控制；当前 Desktop 也不启用 JIT、unsigned executable memory、禁用 library validation 或调试 entitlement。

Windows Desktop 当前按 Preview / Unsigned 发布。Workflow 直接构建未签名的 NSIS 和 MSI，不读取证书配置，也不执行系统代码签名门禁；GitHub Release 标题必须包含 `Windows Desktop: Preview / Unsigned`。安装时可能出现 Microsoft Defender SmartScreen 警告，这是当前预览状态的已知限制。

Updater 签名只验证更新包来源，不等同于操作系统代码签名。Windows 安装包虽然未签名，updater artifact 和 `.sig` 仍必须由 `TAURI_SIGNING_PRIVATE_KEY` 生成并通过内置公钥验证；macOS 仍必须通过 Developer ID signing、notarization 和 Gatekeeper 门禁。

本地执行 `pnpm build:desktop` 时，构建脚本优先使用当前环境的 `TAURI_SIGNING_PRIVATE_KEY`；未设置时自动使用 `~/.tauri/code-agent-updater.key`。无密码私钥会显式传递空的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，无需在本地 shell 重复配置。GitHub Actions Secret 只在工作流内生效，不会同步到本地环境。

## 准备版本

1. 同时更新根 `package.json`、`apps/node-cli/package.json` 和三个平台 `package.json` 的版本。
2. 更新 `CHANGELOG.md`，将 `Unreleased` 内容移入对应版本并填写日期。
3. 确认 updater 与 Apple 签名材料已进入 GitHub Secrets，`release` Environment 与 Windows 10 runner 已配置，并运行版本与完整门禁：

```bash
pnpm check:ci
pnpm check:rust
pnpm test:e2e
pnpm --filter @code-agent/desktop build
pnpm run desktop:artifact:check
```

4. 提交发布准备并创建同版本标签：

```bash
RELEASE_VERSION=x.y.z
git tag -a "v${RELEASE_VERSION}" -m "发布 v${RELEASE_VERSION}"
git push origin main
git push origin "v${RELEASE_VERSION}"
```

## 自动流程

`.github/workflows/release.yml` 在三个原生 runner 上并行执行以下步骤：

1. 校验 tag、根版本、CLI、native packages、Cargo workspace 和 Tauri 版本一致。
2. 通过固定 SHA 的 `tauri-action` 分别构建 DMG、DEB/AppImage 和 MSI/NSIS，使用 `TAURI_SIGNING_PRIVATE_KEY` 生成 updater artifact 和 `.sig`；macOS 额外完成 Developer ID 签名、公证和 stapling，Windows 直接生成 Preview / Unsigned 安装包。
3. 将各平台安装包、updater artifact、签名和合并后的 `latest.json` 上传到同一个 draft GitHub Release。
4. 在 macOS 14 Apple Silicon、Ubuntu 22.04 x64 和 Windows 10 x64 clean runner 安装 CLI 与 Desktop，执行 CLI doctor、macOS 系统签名验证和有界启动 smoke。
5. 等待 `release` Environment 审批人确认上一正式版本升级和篡改 updater 签名拒绝 smoke。
6. 先发布三个 native packages，再发布主 CLI 包，并向 draft Release 补充 Desktop 归档与 `SHA256SUMS`。
7. 执行 `gh release edit "${RELEASE_TAG}" --draft=false` 公开已验收 Release，使 Desktop updater 可以发现新版本。

macOS build job 在进入发布汇总前执行以下等价检查：

```bash
codesign --verify --deep --strict --verbose=2 "CodeAgent.app"
codesign -d --entitlements signed-entitlements.plist --xml "CodeAgent.app"
/usr/libexec/PlistBuddy -c "Print :com.apple.security.app-sandbox" signed-entitlements.plist
xcrun stapler validate "CodeAgent.app"
spctl --assess --type execute --verbose=4 "CodeAgent.app"
codesign --verify --strict --verbose=2 "CodeAgent.dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "CodeAgent.dmg"
```

Tauri 对 `.app` 完成公证并附加 ticket，再创建并签名 `.dmg`。因此 `stapler` 检查 `.app`，DMG 通过签名与 Gatekeeper 检查。CI 还会读取 `.app/Contents/Info.plist`，拒绝不等于 `14.0` 的 `LSMinimumSystemVersion`；同时提取最终签名 entitlement，拒绝将 `com.apple.security.app-sandbox` 设置为 `true` 的产物。

Desktop 固定从 `https://github.com/BryanHoo/CodeAgent/releases/latest/download/latest.json` 检查更新。`latest.json` 中包含平台下载 URL 和 `.sig` 内容；`tauri-plugin-updater` 下载后使用内置公钥验证签名，验证成功才安装并重启应用。

GitHub 的 `/releases/latest/` 不返回 draft。自动最低系统 smoke 通过后，`release-approval` job 在受保护 Environment 等待人工 updater 验收；审批完成前 npm publish 和 Release promotion 都不会执行。

## 处理失败

- 版本检查失败：修正所有 manifest；不得靠工作流动态改写版本。
- 某个平台构建失败：修复后重跑同一 tag；不得用其他平台 binary 代替。
- native packages 只发布了一部分：保持现有版本和相同构建输入，重跑工作流补齐缺失包。npm 发布不可原子回滚。
- native packages 已齐全但主包失败：重跑工作流；已存在 native 版本会跳过，主包继续发布。
- 主包已发布但平台包缺失：立即补发同版本缺失平台包；无法补齐时弃用主包版本并发布新版本。
- GitHub Release 创建失败：不修改制品，重跑 publish Job；工作流会复用已发布 npm 版本。
- Apple secret 缺失：补齐同名 Repository Actions Secret 后重跑 macOS build Job；不得把值写进 workflow、仓库文件或 Artifact。
- macOS 签名、公证、stapling 或 Gatekeeper 验证失败：保持 Release 为 draft，检查 Developer ID identity、证书链和 App Store Connect API Key 后重跑；不得上传未验收产物替换签名制品。
- Windows Preview 安装被 SmartScreen 拦截：确认安装包来自当前 GitHub Release 并核对 `SHA256SUMS`；在签名方案正式启用前不得对外宣称已通过系统代码签名门禁。
- Windows 10 runner 不在线或快照不干净：恢复 runner 后重跑 smoke；不得用 Windows Server 结果手动放行。
- `release` Environment 验收失败：拒绝审批并保持 draft，修复后使用同 tag 重新构建和验收；不得先发布 npm。
- GitHub Release promotion 失败：npm 包保持原版本，Release 保持 draft；确认同 tag Release 唯一存在后重跑 publish Job。
- updater 签名失败：确认 `TAURI_SIGNING_PRIVATE_KEY` 内容完整且与仓库公钥匹配；不得生成或替换新密钥后直接发布。
- `latest.json` 缺少平台：保持 Release 为 draft，重跑缺失平台的 build Job；三个支持平台齐全前不得公开。
- updater 安装拒绝签名：下载对应 Release artifact 和 `.sig` 复验构建输入，禁止关闭签名验证或改用 HTTP endpoint。
- `EUNSUPPORTEDPROTOCOL`：确认发布的是 `pnpm pack` 产生的 tarball，并运行 `pnpm run package:check`。

发布记录以 [npm 的 @bryanhu/code-agent 页面](https://www.npmjs.com/package/@bryanhu/code-agent)和 [GitHub Releases](https://github.com/BryanHoo/CodeAgent/releases) 为准。
