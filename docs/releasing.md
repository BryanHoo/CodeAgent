# 跨平台发布

当前发布仅生成无签名预览包，不配置 Apple Developer ID、Windows 代码签名证书、Linux GPG
密钥或 Tauri updater 签名密钥。产物仅应从本仓库的 GitHub Releases 获取。

## 支持矩阵

| 平台 | 目标 | 包格式 | 最低基线 |
| --- | --- | --- | --- |
| Windows | x86_64 | NSIS | Windows 10/11，安装时下载 WebView2 bootstrapper |
| Ubuntu | x86_64 | DEB、AppImage | Ubuntu 22.04 LTS |
| macOS | Apple Silicon | app、DMG | macOS 14+ |

Windows 暂不生成 MSI，因为 WiX 构建依赖 Windows 的 VBSCRIPT 可选功能。平台覆盖配置位于
`src-tauri/tauri.windows.conf.json`、`src-tauri/tauri.linux.conf.json` 和
`src-tauri/tauri.macos.conf.json`，Tauri 会根据构建主机自动合并对应文件。

## Ubuntu 安装

DEB 不依赖 AppImage 的 FUSE 挂载机制，Ubuntu 用户应优先选择 DEB。AppImage 需要 FUSE 2
运行库；Ubuntu 默认安装的 FUSE 3 不能替代该运行库。根据系统版本安装对应软件包：

```bash
# Ubuntu 22.04
sudo apt update
sudo apt install libfuse2

# Ubuntu 24.04
sudo apt update
sudo apt install libfuse2t64
```

不要在 Ubuntu 22.04 或更高版本上安装 `fuse` 软件包，否则可能移除系统默认的 `fuse3`。
如果无法安装 FUSE，可使用 AppImage 的解压运行模式，但每次启动都会产生额外解压开销：

```bash
chmod +x CodeAgent.AppImage
./CodeAgent.AppImage --appimage-extract-and-run
```

具体排障步骤见 [AppImage FUSE 文档](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)。

## 自动化

- `Quality`：在 Ubuntu 上执行 Web 和 Rust 的 lint、测试与构建。
- `Platform Build`：Pull Request 上验证 Windows、Ubuntu、macOS 的原生编译。
- `Draft Release`：`v*` 标签或手动触发后，构建各平台安装包并创建 GitHub draft release。

所有桌面构建显式使用 `--no-sign`。发布工作流不生成 updater JSON 或 updater 签名，避免让
无签名预览产物进入自动更新链路。

## 发布步骤

1. 同步更新 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本。
2. 执行 `pnpm version:check` 和 `pnpm check`。
3. 推送与版本完全一致的标签，例如 `git tag v0.1.0 && git push origin v0.1.0`。
4. 下载并实机验证 draft release 的全部产物，通过后再手动发布。

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
- [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Linux Package Signing](https://v2.tauri.app/distribute/sign/linux/)
