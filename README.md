# CodeAgent

English | [简体中文](README.zh-CN.md)

CodeAgent is a local AI coding workspace for using Codex in your browser. It lets you create multiple tasks for your projects, follow Codex responses and actions, inspect files, review code, and manage Git changes.

CodeAgent runs on your computer. You can use it locally or access it from another device on a trusted local network.

## Features

- Work with Codex in your browser and follow responses, commands, and file changes in real time
- Organize tasks by project, with search, pin, rename, and archive actions
- Start temporary tasks without adding a project
- Attach images or files as context and use your configured Skills and MCP servers
- Choose the model, reasoning effort, approval behavior, and file access level
- Browse project files, inspect code changes, switch branches, and view Git history
- Start code reviews, generate commit messages, and commit or push changes
- Connect from a phone, tablet, or another computer on a trusted local network

## Requirements

Before you begin, make sure you have:

- Node.js 24 or later
- The official Codex CLI
- Chrome/Chromium 116+, Firefox 124+, or Safari 17.4+

Sign in to Codex from your terminal before your first use:

```bash
codex login
```

## Quick Start

Run the latest version without installing it:

```bash
npx --package @bryanhu/code-agent@latest code-agent start
```

CodeAgent opens in your browser after it starts. If the browser does not open automatically, visit:

```text
http://127.0.0.1:3210
```

Keep the terminal running while you use CodeAgent. Press `Ctrl+C` in the terminal when you want to stop it.

### Install Globally

If you use CodeAgent regularly, install it globally:

```bash
npm install --global @bryanhu/code-agent
code-agent start
```

## Basic Usage

### Start a Temporary Task

Open CodeAgent, select **New task** in the sidebar, enter your request, and submit it. Temporary tasks are useful for questions, analysis, or work that does not depend on a specific project directory.

### Work in a Project

1. Select the `+` button next to Projects.
2. Find and add your project folder in the directory picker.
3. Select the `+` button next to the project to create a task.
4. Enter the work you want completed, optionally add images, files, or a Skill, and submit it.
5. Follow Codex responses, tool activity, and approval requests while it works.

Project folders come from the computer running CodeAgent. When you connect from another device, the directory picker still shows files from the host computer.

### Adjust Task Settings

Before submitting a message, use the controls below the composer to choose the model, reasoning effort, approval behavior, and file access level. Select Plan mode when you want to prepare an implementation plan, or Goal mode when you want Codex to continue working toward an objective.

Type `/` at the beginning of the composer to access actions such as code review, context compaction, and continuing in a new task. Available actions depend on the current task.

### Review and Commit Changes

When a project has Git changes, use the inspector on the right to review the change summary and file diffs. You can also switch branches or view the commit history of the current branch.

Select **Commit**, choose the files to include, review or edit the commit message, and complete the commit. If the branch already has an upstream, you can also select **Commit and push**. Review the selected files and diffs before committing.

## Local Network Access

To connect from a phone, tablet, or another computer on the same local network, run this command on the host computer:

```bash
code-agent start --lan
```

The terminal displays a local network address and a one-time pairing code. Open the address on the other device and enter the pairing code.

Sessions are valid for 24 hours by default. You can set a fixed duration from `1m` to `30d`, for example:

```bash
code-agent start --lan --session-ttl 12h
```

Local network mode uses unencrypted HTTP. Use it only on a network you trust, and never expose the address to the internet. Restarting CodeAgent invalidates the pairing code and all existing sessions.

## Update CodeAgent

CodeAgent checks for new versions on the **About** page in Settings. Select the update action, wait for installation to finish, then stop and restart CodeAgent.

If you installed CodeAgent globally, you can also update it from the terminal:

```bash
npm install --global @bryanhu/code-agent@latest
```

If you use `npx`, run the Quick Start command again to use the latest version.

## Troubleshooting

### Codex Is Unavailable or Requires Sign-In

Run this command on the computer hosting CodeAgent:

```bash
codex login
```

After signing in, return to the browser and retry. If you use a custom Codex configuration directory, make sure the Codex CLI and CodeAgent use the same directory.

### The Browser Does Not Open

Confirm that the terminal shows `CodeAgent 已启动`, then open `http://127.0.0.1:3210` manually.

### Startup or Local Data Checks Fail

Run the diagnostic command:

```bash
code-agent doctor
```

Use the failed checks shown in the terminal to resolve issues with Node.js, Codex, or local data.

### Port `3210` Is Already in Use

Stop the existing CodeAgent process or the other application using the port, then run the start command again.

## Help

- [Report an issue](https://github.com/BryanHoo/CodeAgent/issues)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
