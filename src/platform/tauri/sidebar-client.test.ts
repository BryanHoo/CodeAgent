import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, PendingRequest } from "@/protocol/index.js";

import { TauriSidebarClient, type InvokeImplementation } from "./sidebar-client.js";

describe("TauriSidebarClient", () => {
  it("maps sidebar reads and project creation to direct Tauri commands", async () => {
    const ensureRuntime = vi.fn(async () => undefined);
    const invoke = vi.fn(async (command: string) => {
      if (command === "list_projects") return { data: [], nextCursor: null };
      if (command === "list_tasks") return { data: [], nextCursor: null };
      return {
        project: {
          createdAt: "2025-01-01T00:00:00Z",
          id: "project-a",
          name: "a",
          roots: [{ id: "root-a", path: "/work/a" }],
        },
      };
    });
    const client = new TauriSidebarClient({
      ensureRuntime,
      invoke: invoke as InvokeImplementation,
    });

    await client.listProjects();
    await client.listTasks("project-a", {
      archived: true,
      cursor: "cursor-a",
      limit: 20,
      pinned: true,
      searchTerm: "fix",
    });
    await client.addProject(["/work/a", "/work/shared"]);

    expect(ensureRuntime).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenNthCalledWith(1, "list_projects");
    expect(invoke).toHaveBeenNthCalledWith(2, "list_tasks", {
      input: {
        archived: true,
        cursor: "cursor-a",
        limit: 20,
        pinned: true,
        projectId: "project-a",
        searchTerm: "fix",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "add_project", {
      rootPaths: ["/work/a", "/work/shared"],
    });
  });

  it("returns the snapshot produced by the Rust read_task command", async () => {
    const snapshot = {
      checkpoint: { sequence: 7, sessionId: "runtime-a" },
      snapshot: {
        contextUsage: null,
        goal: null,
        id: "thread-a",
        pendingRequests: [],
        pinned: false,
        plan: null,
        projectId: "project-a",
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        status: "idle",
        title: "真实会话",
        turns: [],
        turnsNextCursor: null,
        updatedAt: "2025-01-01T00:00:00Z",
      },
    } as const;
    const invoke = vi.fn(async () => snapshot);
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.readTask("project-a", "thread-a")).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledWith("read_task", {
      cursor: null,
      projectId: "project-a",
      taskId: "thread-a",
    });
  });

  it("routes task and turn lifecycle mutations through Tauri", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "start_task") {
        return { task: { id: "thread-a" } };
      }
      if (command === "start_turn") {
        return { checkpoint: { sequence: 2, sessionId: "runtime-a" }, taskId: "thread-a" };
      }
      if (command === "unsubscribe_task") {
        return { status: "unsubscribed", taskId: "thread-a" };
      }
      return { status: command === "steer_turn" ? "accepted" : "interrupting" };
    });
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const input = { attachments: [], skills: [], text: "修复测试", type: "prompt" as const };
    const options = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;

    await client.startTask("project-a");
    await client.startTurn("project-a", "thread-a", input, options, {
      threadAlreadyLoaded: true,
    });
    await client.steerTurn("project-a", "thread-a", "turn-a", input);
    await client.interruptTurn("project-a", "thread-a", "turn-a");
    await expect(client.unsubscribeTask("project-a", "thread-a")).resolves.toEqual({
      status: "unsubscribed",
      taskId: "thread-a",
    });

    expect(invoke).toHaveBeenNthCalledWith(1, "start_task", { projectId: "project-a" });
    expect(invoke).toHaveBeenNthCalledWith(2, "start_turn", {
      input,
      options,
      projectId: "project-a",
      resumeTask: false,
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "steer_turn", {
      input,
      projectId: "project-a",
      taskId: "thread-a",
      turnId: "turn-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "interrupt_turn", {
      taskId: "thread-a",
      turnId: "turn-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "unsubscribe_task", {
      projectId: "project-a",
      taskId: "thread-a",
    });

    await expect(client.getCapabilities()).resolves.toMatchObject({
      tasks: { start: true },
      turns: { interrupt: true, start: true, steer: true },
    });
  });

  it("routes queued submissions through native Tauri commands", async () => {
    const invoke = vi.fn(async () => ({ data: [], nextCursor: null }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const input = { attachments: [], skills: [], text: "继续修复", type: "prompt" as const };

    await client.listQueuedSubmissions("project-a", "thread-a", { cursor: "next-a", limit: 20 });
    await client.addQueuedSubmission("project-a", "thread-a", input, "message-a");
    await client.updateQueuedSubmission(
      "project-a",
      "thread-a",
      "queue-a",
      input,
      "editing",
    );
    await client.deleteQueuedSubmission("project-a", "thread-a", "queue-a");
    await client.reorderQueuedSubmissions("project-a", "thread-a", ["queue-b", "queue-a"]);
    await client.startQueuedSubmission("project-a", "thread-a", "queue-a");

    expect(invoke).toHaveBeenNthCalledWith(1, "list_queued_submissions", {
      cursor: "next-a",
      limit: 20,
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "add_queued_submission", {
      clientUserMessageId: "message-a",
      input,
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "update_queued_submission", {
      input,
      projectId: "project-a",
      queuedSubmissionId: "queue-a",
      status: "editing",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "delete_queued_submission", {
      projectId: "project-a",
      queuedSubmissionId: "queue-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "reorder_queued_submissions", {
      projectId: "project-a",
      queuedSubmissionIds: ["queue-b", "queue-a"],
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "start_queued_submission", {
      projectId: "project-a",
      queuedSubmissionId: "queue-a",
      taskId: "thread-a",
    });
  });

  it("replays buffered Tauri events only to their owning project", async () => {
    let emit: ((event: AgentEvent) => void) | undefined;
    const subscribeAgentEvents = vi.fn(
      (options: Readonly<{ afterSequence: number; onEvent: (event: AgentEvent) => void }>) => {
        emit = options.onEvent;
        return () => undefined;
      },
    );
    const invoke = vi.fn(async () => ({
      data: [
        {
          id: "thread-a",
          pinned: false,
          projectId: "project-a",
          title: "任务",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
      nextCursor: null,
    }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
      subscribeAgentEvents,
    });
    await client.listTasks("project-a");
    const onEvent = vi.fn();
    const cleanup = client.subscribeEvents({
      afterSequence: 2,
      onEvent,
      onResyncRequired: vi.fn(),
      projectId: "project-a",
      sessionId: "codeagent-runtime",
    });
    const event = {
      itemId: "item-a",
      payload: { delta: "ok" },
      provider: "codex",
      sequence: 3,
      sessionId: "codeagent-runtime",
      taskId: "thread-a",
      timestamp: "2025-01-01T00:00:00Z",
      turnId: "turn-a",
      type: "message.delta",
      version: 2,
    } as AgentEvent;
    emit?.(event);
    emit?.({ ...event, sequence: 4, taskId: "thread-b" });

    expect(subscribeAgentEvents).toHaveBeenCalledWith(
      expect.objectContaining({ afterSequence: 2 }),
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(event);
    cleanup();
  });

  it("resolves app-server approvals through the Tauri command", async () => {
    const request: PendingRequest = {
      additionalPermissions: null,
      availableDecisions: ["allow", "deny"],
      command: "pnpm check",
      createdAt: "2025-01-01T00:00:00Z",
      cwd: "/work/a",
      expiresAt: null,
      itemId: "item-a",
      networkAccess: null,
      projectId: "project-a",
      reason: null,
      requestId: "number:9",
      status: "pending",
      taskId: "thread-a",
      turnId: "turn-a",
      type: "command_approval",
    };
    const response = { request: { ...request, status: "resolved" as const } };
    const invoke = vi.fn(async () => response);
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.resolvePendingRequest(request, { decision: "allow" })).resolves.toEqual(
      response,
    );
    expect(invoke).toHaveBeenCalledWith("resolve_pending_request", {
      requestId: "number:9",
      resolution: { decision: "allow" },
    });
  });

  it("routes review, compact, and fork through native Tauri commands", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "compact_task") return { status: "compacting", taskId: "thread-a" };
      if (command === "fork_task") {
        return {
          task: {
            id: "thread-b",
            pinned: false,
            projectId: "project-a",
            title: "分支任务",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        };
      }
      return {
        taskId: "thread-a",
        turn: {
          completedAt: null,
          error: null,
          id: "review-a",
          items: [],
          startedAt: "2025-01-01T00:00:00Z",
          status: "running",
        },
      };
    });
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await client.startReview("project-a", "thread-a", {
      target: { type: "uncommitted_changes" },
    });
    await client.compactTask("project-a", "thread-a");
    await client.forkTask("project-a", "thread-a", { lastTurnId: "turn-a" });
    const settings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;
    await client.getTaskSettings("project-a", "thread-a");
    await client.updateTaskSettings("project-a", "thread-a", settings);
    await client.updateTaskGoal("project-a", "thread-a", { status: "paused" });
    await client.clearTaskGoal("project-a", "thread-a");
    await client.listBackgroundTerminals("project-a", "thread-a");
    await client.terminateBackgroundTerminal("project-a", "thread-a", "42");

    expect(invoke).toHaveBeenNthCalledWith(1, "start_review", {
      input: { target: { type: "uncommitted_changes" } },
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "compact_task", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "fork_task", {
      lastTurnId: "turn-a",
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "get_task_settings", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "update_task_settings", {
      projectId: "project-a",
      settings,
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "update_task_goal", {
      projectId: "project-a",
      status: "paused",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(7, "clear_task_goal", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(8, "list_background_terminals", {
      projectId: "project-a",
      taskId: "thread-a",
    });
    expect(invoke).toHaveBeenNthCalledWith(9, "terminate_background_terminal", {
      projectId: "project-a",
      taskId: "thread-a",
      terminalId: "42",
    });
    await expect(client.getCapabilities()).resolves.toMatchObject({
      goals: { clear: true, read: true, update: true },
    });
  });

  it("routes catalogs, settings, authentication, skills, and MCP through Tauri", async () => {
    const invoke = vi.fn(async () => ({}));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });
    const settings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      commitMessageModel: "gpt-5.6-luna",
      commitMessagePrompt: "",
      defaultOpenAppId: null,
      fastMode: false,
      followUpBehavior: "queue",
      model: "gpt-5.6-sol",
      pet: { enabled: false, selectedPetId: null },
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    } as const;

    await client.listModels();
    await client.getProviderConnection();
    await client.startOfficialProviderLogin();
    await client.cancelProviderLogin("login-a");
    await client.configureCustomProvider({ baseUrl: "https://api.example/v1" });
    await client.logoutProvider();
    await client.getGlobalSettings();
    await client.updateGlobalSettings(settings);
    await client.listSkills("project-a");
    await client.listMcpServers("project-a", "thread-a");
    await client.retryMcpServers("project-a", "thread-a");

    expect(invoke.mock.calls).toEqual([
      ["list_models"],
      ["get_provider_connection"],
      ["start_official_provider_login"],
      ["cancel_provider_login", { loginId: "login-a" }],
      ["configure_custom_provider", { input: { baseUrl: "https://api.example/v1" } }],
      ["logout_provider"],
      ["get_global_settings"],
      ["update_global_settings", { settings }],
      ["list_skills", { forceReload: false, projectId: "project-a" }],
      ["list_mcp_servers", { projectId: "project-a", taskId: "thread-a" }],
      ["retry_mcp_servers", { projectId: "project-a", taskId: "thread-a" }],
    ]);
  });

  it("routes native Codex feedback and advertises the capability", async () => {
    const invoke = vi.fn(async () => ({ status: "sent", taskId: "thread-a" }));
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(
      client.uploadFeedback("project-a", "thread-a", {
        classification: "bug",
        includeLogs: true,
        reason: "时间线未刷新",
      }),
    ).resolves.toEqual({ status: "sent", taskId: "thread-a" });
    await expect(client.getCapabilities()).resolves.toMatchObject({ feedback: { upload: true } });
    expect(invoke).toHaveBeenCalledWith("upload_feedback", {
      input: { classification: "bug", includeLogs: true, reason: "时间线未刷新" },
      projectId: "project-a",
      taskId: "thread-a",
    });
  });

  it("reads application and verified Codex versions from Rust", async () => {
    const appInfo = {
      appVersion: "0.1.0",
      codexVersion: "0.151.0",
      latestVersion: null,
      releaseNotes: null,
      status: "current" as const,
      updateAvailable: false,
    };
    const invoke = vi.fn(async () => appInfo);
    const client = new TauriSidebarClient({
      ensureRuntime: vi.fn(async () => undefined),
      invoke: invoke as InvokeImplementation,
    });

    await expect(client.getAppInfo()).resolves.toEqual(appInfo);
    expect(invoke).toHaveBeenCalledWith("get_app_info");
  });
});
