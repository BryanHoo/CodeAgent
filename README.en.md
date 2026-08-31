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
  <a href="./README.md">简体中文</a>
  ·
  <a href="./LICENSE">License</a>
</p>

CodeAgent brings AI coding tasks, conversations, approvals, project files, and Git actions into one desktop workspace for sustained work on real projects without switching between multiple tools.

## Features

- Run project or temporary tasks and follow responses, commands, plans, approvals, and file changes in real time
- Keep follow-up work in a persistent task queue, then edit, reorder, or cancel messages before they run
- Attach files and images, reference project files with `@`, use Skills, and answer MCP input requests
- Choose the model, reasoning effort, Fast mode, approval behavior, and file access for each task
- Manage multiple project roots, temporary tasks, and archived tasks, and fork new tasks from existing conversations
- Browse and manage project files, then review diffs, uncommitted changes, and commit history
- Create or switch Git branches and worktrees, then select files to commit or push
- Use Simplified Chinese or English, system notifications, tray controls, and workspace pets

## Quick Start

1. Download the package for your platform from [Releases](https://github.com/BryanHoo/CodeAgent/releases).
2. Install and launch CodeAgent.
3. Follow the on-screen setup on first launch, then add a project and create a task.

Current packages are unsigned previews, so your system may display source or security warnings. Supported platforms are:

| Platform | Architecture | Package |
| --- | --- | --- |
| Windows 10/11 | x86_64 | NSIS |
| Ubuntu 24.04+ | x86_64 | DEB, AppImage |
| macOS 14+ | Apple Silicon | app, DMG |

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
