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
  <a href="./docs/installation.en.md">Install & Uninstall</a>
  ·
  <a href="./README.md">简体中文</a>
  ·
  <a href="./LICENSE">License</a>
</p>

CodeAgent brings AI coding tasks, conversations, approvals, project files, and Git actions into one desktop workspace for sustained work on real projects without switching between multiple tools.

## Features

- Run project or temporary tasks and follow responses, commands, plans, approvals, and file changes in real time
- Follow task output in a separate transparent window without occupying the main workspace
- Keep follow-up work in a persistent task queue, then edit, reorder, or cancel messages before they run
- Attach files and images, reference project files with `@`, open temporary-task files, and copy absolute file paths
- Install and manage Skills, official plugins, and third-party markets in the extension center, including MCP service controls and hot reload
- Answer asynchronous questions in a pinned panel, prevent concurrent interactions with cross-client task locks, and restore thread model and reasoning settings
- Run commands in the project-native integrated terminal and switch between persistent sessions
- Use global shortcuts to create tasks, switch workspace areas, and perform common actions
- Create scheduled tasks with visual recurrence rules for weekdays, weekends, weekly, or monthly schedules, then preview upcoming runs
- Automatically install and verify an app-private Codex runtime without requiring a global Codex setup
- Choose the model, reasoning effort, Fast mode, approval behavior, and file access for each task
- Manage multiple project roots, temporary tasks, and archived tasks, and fork new tasks from existing conversations
- Filter tasks in the current project with collapsible search
- Browse and manage project files, review diffs, uncommitted changes, and commit history, then copy messages as source-preserving Markdown
- Create or switch Git branches and worktrees, then select files to commit or push
- Use Simplified Chinese or English, system notifications, tray controls, and workspace pets

## Quick Start

1. Download a package from [Releases](https://github.com/BryanHoo/CodeAgent/releases) and follow the [installation guide](./docs/installation.en.md).
2. Launch CodeAgent and let it install and verify its private Codex runtime.
3. Add a project or create a temporary task to begin.

Supports Windows, Ubuntu, and macOS. See the installation guide for architecture, minimum system versions, and Modern / Legacy package selection.

## Usage

For repository work, add one or more local directories as project roots, create a task, and submit your request. Create a temporary task when no project context is required. Messages can include files, images, project references, and Skills.

While a task is running, send additional guidance immediately or queue follow-up messages. Task controls configure the model, reasoning effort, Fast mode, approval behavior, and file access.

The workspace provides project files, code changes, Git history, branches, worktrees, reviews, commits, and push actions. Archived tasks can be restored or permanently deleted after confirmation.

## Documentation

- [Installation, updates, and uninstall](./docs/installation.en.md)
- [Development and builds](./docs/development.en.md)
- [macOS build profiles](./docs/macos-build-profiles.md)
- [Release guide](./docs/releasing.md)
- [Changelog](./CHANGELOG.md)

## Help

- [Report an issue](https://github.com/BryanHoo/CodeAgent/issues)
- [Releases](https://github.com/BryanHoo/CodeAgent/releases)

## License

[MIT](LICENSE)
