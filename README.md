# CodeAgent

English | [简体中文](README.zh-CN.md)

CodeAgent is a local AI coding workspace for using Codex in your browser. It lets you create multiple tasks for your projects, follow Codex responses and actions, inspect files, review code, and manage Git changes.

CodeAgent runs on your computer. You can use it locally or access it from another device on a trusted local network.

## Features

- Work with Codex in your browser and follow responses, commands, and file changes in real time
- Organize tasks by project, with search, pin, rename, and archive actions
- Start temporary tasks without adding a project, preview files, or add a project from the task
- Attach images or files, reference project files with `@`, and use configured Skills and MCP servers
- Fork a task from a specific AI response and continue work in a newly created Git worktree
- Sign in with ChatGPT or connect a custom OpenAI-compatible API
- Load models from the active service and choose the model, reasoning effort, approval behavior, and file access level
- Browse large project file trees, inspect code changes, switch or create branches, and view Git history
- Start code reviews, generate commit messages, and commit or push changes
- Follow the system theme and receive native notifications when a task needs attention
- Connect from a phone, tablet, or another computer on a trusted local network

## Requirements

Before you begin, make sure you have:

- Node.js 22.13.0 or later
- Chrome/Chromium 116+, Firefox 124+, or Safari 17.4+

CodeAgent includes the supported Codex CLI binary through `@openai/codex`; a separate Codex CLI installation is not required. To use another executable for diagnostics or startup, pass `--codex-bin <path>` or set `CODE_AGENT_CODEX_BIN`.

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

On first launch, sign in with ChatGPT in the browser or enter a custom API base URL and optional API key. A custom service must support the OpenAI Responses API and expose its model catalog at `<base-url>/models`. Codex manages API credentials; CodeAgent stores only the connection mode, base URL, and validated model catalog in its local database.

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

Project folders come from the computer running CodeAgent. When you connect from another device, the directory picker still shows files from the host computer. The picker accepts absolute paths and can show hidden items; on Windows, use the drive selector to browse folders on any accessible drive.

Use a file tree item's `...` button or context menu to copy its name or project-relative path, open it with a supported application, or append it as a reference to the current composer draft.

The inspector's **Sources** section collects attachments used in the current task. Images and source files open in CodeAgent, including on-demand loading for long text files; other files open with their system default application. The host attachment picker also supports switching between accessible Windows drives.

### Adjust Task Settings

Before submitting a message, use the controls below the composer to choose the model, reasoning effort, approval behavior, and file access level. Select Plan mode when you want to prepare an implementation plan, or Goal mode when you want Codex to continue working toward an objective. Permission requests show the requested network and file system access so you can choose the approved scope and duration.

Type `@` to search for and reference a project file. CodeAgent sends the validated project-relative reference to Codex without exposing the host's absolute path. Use `Up` and `Down` at the first or last line to browse earlier prompts; returning past the newest entry restores your current draft.

You can submit another message while the current turn is still running. Depending on the global setting, CodeAgent queues it as a follow-up or steers the current turn immediately; queued messages can be edited or canceled before they are sent.

Type `/` at the beginning of the composer to access actions such as code review, context compaction, and continuing in a new task. Available actions depend on the current task. MCP status updates appear in real time while configured servers start or fail.

Use an AI response's action menu to fork the conversation from that point. In a project task, the branch control below the composer can also create a Git worktree and switch the task to its new branch.

### Review and Commit Changes

When a project has Git changes, use the inspector on the right to review the change summary and file diffs. The same inspector provides the current branch's commit history and commit controls, while the composer branch control handles branch switching and worktree creation.

Select **Commit**, choose the files to include, review or edit the commit message, and complete the commit. If the branch already has an upstream, you can also select **Commit and push**. Review the selected files and diffs before committing.

Global settings let CodeAgent follow the operating system theme and enable native notifications for completed or failed tasks and tasks waiting for your input.

## Local Network Access

The default starting port is `3210`. If it is occupied, CodeAgent automatically tries each following port until one is available. Use `--port` to choose another starting port for local or LAN access:

```bash
code-agent start --port 4567
```

To connect from a phone, tablet, or another computer on the same local network, run this command on the host computer:

```bash
code-agent start --lan
```

By default, the terminal displays a local network address and a random access password. Open the address on the other device and enter that password.

You can provide your own strong password with `--lan-password`. It must contain 16 to 128 characters, including an uppercase letter, a lowercase letter, a number, and a symbol. Quote passwords that contain shell-special characters. CodeAgent validates the password before starting and does not print it back to the terminal:

```bash
code-agent start --lan --lan-password 'Strong-Lan_Pass9!'
```

When a reverse proxy forwards an external domain to CodeAgent, allow that exact domain explicitly. Repeat `--allowed-host` for each domain:

```bash
code-agent start --allowed-host code.example.com
```

The value must be a domain without a scheme, port, or wildcard. This option only extends the exact `Host` allowlist; it does not trust `X-Forwarded-Host`, change the listening address, or add authentication.

Sessions do not expire while the current CodeAgent server process is running unless you set a TTL. `--session-ttl` accepts any positive integer followed by `ms`, `s`, `m`, `h`, or `d`, for example:

```bash
code-agent start --lan --session-ttl 12h
```

An explicitly configured session expires at its fixed deadline and requests do not extend it. Local network mode uses unencrypted HTTP. Use it only on a network you trust, and never expose the address to the internet. Restarting CodeAgent invalidates the access password and all existing sessions, including sessions without a TTL.

## Update CodeAgent

When `code-agent start` runs in an interactive terminal, CodeAgent checks for a newer version before starting. Confirm the prompt to install it and automatically restart with the original arguments, or decline to continue with the current version.

While CodeAgent is running, the sidebar indicates available updates. Open **Settings > About** to check again, view the target version's release notes, or install it. Updates installed from the browser take effect after you stop and restart CodeAgent.

If you installed CodeAgent globally, you can also update it from the terminal:

```bash
npm install --global @bryanhu/code-agent@latest
```

If you use `npx`, run the Quick Start command again to use the latest version.

## Troubleshooting

### Codex Is Unavailable or Requires Sign-In

Return to the model service connection screen and sign in again, or inspect the custom API under **Settings > Model service**. Custom services must support the Responses API and `GET /models`; make sure the base URL includes the correct API version path.

### The Browser Does Not Open

Confirm that the terminal shows `CodeAgent 已启动`, then open the access URL printed in the terminal.

### Startup or Local Data Checks Fail

Run the diagnostic command:

```bash
code-agent doctor
```

Use the failed checks shown in the terminal to resolve issues with Node.js, Codex, or local data.

### The Starting Port Is Already in Use

CodeAgent automatically increments the port until it finds an available one and prints the selected address. Use `code-agent start --port 4567` to begin searching from a different port.

## Help

- [Report an issue](https://github.com/BryanHoo/CodeAgent/issues)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
