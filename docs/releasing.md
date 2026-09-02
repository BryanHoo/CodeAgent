# 跨平台发布

当前发布不配置 Apple Developer ID、Windows Authenticode 代码签名证书或 Linux GPG 密钥。
自动更新产物使用独立的 Tauri updater 私钥签名，产物仅应从本仓库的 GitHub Releases 获取。

## 支持矩阵

| 平台 | 目标 | 包格式 | 最低基线 |
| --- | --- | --- | --- |
| Windows | x86_64 | EXE（免安装）、NSIS | Windows 10/11，使用系统 WebView2 Runtime |
| Ubuntu | x86_64 | DEB、AppImage | Ubuntu 24.04 LTS+ |
| macOS | Apple Silicon | app、DMG | macOS 14+ |

Windows 同时发布两种产物：按 `tauri build --no-bundle --no-sign` 生成的 `portable.exe` 用于
免安装运行，NSIS 安装器作为 Tauri updater 的 Windows 更新目标。两者都不包含 Authenticode
代码签名；NSIS updater artifact 仍必须通过 Tauri updater 私钥签名。portable 产物不参与自动
更新，仍使用 Windows 10/11 自带并维护的 WebView2 Runtime，应用数据也写入系统应用数据目录。
Linux 和 macOS 的平台覆盖配置分别位于 `src-tauri/tauri.linux.conf.json` 和
`src-tauri/tauri.macos.conf.json`。

## Ubuntu 安装

DEB 不依赖 AppImage 的 FUSE 挂载机制，Ubuntu 用户应优先选择 DEB。AppImage 需要 FUSE 2
运行库；Ubuntu 默认安装的 FUSE 3 不能替代该运行库。Ubuntu 24.04 或更高版本安装：

```bash
sudo apt update
sudo apt install libfuse2t64
```

不要安装 `fuse` 软件包，否则可能移除系统默认的 `fuse3`。
如果无法安装 FUSE，可使用 AppImage 的解压运行模式，但每次启动都会产生额外解压开销：

```bash
chmod +x CodeAgent.AppImage
./CodeAgent.AppImage --appimage-extract-and-run
```

具体排障步骤见 [AppImage FUSE 文档](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)。

## 自动化

- `Quality`：在 Ubuntu 上执行 Web 和 Rust 的 lint、测试与构建。
- `Platform Build`：Pull Request 上验证 Windows、Ubuntu、macOS 的原生编译。
- `Release`：`v*` 标签或手动触发后，从 `CHANGELOG.md` 提取对应版本日志，通过全部质量门禁，构建各平台安装包并直接创建正式 GitHub Release。

Windows portable 构建显式使用 `--no-sign` 且不进入自动更新链路；Windows NSIS、Ubuntu 与
macOS 构建生成 Tauri updater artifact、`.sig` 和 `latest.json`。Tauri updater 签名只校验更新
来源与完整性，不等同于操作系统代码签名。

## 发布步骤

1. 在 `CHANGELOG.md` 添加 `## [版本] - YYYY-MM-DD` 日志，并更新版本比较链接。
2. 同步更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本。
3. 执行 `pnpm version:check` 和 `pnpm check`。
4. 推送与版本完全一致的标签，例如 `git tag v0.1.0 && git push origin v0.1.0`。
5. 确认 GitHub Actions 全部成功，并核对正式 Release 的正文、安装包、更新元数据与签名产物。

无签名应用会触发 Windows SmartScreen 和 macOS Gatekeeper 警告，Linux 包也没有可验证的发行者
签名。这是当前阶段的明确限制，不应引导用户关闭系统安全机制。正式公开发布前必须补齐各平台
签名、公证、真实品牌图标、许可证、Provider 运行时供应链校验和原生系统实机回归。

## Provider 运行时完整性

CodeAgent 发布包不得包含 Codex、Claude Code 等 Provider 可执行文件。正式发布前必须验证：

- 每个平台都能发现系统安装和应用私有安装，并正确拒绝不兼容版本。
- 按需安装只访问 Provider 官方分发源，不调用全局包管理器或修改系统 `PATH`。
- 下载产物的平台、架构、版本、SHA-256 和 Provider 提供的官方签名全部通过校验。
- 安装使用临时目录和原子切换，中断或失败不会破坏现有可用版本。
- 应用升级后能够提示安装新的兼容版本，并能回退到上一个已验证版本。

完整流程见 [Provider Runtime Manager](./provider-runtime-management.md)。

## 参考

- [Tauri GitHub Pipelines](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri Platform-Specific Configuration](https://v2.tauri.app/develop/configuration-files/)
- [Tauri GitHub Action](https://github.com/tauri-apps/tauri-action#usage)
- [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Linux Package Signing](https://v2.tauri.app/distribute/sign/linux/)
