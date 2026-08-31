<p align="center">
  <img src="./public/brand/codeagent-mark.svg" alt="CodeAgent" width="88" />
</p>

<h1 align="center">CodeAgent</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-24-339933" alt="Node.js" />
  <img src="https://img.shields.io/badge/React-19-149eca" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff" alt="Vite" />
  <img src="https://img.shields.io/badge/Tauri-2-24c8db" alt="Tauri" />
  <img src="https://img.shields.io/badge/OpenAI_Codex-0.151-412991" alt="OpenAI Codex" />
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-0f766e" alt="MIT" />
  </a>
</p>

<p align="center">
  A local-first desktop AI coding workspace connected directly to Codex.
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

CodeAgent connects directly to `codex app-server` through Tauri and brings projects, tasks, conversations, approvals, files, and Git workflows into one desktop workspace. It communicates over a Rust stdio JSONL transport without a local HTTP, WebSocket, or Node.js service, and shares authentication, configuration, and sessions with the Codex CLI.

## Features

- Run project or temporary tasks and follow responses, commands, plans, approvals, and file changes in real time
- Keep follow-up work in a persistent task queue, then edit, reorder, or cancel queued messages before they run
- Attach files and images, reference project files with `@`, use Skills, and answer input requests from MCP servers
- Choose the model, reasoning effort, Fast mode, approval behavior, and file system access for each task
- Manage multi-root projects, temporary tasks, and archived tasks, and fork new tasks from existing conversations
- Browse, preview, rename, and delete project files; review diffs and commit history
- Create or switch Git branches and worktrees, then select files to commit or push
- Use Simplified Chinese or English, system notifications, tray controls, and workspace pets

## Requirements

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

The current release requires exactly `codex-cli 0.151.0`. CodeAgent looks for a compatible local runtime; if none is available, the startup screen lets you install it globally or download it into the app's private data directory. Authenticate with the official Codex CLI before use:

```bash
codex login
```

To use an existing Codex executable, set `CODEAGENT_CODEX_BIN` to its absolute path. CodeAgent inherits `CODEX_HOME`; when it is unset, Codex uses its default directory.

## Quick Start

Clone the repository and install its dependencies:

```bash
git clone https://github.com/BryanHoo/CodeAgent.git
cd CodeAgent
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts Vite and the Tauri desktop app. On first launch, the runtime check guides you through installing or selecting a compatible Codex version.

## Usage

For repository work, add one or more local directories as project roots, create a task, and submit your request. Create a temporary task when no project context is required. Messages can include files, images, project references, and Skills; while a task is running, you can steer it immediately or queue follow-up messages.

Task controls configure the model, reasoning effort, Fast mode, approval behavior, and sandbox scope. The workspace also provides project files, code changes, Git history, branches, worktrees, reviews, commits, and push actions.

## Common Commands

```bash
pnpm check:web    # Check the web application
pnpm check:rust   # Check the Rust application
pnpm check        # Run the complete quality suite
pnpm tauri build  # Build packages for the current platform
```

## Project Structure

```text
src/
├── app/                    # Application setup, routing, and page shell
├── components/             # Shared UI components
├── domain/                 # Provider-independent view models
├── features/               # Conversation, project, settings, and workbench features
├── platform/tauri/         # invoke / Channel adapters
├── stores/                 # WebView rendering state projections
└── styles/                 # Tailwind theme and global styles

src-tauri/src/
├── application/            # Tauri commands, state, and error boundaries
├── domain/                 # Stable IPC contracts from Rust to the WebView
└── infrastructure/         # Codex, Git, file system, and other implementations
```

The web layer never handles Codex JSON-RPC directly, and Tauri does not grant the WebView general Shell access. See these documents for implementation details and constraints:

- [Workbench capability matrix](docs/codexly-capability-matrix.md)
- [Provider Runtime Manager](docs/provider-runtime-management.md)
- [Performance baseline](docs/performance-baseline.md)
- [Cross-platform releases](docs/releasing.md)

## Platform Support

| Platform | Architecture | Packages |
| --- | --- | --- |
| Windows 10/11 | x86_64 | NSIS |
| Ubuntu 24.04+ | x86_64 | DEB, AppImage |
| macOS 14+ | Apple Silicon | app, DMG |

Current builds are unsigned preview packages. See [Cross-platform releases](docs/releasing.md) for installation limitations and platform notes.

## Help

- [Report an issue](https://github.com/BryanHoo/CodeAgent/issues)
- [Releases](https://github.com/BryanHoo/CodeAgent/releases)

## License

[MIT](LICENSE)
