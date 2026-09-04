<p align="center">
  <img src="./public/brand/codeagent-mark.svg" alt="CodeAgent" width="88" />
</p>

<h1 align="center">CodeAgent</h1>

<p align="center">
  A local-first desktop AI coding workspace.
</p>

<p align="center">
  <a href="#features">Features</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#install-permissions-and-uninstall">Install & Uninstall</a>
  ·
  <a href="./README.md">简体中文</a>
  ·
  <a href="./LICENSE">License</a>
</p>

CodeAgent brings AI coding tasks, conversations, approvals, project files, and Git actions into one desktop workspace for sustained work on real projects without switching between multiple tools.

## Features

- Run project or temporary tasks and follow responses, commands, plans, approvals, and file changes in real time
- Keep follow-up work in a persistent task queue, then edit, reorder, or cancel messages before they run
- Attach files and images, reference project files with `@`, and safely install or manage Skills from the Skills marketplace
- Enable, disable, and hot-reload MCP services, and answer MCP input requests
- Create scheduled tasks with one-time or recurring schedules, then review their run history
- Choose the model, reasoning effort, Fast mode, approval behavior, and file access for each task
- Manage multiple project roots, temporary tasks, and archived tasks, and fork new tasks from existing conversations
- Browse and manage project files, then review diffs, uncommitted changes, and commit history
- Create or switch Git branches and worktrees, then select files to commit or push
- Use Simplified Chinese or English, system notifications, tray controls, and workspace pets

## Quick Start

1. Download the release artifact for your platform from [Releases](https://github.com/BryanHoo/CodeAgent/releases).
2. Follow the platform-specific steps below to install and launch CodeAgent.
3. Follow the on-screen setup on first launch, then add a project and create a task.

Current packages are unsigned previews, so your system may display source or security warnings. Supported platforms are:

| Platform | Architecture | Package |
| --- | --- | --- |
| Windows 10/11 | x86_64 | Portable EXE |
| Ubuntu 24.04+ | x86_64 | DEB, AppImage |
| macOS 14+ | Apple Silicon | app, DMG |

## Install, Permissions, and Uninstall

All current release packages are unsigned. Download them only from this repository's [Releases](https://github.com/BryanHoo/CodeAgent/releases), and run the permission commands only after confirming the download source. These commands allow CodeAgent specifically and do not disable system-wide security checks.

### Windows 10/11

The Windows build is a portable EXE. After downloading it, rename the file to `CodeAgent.exe` and open PowerShell in the same directory:

```powershell
Unblock-File -Path ".\CodeAgent.exe"
Start-Process -FilePath ".\CodeAgent.exe"
```

`Unblock-File` removes only this file's download marker. If SmartScreen still blocks it, verify the app name and download source in the system prompt, then select **More info > Run anyway**. Do not disable SmartScreen globally.

To uninstall, close the app and delete the EXE:

```powershell
Stop-Process -Name "CodeAgent" -Force -ErrorAction SilentlyContinue
Remove-Item -Force ".\CodeAgent.exe"
```

To also remove settings, attachments, and caches, run the following commands. This cannot be undone:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\com.codeagent.desktop" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\com.codeagent.desktop" -ErrorAction SilentlyContinue
```

### Ubuntu 24.04+

The DEB package is recommended. After downloading it, rename the file to `CodeAgent.deb`:

```bash
chmod 0644 "./CodeAgent.deb"
sudo apt install "./CodeAgent.deb"
codeagent
```

Uninstall the DEB package with:

```bash
sudo apt purge codeagent
```

For the AppImage, rename the file to `CodeAgent.AppImage`, install FUSE 2, and grant execute permission:

```bash
sudo apt update
sudo apt install libfuse2t64
chmod +x "./CodeAgent.AppImage"
"./CodeAgent.AppImage"
```

If FUSE cannot be installed, use extract-and-run mode:

```bash
"./CodeAgent.AppImage" --appimage-extract-and-run
```

An AppImage does not need installation. To uninstall it, close the app and delete the file:

```bash
pkill -x codeagent
rm -f "./CodeAgent.AppImage"
```

To also remove settings, attachments, and caches from their default locations, run the following commands. This cannot be undone. If `XDG_DATA_HOME` or `XDG_CACHE_HOME` is customized, remove `com.codeagent.desktop` from those directories instead:

```bash
rm -rf "$HOME/.local/share/com.codeagent.desktop"
rm -rf "$HOME/.cache/com.codeagent.desktop"
```

### macOS 14+

The macOS build supports Apple Silicon only. After downloading it, rename the file to `CodeAgent.dmg`:

```bash
hdiutil attach "./CodeAgent.dmg"
sudo ditto "/Volumes/CodeAgent/CodeAgent.app" "/Applications/CodeAgent.app"
hdiutil detach "/Volumes/CodeAgent"
sudo xattr -dr com.apple.quarantine "/Applications/CodeAgent.app"
open "/Applications/CodeAgent.app"
```

`xattr` removes only CodeAgent's quarantine marker and does not disable Gatekeeper. If the mounted volume is not named `CodeAgent`, replace `/Volumes/CodeAgent` with the volume name shown in Finder.

Uninstall the app with:

```bash
pkill -x CodeAgent
sudo rm -rf "/Applications/CodeAgent.app"
```

To also remove settings, attachments, and caches, run the following commands. This cannot be undone:

```bash
rm -rf "$HOME/Library/Application Support/com.codeagent.desktop"
rm -rf "$HOME/Library/Caches/com.codeagent.desktop"
```

## Usage

For repository work, add one or more local directories as project roots, create a task, and submit your request. Create a temporary task when no project context is required. Messages can include files, images, project references, and Skills.

While a task is running, send additional guidance immediately or queue follow-up messages. Task controls configure the model, reasoning effort, Fast mode, approval behavior, and file access.

The workspace provides project files, code changes, Git history, branches, worktrees, reviews, commits, and push actions. Archived tasks can be restored or permanently deleted after confirmation.

## Run from Source

Requirements:

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
git clone https://github.com/BryanHoo/CodeAgent.git
cd CodeAgent
pnpm install
pnpm tauri dev
```

Common checks and build commands:

```bash
pnpm check:web
pnpm check:rust
pnpm check
pnpm tauri build
```

## Help

- [Report an issue](https://github.com/BryanHoo/CodeAgent/issues)
- [Releases](https://github.com/BryanHoo/CodeAgent/releases)

## License

[MIT](LICENSE)
