import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
  AgentAttachmentSchema,
  AgentAttachmentUploadResponseSchema,
  AgentCapabilitiesSchema,
  AgentGlobalSettingsResponseSchema,
  AgentGlobalSettingsSchema,
  AgentModelPageSchema,
  AgentMessageItemSchema,
  AgentMcpServerPageSchema,
  AgentReviewItemSchema,
  AgentProjectDefaultsResponseSchema,
  AgentProjectDefaultsSchema,
  AgentPromptInputSchema,
  AddAgentQueuedSubmissionRequestSchema,
  AgentQueuedSubmissionPageSchema,
  ReorderAgentQueuedSubmissionsRequestSchema,
  StartAgentQueuedSubmissionResponseSchema,
  UpdateAgentQueuedSubmissionRequestSchema,
  AgentSkillPageSchema,
  AgentMutationErrorSchema,
  CommitProjectChangesRequestSchema,
  CommitProjectChangesResponseSchema,
  AgentTaskPageSchema,
  AgentTaskSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSettingsSchema,
  AgentTurnOptionsSchema,
  AddProjectRequestSchema,
  AddProjectResponseSchema,
  ArchiveAgentTaskRequestSchema,
  ArchiveAgentTaskResponseSchema,
  AgentTaskSnapshotSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  MAX_AGENT_TEXT_BYTES,
  PendingRequestSchema,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  SteerAgentTurnRequestSchema,
  SteerAgentTurnResponseSchema,
  TEMPORARY_TASK_API_PATH,
  TEMPORARY_TASK_SCOPE_ID,
  HealthResponseSchema,
  CreateProjectWorktreeRequestSchema,
  CreateProjectBranchRequestSchema,
  GenerateCommitMessageRequestSchema,
  GenerateCommitMessageResponseSchema,
  HostFileListingSchema,
  HostFileQuerySchema,
  ImportHostAttachmentRequestSchema,
  ProjectPageSchema,
  ProjectDirectoryListingSchema,
  ProjectDirectoryQuerySchema,
  ProjectFileTreeQuerySchema,
  ProjectFileSearchPageSchema,
  ProjectFileSearchQuerySchema,
  ProjectGitHistoryPageSchema,
  ProjectGitHistoryQuerySchema,
  ProjectGitCommitFileDiffQuerySchema,
  ProjectGitCommitFileDiffSchema,
  ProjectGitCommitFilesPageSchema,
  ProjectGitCommitFilesQuerySchema,
  ProjectGitStatusQuerySchema,
  ProjectGitStatusSchema,
  ProjectGitWorktreePageSchema,
  ProjectWorktreeMutationResponseSchema,
  SwitchProjectBranchRequestSchema,
  SwitchProjectWorktreeRequestSchema,
  ProjectFileTreeSchema,
  ProjectSourceFileQuerySchema,
  ProjectOpenAppSchema,
  ProjectOpenCapabilitiesResponseSchema,
  OpenProjectRequestSchema,
  OpenProjectResponseSchema,
  OpenAgentTaskAttachmentRequestSchema,
  OpenAgentTaskAttachmentResponseSchema,
  ProjectSourceFileSchema,
  ProjectSchema,
  PinAgentTaskRequestSchema,
  PinAgentTaskResponseSchema,
  CompactAgentTaskRequestSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskRequestSchema,
  ForkAgentTaskResponseSchema,
  ReviewAgentTaskRequestSchema,
  ReviewAgentTaskResponseSchema,
  RenameAgentTaskRequestSchema,
  RenameAgentTaskResponseSchema,
  RenameProjectRequestSchema,
  RenameProjectResponseSchema,
  ReorderProjectsRequestSchema,
  ReorderProjectsResponseSchema,
  RemoveProjectRequestSchema,
  RemoveProjectResponseSchema,
  UploadAgentFeedbackRequestSchema,
  UploadAgentFeedbackResponseSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
  ReloadAgentMcpServersRequestSchema,
  ReloadAgentMcpServersResponseSchema,
} from "./project.js";

describe("project protocol", () => {
  const rootPath = "/workspace/CodeAgent";
  it("validates the complete task queue contract", () => {
    const input = { attachments: [], skills: [], text: "继续实现", type: "prompt" } as const;
    const queuedSubmission = {
      attachments: [],
      clientUserMessageId: "client-message-1",
      id: "queue-1",
      skills: [],
      text: "继续实现",
    };

    expect(
      Value.Check(AddAgentQueuedSubmissionRequestSchema, {
        clientUserMessageId: "client-message-1",
        input,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentQueuedSubmissionPageSchema, {
        data: [queuedSubmission],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(Value.Check(UpdateAgentQueuedSubmissionRequestSchema, { input })).toBe(true);
    expect(
      Value.Check(ReorderAgentQueuedSubmissionsRequestSchema, {
        queuedSubmissionIds: ["queue-2", "queue-1"],
      }),
    ).toBe(true);
    expect(
      Value.Check(ReorderAgentQueuedSubmissionsRequestSchema, {
        queuedSubmissionIds: ["queue-1", "queue-1"],
      }),
    ).toBe(false);
    expect(
      Value.Check(StartAgentQueuedSubmissionResponseSchema, {
        taskId: "task-1",
        turn: {
          completedAt: null,
          error: null,
          id: "turn-2",
          items: [],
          startedAt: null,
          status: "running",
        },
      }),
    ).toBe(true);
  });

  it("defines a stable public scope for temporary tasks", () => {
    expect(TEMPORARY_TASK_SCOPE_ID).toBe("temporary");
    expect(TEMPORARY_TASK_API_PATH).toBe("/v1/temporary");
  });

  it("requires ordered absolute roots when adding a project", () => {
    const project = {
      createdAt: "2026-07-25T00:00:00.000Z",
      id: "code-agent",
      name: "CodeAgent",
      roots: [{ path: "/workspace/CodeAgent" }, { path: "/workspace/superwork" }],
    };

    expect(Value.Check(AddProjectRequestSchema, { roots: project.roots })).toBe(true);
    expect(Value.Check(AddProjectRequestSchema, { roots: [] })).toBe(false);
    expect(Value.Check(AddProjectRequestSchema, { roots: [{ path: "workspace/CodeAgent" }] })).toBe(
      false,
    );
    expect(Value.Check(AddProjectResponseSchema, { project })).toBe(true);
    expect(Value.Check(AddProjectResponseSchema, { project: null })).toBe(false);
  });

  it("validates host directory queries and listings", () => {
    expect(Value.Check(ProjectDirectoryQuerySchema, {})).toBe(true);
    expect(Value.Check(ProjectDirectoryQuerySchema, { path: "/Users/bryan/Develop" })).toBe(true);
    expect(
      Value.Check(ProjectDirectoryQuerySchema, {
        includeHidden: true,
        path: "/Users/bryan/Develop",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectDirectoryQuerySchema, {
        includeHidden: "true",
        path: "/Users/bryan/Develop",
      }),
    ).toBe(false);
    expect(Value.Check(ProjectDirectoryQuerySchema, { path: "C:\\Users\\bryan\\Develop" })).toBe(
      true,
    );
    expect(Value.Check(ProjectDirectoryQuerySchema, { path: "relative/project" })).toBe(false);
    expect(
      Value.Check(ProjectDirectoryListingSchema, {
        entries: [
          { name: "CodeAgent", path: "/Users/bryan/Develop/CodeAgent" },
          { name: "superwork", path: "/Users/bryan/Develop/superwork" },
        ],
        parentPath: "/Users/bryan",
        path: "/Users/bryan/Develop",
        roots: [{ name: "C:", path: "C:\\" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectDirectoryListingSchema, {
        entries: [],
        parentPath: null,
        path: "C:\\",
      }),
    ).toBe(false);
  });

  it("validates host attachment file queries, listings, and imports", () => {
    expect(Value.Check(HostFileQuerySchema, { kind: "image" })).toBe(true);
    expect(
      Value.Check(HostFileQuerySchema, {
        includeHidden: true,
        kind: "file",
        path: "C:\\Users\\bryan\\Documents",
      }),
    ).toBe(true);
    expect(Value.Check(HostFileQuerySchema, { includeHidden: "true", kind: "file" })).toBe(false);
    expect(Value.Check(HostFileQuerySchema, { kind: "text" })).toBe(false);
    expect(Value.Check(HostFileQuerySchema, { kind: "file", path: "relative/path" })).toBe(false);
    expect(Value.Check(HostFileQuerySchema, { extra: true, kind: "file" })).toBe(false);

    expect(
      Value.Check(HostFileListingSchema, {
        entries: [
          { name: "design", path: "/Users/bryan/design", type: "directory" },
          { name: "screen.png", path: "/Users/bryan/screen.png", type: "file" },
        ],
        parentPath: "/Users",
        path: "/Users/bryan",
        roots: [
          { name: "C:", path: "C:\\" },
          { name: "D:", path: "D:\\" },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(HostFileListingSchema, {
        entries: [{ name: "screen.png", path: "relative/screen.png", type: "file" }],
        parentPath: null,
        path: "/",
      }),
    ).toBe(false);

    expect(
      Value.Check(ImportHostAttachmentRequestSchema, { path: "/Users/bryan/screen.png" }),
    ).toBe(true);
    expect(Value.Check(ImportHostAttachmentRequestSchema, { path: "screen.png" })).toBe(false);
    expect(
      Value.Check(ImportHostAttachmentRequestSchema, {
        extra: true,
        path: "/Users/bryan/screen.png",
      }),
    ).toBe(false);
  });

  it("defines a public project with ordered roots", () => {
    expect(ProjectSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        createdAt: { format: "date-time", type: "string" },
        id: { minLength: 1, type: "string" },
        name: { minLength: 1, type: "string" },
        roots: { minItems: 1, type: "array", uniqueItems: true },
      },
      type: "object",
    });
    expect(ProjectSchema.required).toEqual(["createdAt", "id", "name", "roots"]);
  });

  it("requires a complete non-duplicated project order", () => {
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["superwork", "code-agent"],
      }),
    ).toBe(true);
    expect(Value.Check(ReorderProjectsRequestSchema, { projectIds: [] })).toBe(false);
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["code-agent", "code-agent"],
      }),
    ).toBe(false);
    expect(
      Value.Check(ReorderProjectsRequestSchema, {
        projectIds: ["code-agent"],
        staleOrder: true,
      }),
    ).toBe(false);
    expect(
      Value.Check(ReorderProjectsResponseSchema, {
        data: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            roots: [{ path: "/workspace/CodeAgent" }],
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
  });

  it("strictly validates project display-name and removal mutations", () => {
    expect(Value.Check(RenameProjectRequestSchema, { name: "工作区别名" })).toBe(true);
    expect(Value.Check(RenameProjectRequestSchema, { name: "   " })).toBe(false);
    expect(Value.Check(RenameProjectRequestSchema, { name: "x".repeat(201) })).toBe(false);
    expect(
      Value.Check(RenameProjectResponseSchema, {
        project: {
          createdAt: "2026-07-25T00:00:00.000Z",
          id: "code-agent",
          name: "工作区别名",
          roots: [{ path: "/workspace/CodeAgent" }],
        },
      }),
    ).toBe(true);
    expect(Value.Check(RemoveProjectRequestSchema, {})).toBe(true);
    expect(Value.Check(RemoveProjectRequestSchema, { removeFromDisk: true })).toBe(false);
    expect(
      Value.Check(RemoveProjectResponseSchema, {
        projectId: "code-agent",
        status: "removed",
      }),
    ).toBe(true);
  });

  it("strictly validates the supported project open app catalog", () => {
    expect(
      Value.Check(ProjectOpenCapabilitiesResponseSchema, {
        apps: [
          { id: "zed", kind: "editor", name: "Zed" },
          { id: "system-default", kind: "system-default", name: "系统默认应用" },
          { id: "finder", kind: "file-manager", name: "Finder" },
          { id: "ghostty", kind: "terminal", name: "Ghostty" },
        ],
        platform: "darwin",
      }),
    ).toBe(true);
    expect(Value.Check(ProjectOpenAppSchema, { id: "zed", kind: "editor" })).toBe(false);
    expect(Value.Check(OpenProjectRequestSchema, { appId: "zed" })).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, { appId: "system-default", path: "README.md" }),
    ).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, {
        appId: "system-default",
        path: "/workspace/CodeAgent/report.docx",
      }),
    ).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, {
        appId: "system-default",
        path: "C:\\workspace\\CodeAgent\\slides.pptx",
      }),
    ).toBe(true);
    expect(
      Value.Check(OpenProjectRequestSchema, { appId: "zed", path: "src/components/app.tsx" }),
    ).toBe(true);
    expect(Value.Check(OpenProjectRequestSchema, { appId: "custom-command" })).toBe(false);
    for (const path of ["", "bad\npath.doc", "bad\0path.doc"]) {
      expect(Value.Check(OpenProjectRequestSchema, { appId: "finder", path })).toBe(false);
    }
    expect(Value.Check(OpenProjectResponseSchema, { appId: "ghostty" })).toBe(true);
    expect(
      Value.Check(OpenProjectResponseSchema, { appId: "ghostty", path: "src/components" }),
    ).toBe(true);
    expect(
      Value.Check(ProjectOpenCapabilitiesResponseSchema, {
        platform: "darwin",
        targets: ["folder", "vscode", "terminal"],
      }),
    ).toBe(false);
  });

  it("strictly validates selected-file commit generation and mutation contracts", () => {
    const snapshot = "a".repeat(64);
    const paths = ["packages/server/src/app.ts", "apps/web/src/app.tsx"];

    expect(
      Value.Check(GenerateCommitMessageRequestSchema, {
        expectedSnapshot: snapshot,
        paths,
        repository: "frontend",
      }),
    ).toBe(true);
    expect(
      Value.Check(GenerateCommitMessageResponseSchema, {
        message: "feat(git): 添加选择文件提交",
        snapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(CommitProjectChangesRequestSchema, {
        action: "commit_and_push",
        expectedSnapshot: snapshot,
        message: "feat(git): 添加选择文件提交",
        paths,
        repository: "frontend",
      }),
    ).toBe(true);
    expect(
      Value.Check(CommitProjectChangesResponseSchema, {
        branch: "feat/commit",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: "feat(git): 添加选择文件提交",
        pushError: null,
        pushStatus: "pushed",
      }),
    ).toBe(true);

    for (const invalidPaths of [
      [],
      ["src/app.ts", "src/app.ts"],
      ["../secret"],
      ["/tmp/secret"],
      ["src\\app.ts"],
    ]) {
      expect(
        Value.Check(GenerateCommitMessageRequestSchema, {
          expectedSnapshot: snapshot,
          paths: invalidPaths,
        }),
      ).toBe(false);
    }
    expect(
      Value.Check(CommitProjectChangesRequestSchema, {
        action: "commit",
        expectedSnapshot: "stale",
        message: "   ",
        paths,
      }),
    ).toBe(false);
    expect(
      Value.Check(CommitProjectChangesResponseSchema, {
        branch: null,
        commitSha: "not-a-sha",
        message: "fix(git): 修复提交",
        pushError: null,
        pushStatus: "unknown",
      }),
    ).toBe(false);
    expect(
      Value.Check(GenerateCommitMessageRequestSchema, {
        expectedSnapshot: snapshot,
        paths,
        repository: "../server",
      }),
    ).toBe(false);
    expect(
      Value.Check(GenerateCommitMessageRequestSchema, {
        expectedSnapshot: snapshot,
        paths,
        repository: "packages/server",
      }),
    ).toBe(false);
  });

  it("strictly validates branch-switch mutations", () => {
    const expectedSnapshot = "a".repeat(64);

    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "feat/branch-switching",
        expectedSnapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "main",
        command: "reset --hard",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(
      Value.Check(SwitchProjectBranchRequestSchema, {
        branch: "main",
        expectedSnapshot: "stale",
      }),
    ).toBe(false);
  });

  it("strictly validates branch-creation mutations", () => {
    const expectedSnapshot = "a".repeat(64);

    expect(
      Value.Check(CreateProjectBranchRequestSchema, {
        branch: "feat/create-branch",
        expectedSnapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateProjectBranchRequestSchema, {
        branch: "",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(
      Value.Check(CreateProjectBranchRequestSchema, {
        branch: "feat/create-branch",
        command: "checkout -B main",
        expectedSnapshot,
      }),
    ).toBe(false);
  });

  it("strictly validates project worktree queries and mutations", () => {
    const expectedSnapshot = "a".repeat(64);
    const worktree = {
      branch: "feat/worktree",
      current: false,
      path: "/workspace/CodeAgent-feat-worktree",
    };
    const project = {
      createdAt: "2026-08-18T00:00:00.000Z",
      id: "code-agent-feat-worktree",
      name: "CodeAgent-feat-worktree",
      roots: [{ path: worktree.path }],
    };

    expect(Value.Check(ProjectGitWorktreePageSchema, { worktrees: [worktree] })).toBe(true);
    expect(
      Value.Check(ProjectGitWorktreePageSchema, {
        worktrees: [{ ...worktree, command: "status" }],
      }),
    ).toBe(false);
    expect(
      Value.Check(CreateProjectWorktreeRequestSchema, {
        branch: worktree.branch,
        expectedSnapshot,
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateProjectWorktreeRequestSchema, {
        branch: "",
        expectedSnapshot,
      }),
    ).toBe(false);
    expect(Value.Check(SwitchProjectWorktreeRequestSchema, { path: worktree.path })).toBe(true);
    expect(Value.Check(SwitchProjectWorktreeRequestSchema, { path: "relative/path" })).toBe(false);
    expect(Value.Check(ProjectWorktreeMutationResponseSchema, { project, worktree })).toBe(true);
    expect(
      Value.Check(ProjectWorktreeMutationResponseSchema, {
        project,
        worktree: { ...worktree, path: "relative/path" },
      }),
    ).toBe(false);
  });

  it("scopes every task to a project and records its pinned state", () => {
    expect(AgentTaskSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { minLength: 1, type: "string" },
        pinned: { type: "boolean" },
        projectId: { minLength: 1, type: "string" },
        title: { minLength: 1, type: "string" },
        updatedAt: { format: "date-time", type: "string" },
      },
      type: "object",
    });
    expect(AgentTaskSchema.required).toEqual(["id", "pinned", "projectId", "title", "updatedAt"]);
  });

  it("carries bounded attachment metadata without snapshot content", () => {
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            id: "attachment-history-1",
            kind: "image",
            mediaType: "image/png",
            name: "diagram.png",
            size: 68,
          },
        ],
        id: "message-image",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            id: "attachment-history-text",
            kind: "text",
            mediaType: "text/plain",
            name: "Pasted text.txt",
            size: 1_001,
          },
        ],
        id: "message-text-attachment",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        attachments: [
          {
            mediaType: "image/png",
            name: "diagram.png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
        id: "message-image",
        role: "user",
        text: "",
        type: "message",
      }),
    ).toBe(false);
  });

  it("validates task attachment system-open requests without exposing host paths", () => {
    expect(Value.Check(OpenAgentTaskAttachmentRequestSchema, {})).toBe(true);
    expect(Value.Check(OpenAgentTaskAttachmentRequestSchema, { path: "/tmp/report.pdf" })).toBe(
      false,
    );
    expect(
      Value.Check(OpenAgentTaskAttachmentResponseSchema, {
        attachmentId: "attachment-1",
        status: "opened",
      }),
    ).toBe(true);
    expect(
      Value.Check(OpenAgentTaskAttachmentResponseSchema, {
        attachmentId: "attachment-1",
        path: "/tmp/report.pdf",
        status: "opened",
      }),
    ).toBe(false);
  });

  it("accepts only documented phases on assistant messages", () => {
    expect(
      Value.Check(AgentMessageItemSchema, {
        id: "message-commentary",
        phase: "commentary",
        role: "assistant",
        text: "正在检查。",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        id: "message-final",
        phase: "final_answer",
        role: "assistant",
        text: "检查完成。",
        type: "message",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        id: "message-invalid",
        phase: "analysis",
        role: "assistant",
        text: "不可见阶段。",
        type: "message",
      }),
    ).toBe(false);
  });

  it("validates paginated projects and tasks", () => {
    expect(
      Value.Check(ProjectPageSchema, {
        data: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            id: "code-agent",
            name: "CodeAgent",
            roots: [{ path: "/workspace/CodeAgent" }],
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentTaskPageSchema, {
        data: [
          {
            id: "task-1",
            pinned: false,
            projectId: "code-agent",
            title: "实现真实任务历史",
            updatedAt: "2026-07-23T00:00:00.000Z",
          },
        ],
        nextCursor: "next-page",
      }),
    ).toBe(true);
  });

  it("describes Git branches with staged and unstaged file changes", () => {
    const fileChange = {
      diff: "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new",
      kind: "update",
      path: "src/index.ts",
    };

    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: ["origin/main", "main"],
        branch: "feat/review",
        branches: ["feat/review", "main"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [fileChange],
        unstaged: [{ ...fileChange, path: "README.md" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: [],
        branch: null,
        branches: [],
        repositoryMode: "none",
        snapshot: "b".repeat(64),
        staged: [],
        unstaged: [],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        staged: [],
        unstaged: [],
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: ["origin/main", "origin/main"],
        branch: null,
        branches: [],
        repositoryMode: "children",
        snapshot: "a".repeat(64),
        staged: [],
        unstaged: [],
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitStatusSchema, {
        baseBranches: ["main"],
        branch: "feat/review",
        branches: ["feat/review", "main"],
        repositoryMode: "root",
        snapshot: "a".repeat(64),
        staged: [{ ...fileChange, path: "/workspace/CodeAgent/src/index.ts" }],
        unstaged: [],
      }),
    ).toBe(false);
  });

  it("validates Git status detail and repository selectors", () => {
    expect(Value.Check(ProjectGitStatusQuerySchema, {})).toBe(false);
    expect(
      Value.Check(ProjectGitStatusQuerySchema, {
        includeDiff: true,
        repository: "frontend",
        rootPath,
      }),
    ).toBe(true);
    expect(Value.Check(ProjectGitStatusQuerySchema, { includeDiff: "true", rootPath })).toBe(false);
    expect(
      Value.Check(ProjectGitStatusQuerySchema, { repository: "packages/server", rootPath }),
    ).toBe(false);
    expect(Value.Check(ProjectGitStatusQuerySchema, { repository: "../server", rootPath })).toBe(
      false,
    );
  });

  it("strictly validates paginated Git history contracts", () => {
    const commit = {
      authoredAt: "2026-08-06T08:30:00+08:00",
      authorEmail: "developer@example.com",
      authorName: "Developer",
      sha: "a".repeat(40),
      title: "feat(git): 添加历史记录",
    };

    expect(Value.Check(ProjectGitHistoryQuerySchema, {})).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryQuerySchema, {
        cursor: "20",
        repository: "packages/server",
        rootPath,
      }),
    ).toBe(true);
    expect(Value.Check(ProjectGitHistoryQuerySchema, { cursor: "sha-20", rootPath })).toBe(false);
    expect(Value.Check(ProjectGitHistoryQuerySchema, { repository: "../server", rootPath })).toBe(
      false,
    );
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "feat/apps-web",
        commits: [commit, { ...commit, sha: "b".repeat(64) }],
        nextCursor: "20",
        repositories: ["apps/web", "packages/server"],
        repository: "apps/web",
        repositoryMode: "children",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "main",
        commits: [{ ...commit, sha: "not-a-sha" }],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "main",
        commits: [{ ...commit, authoredAt: "yesterday" }],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "release/server",
        commits: [commit],
        nextCursor: "next",
        repositories: ["packages/server"],
        repository: "packages/server",
        repositoryMode: "children",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: null,
        commits: [{ ...commit, body: "unexpected" }],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        branch: "main",
        commits: Array.from({ length: 21 }, (_, index) => ({
          ...commit,
          sha: index.toString(16).padStart(40, "0"),
        })),
        nextCursor: "20",
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitHistoryPageSchema, {
        commits: [commit],
        nextCursor: null,
        repositories: [],
        repository: null,
        repositoryMode: "root",
      }),
    ).toBe(false);
  });

  it("strictly validates bounded Git commit review contracts", () => {
    const sha = "a".repeat(40);
    expect(
      Value.Check(ProjectGitCommitFilesQuerySchema, {
        cursor: "100",
        repository: "packages/server",
        rootPath,
        sha,
      }),
    ).toBe(true);
    expect(Value.Check(ProjectGitCommitFilesQuerySchema, { rootPath, sha: "HEAD" })).toBe(false);
    expect(
      Value.Check(ProjectGitCommitFileDiffQuerySchema, {
        path: "src/index.ts",
        rootPath,
        sha,
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitCommitFileDiffQuerySchema, {
        path: "../secret.txt",
        rootPath,
        sha,
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitCommitFilesPageSchema, {
        files: Array.from({ length: 100 }, (_, index) => ({
          kind: "update",
          path: `src/file-${String(index)}.ts`,
        })),
        nextCursor: "100",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectGitCommitFilesPageSchema, {
        files: Array.from({ length: 101 }, (_, index) => ({
          kind: "update",
          path: `src/file-${String(index)}.ts`,
        })),
        nextCursor: null,
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectGitCommitFileDiffSchema, {
        diff: "@@ -1 +1 @@\n-old\n+new\n",
        truncated: true,
      }),
    ).toBe(true);
  });

  it("describes a paginated project source file preview", () => {
    expect(
      Value.Check(ProjectSourceFileQuerySchema, {
        cursor: 262_144,
        path: "docs/architecture-design.md",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectSourceFileQuerySchema, {
        cursor: -1,
        path: "docs/architecture-design.md",
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        nextCursor: 15,
        path: "docs/architecture-design.md",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        nextCursor: null,
        path: "/workspace/CodeAgent/docs/architecture-design.md",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectSourceFileSchema, {
        content: "# Architecture\n",
        path: "docs/architecture-design.md",
        truncated: true,
      }),
    ).toBe(false);
  });

  it("describes an unbounded project-relative directory listing", () => {
    expect(
      Value.Check(ProjectFileTreeSchema, {
        entries: Array.from({ length: 2_001 }, (_, index) => ({
          path: `src/file-${String(index)}.ts`,
          type: "file",
        })),
        path: "src",
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectFileTreeSchema, {
        entries: [{ path: "/workspace/CodeAgent/src", type: "directory" }],
        path: null,
      }),
    ).toBe(false);
    expect(
      Value.Check(ProjectFileTreeSchema, {
        entries: [{ extra: true, path: "src", type: "directory" }],
        path: null,
      }),
    ).toBe(false);
    expect(Value.Check(ProjectFileTreeSchema, { entries: [], path: null, truncated: false })).toBe(
      false,
    );
  });

  it("validates optional project-relative file tree directory queries", () => {
    expect(Value.Check(ProjectFileTreeQuerySchema, {})).toBe(true);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "src/components" })).toBe(true);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "/workspace/src" })).toBe(false);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "../src" })).toBe(false);
    expect(Value.Check(ProjectFileTreeQuerySchema, { path: "." })).toBe(false);
    expect(Value.Check(ProjectFileTreeQuerySchema, { extra: true })).toBe(false);
  });

  it("validates bounded project file searches and path text prompts", () => {
    expect(Value.Check(ProjectFileSearchQuerySchema, { query: "index" })).toBe(true);
    expect(Value.Check(ProjectFileSearchQuerySchema, { query: "x".repeat(257) })).toBe(false);
    expect(
      Value.Check(ProjectFileSearchPageSchema, {
        data: [{ name: "index.ts", path: "src/index.ts" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(ProjectFileSearchPageSchema, {
        data: [{ name: "outside.ts", path: "/tmp/outside.ts" }],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [],
        text: "@src/index.ts",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        fileReferences: [{ path: "src/index.ts" }],
        skills: [],
        text: "@src/index.ts",
        type: "prompt",
      }),
    ).toBe(false);
  });

  it("validates a structured task snapshot", () => {
    const snapshot = {
      contextUsage: null,
      id: "task-1",
      plan: {
        explanation: "按顺序执行并同步状态。",
        steps: [
          { status: "completed", text: "定义协议" },
          { status: "in_progress", text: "接入界面" },
          { status: "pending", text: "验证行为" },
        ],
      },
      pinned: false,
      pendingRequests: [],
      projectId: "code-agent",
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "idle",
      title: "实现真实任务历史",
      turns: [
        {
          completedAt: "2026-07-23T00:01:00.000Z",
          error: null,
          id: "turn-1",
          items: [
            { id: "item-1", role: "user", text: "读取真实历史", type: "message" },
            {
              content: "按统一边界实现",
              id: "item-2",
              summary: "分析协议",
              type: "reasoning",
            },
            {
              command: "pnpm check",
              cwd: "/workspace/CodeAgent",
              id: "item-3",
              output: "Done",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              changes: [
                {
                  diff: "+export {}",
                  kind: "update",
                  path: "/workspace/CodeAgent/src/index.ts",
                },
              ],
              id: "item-4",
              status: "completed",
              type: "file_change",
            },
            {
              id: "item-5",
              input: { path: "src/index.ts" },
              name: "read_file",
              status: "completed",
              type: "tool",
            },
            { id: "item-6", text: "1. 定义协议", type: "plan" },
            {
              detail: "上下文已压缩",
              id: "item-7",
              label: "压缩上下文",
              transient: true,
              type: "activity",
            },
          ],
          startedAt: "2026-07-23T00:00:00.000Z",
          status: "completed",
        },
      ],
      turnsNextCursor: null,
      updatedAt: "2026-07-23T00:01:00.000Z",
    };

    expect(Value.Check(AgentTaskSnapshotSchema, snapshot)).toBe(true);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [{ ...snapshot.turns[0], error: undefined }],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [
          {
            ...snapshot.turns[0],
            items: snapshot.turns[0]?.items.map((item) =>
              item.type === "command" ? { ...item, outputTruncated: undefined } : item,
            ),
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [{ ...snapshot.turns[0], status: "inProgress" }],
      }),
    ).toBe(false);
    expect(Value.Check(AgentTaskSnapshotSchema, { ...snapshot, nativeThread: {} })).toBe(false);
  });

  it("accepts user message skills without exposing native paths", () => {
    const message = {
      id: "message-1",
      role: "user",
      skills: [{ name: "review-security" }],
      text: "检查认证边界",
      type: "message",
    };

    expect(Value.Check(AgentMessageItemSchema, message)).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        ...message,
        skills: [{ name: "review-security", path: "/private/SKILL.md" }],
      }),
    ).toBe(false);
  });

  it("validates a structured review timeline item", () => {
    expect(
      Value.Check(AgentReviewItemSchema, {
        id: "review-turn-1",
        target: { type: "uncommitted_changes" },
        type: "review",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentReviewItemSchema, {
        id: "review-turn-1",
        target: { type: "base_branch" },
        type: "review",
      }),
    ).toBe(false);
  });

  it("validates strict project defaults and task settings", () => {
    const projectDefaults = {
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };
    const taskSettings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      ...projectDefaults,
    };

    expect(Value.Check(AgentProjectDefaultsSchema, projectDefaults)).toBe(true);
    expect(Value.Check(AgentProjectDefaultsResponseSchema, { settings: projectDefaults })).toBe(
      true,
    );
    expect(Value.Check(AgentTaskSettingsSchema, taskSettings)).toBe(true);
    expect(Value.Check(AgentTaskSettingsResponseSchema, { settings: taskSettings })).toBe(true);
    expect(
      Value.Check(AgentProjectDefaultsSchema, { ...projectDefaults, approvalPolicy: "never" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, approvalPolicy: "always" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, approvalsReviewer: "always" }),
    ).toBe(false);
    expect(Value.Check(AgentTaskSettingsSchema, { ...taskSettings, approvalPolicy: "never" })).toBe(
      false,
    );
    const settingsWithoutReviewer = {
      approvalPolicy: taskSettings.approvalPolicy,
      ...projectDefaults,
    };
    expect(Value.Check(AgentTaskSettingsSchema, settingsWithoutReviewer)).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, sandboxMode: "host-write" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, reasoningEffort: undefined }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsResponseSchema, { settings: taskSettings, legacy: true }),
    ).toBe(false);
  });

  it("validates strict global settings", () => {
    const settings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      commitMessageModel: "gpt-5.6-terra",
      commitMessagePrompt: "突出说明用户可见影响。",
      defaultOpenAppId: "visual-studio-code",
      fastMode: false,
      followUpBehavior: "queue",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };

    expect(Value.Check(AgentGlobalSettingsSchema, settings)).toBe(true);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, fastMode: true })).toBe(true);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, fastMode: "true" })).toBe(false);
    expect(Value.Check(AgentGlobalSettingsResponseSchema, { settings })).toBe(true);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, followUpBehavior: "steer" })).toBe(
      true,
    );
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, followUpBehavior: "later" })).toBe(
      false,
    );
    const settingsWithoutFollowUpBehavior = { ...settings };
    Reflect.deleteProperty(settingsWithoutFollowUpBehavior, "followUpBehavior");
    expect(Value.Check(AgentGlobalSettingsSchema, settingsWithoutFollowUpBehavior)).toBe(false);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, defaultOpenAppId: null })).toBe(
      true,
    );
    expect(
      Value.Check(AgentGlobalSettingsSchema, { ...settings, defaultOpenAppId: "system-default" }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, { ...settings, defaultOpenAppId: "unknown-app" }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
      }),
    ).toBe(false);
    expect(Value.Check(AgentGlobalSettingsResponseSchema, { settings, legacy: true })).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, { ...settings, commitMessageModel: undefined }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        commitMessageReasoningEffort: "medium",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        commitMessagePrompt: "x".repeat(4_001),
      }),
    ).toBe(false);
  });

  it("validates discriminated pending requests and typed resolutions", () => {
    const identity = {
      createdAt: "2026-07-23T00:00:00.000Z",
      expiresAt: null,
      itemId: "item-1",
      projectId: "code-agent",
      requestId: "number:7",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-1",
    } as const;
    const commandRequest = {
      ...identity,
      additionalPermissions: {
        fileSystem: {
          entries: [],
          globScanMaxDepth: null,
          read: ["/workspace/CodeAgent/src"],
          write: null,
        },
        network: { enabled: true },
      },
      availableDecisions: ["allow", "allow_for_session", "deny"],
      command: "pnpm check",
      cwd: "/workspace/CodeAgent",
      networkAccess: { host: "api.example.com", protocol: "https" },
      reason: "需要执行检查",
      type: "command_approval",
    } as const;
    const fileRequest = {
      ...identity,
      availableDecisions: ["allow", "deny"],
      grantRoot: "/workspace/CodeAgent",
      reason: null,
      requestId: "number:8",
      type: "file_change_approval",
    } as const;
    const inputRequest = {
      ...identity,
      questions: [
        {
          header: "执行模式",
          id: "mode",
          isOther: false,
          isSecret: false,
          options: [
            { description: "继续实现", label: "继续" },
            { description: "停止当前工作", label: "停止" },
          ],
          prompt: "下一步怎么处理？",
          type: "choice",
        },
      ],
      requestId: "string:input-1",
      type: "user_input",
    } as const;
    const permissionRequest = {
      ...identity,
      cwd: "/workspace/CodeAgent",
      environmentId: "local",
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { type: "glob", value: "/workspace/CodeAgent/*.log" },
            },
          ],
          globScanMaxDepth: 4,
          read: ["/workspace/CodeAgent/src"],
          write: ["/workspace/CodeAgent/.cache"],
        },
        network: { enabled: true },
      },
      reason: "需要安装依赖并写入缓存",
      requestId: "string:permissions-1",
      type: "permissions_approval",
    } as const;
    const elicitationRequest = {
      ...identity,
      fields: [
        {
          defaultValue: true,
          description: "允许工具继续执行",
          id: "confirmed",
          required: true,
          title: "确认",
          type: "boolean",
        },
      ],
      message: "Allow this request?",
      mode: "form",
      requestId: "string:elicitation-1",
      serverName: "example",
      type: "mcp_elicitation",
    } as const;

    expect(
      [commandRequest, fileRequest, inputRequest, permissionRequest, elicitationRequest].every(
        (request) => Value.Check(PendingRequestSchema, request),
      ),
    ).toBe(true);
    expect(
      Value.Check(PendingRequestSchema, {
        ...inputRequest,
        questions: [{ ...inputRequest.questions[0], options: [] }],
      }),
    ).toBe(false);
    expect(
      Value.Check(PendingRequestSchema, {
        ...inputRequest,
        questions: [
          {
            ...inputRequest.questions[0],
            isOther: true,
            type: "confirmation",
          },
        ],
      }),
    ).toBe(false);
    expect(Value.Check(PendingRequestSchema, { ...commandRequest, nativeRequestId: 7 })).toBe(
      false,
    );
    expect(
      Value.Check(PendingRequestSchema, {
        ...commandRequest,
        networkAccess: { host: "api.example.com", protocol: "ftp" },
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: commandRequest.itemId,
        projectId: commandRequest.projectId,
        resolution: { decision: "allow_for_session" },
        taskId: commandRequest.taskId,
        turnId: commandRequest.turnId,
        type: commandRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: permissionRequest.itemId,
        projectId: permissionRequest.projectId,
        resolution: { grantedPermissions: ["network"], scope: "session" },
        taskId: permissionRequest.taskId,
        turnId: permissionRequest.turnId,
        type: permissionRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: permissionRequest.itemId,
        projectId: permissionRequest.projectId,
        resolution: { grantedPermissions: ["network", "network"], scope: "turn" },
        taskId: permissionRequest.taskId,
        turnId: permissionRequest.turnId,
        type: permissionRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: elicitationRequest.itemId,
        projectId: elicitationRequest.projectId,
        resolution: { action: "accept", content: { confirmed: true } },
        taskId: elicitationRequest.taskId,
        turnId: elicitationRequest.turnId,
        type: elicitationRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: elicitationRequest.itemId,
        projectId: elicitationRequest.projectId,
        resolution: { action: "decline", content: null },
        taskId: elicitationRequest.taskId,
        turnId: elicitationRequest.turnId,
        type: elicitationRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: ["继续"] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: [""] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: ["继续", "停止"] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { decision: "allow" },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestResponseSchema, {
        request: { ...commandRequest, status: "resolved" },
      }),
    ).toBe(true);
  });

  it("validates health and capability responses", () => {
    expect(Value.Check(HealthResponseSchema, { status: "ok", version: 1 })).toBe(true);
    expect(
      Value.Check(AgentCapabilitiesSchema, {
        feedback: { upload: true },
        provider: "codex",
        skills: { list: true, use: true },
        tasks: { fork: true, list: true, read: true, start: true },
        turns: {
          compact: true,
          interrupt: true,
          review: true,
          start: true,
          steer: true,
        },
      }),
    ).toBe(true);
  });

  it("validates task command mutation contracts", () => {
    const task = {
      id: "task-2",
      pinned: false,
      projectId: "code-agent",
      title: "续接任务",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    const turn = {
      completedAt: null,
      error: null,
      id: "review-turn",
      items: [],
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running",
    };

    expect(
      Value.Check(ReviewAgentTaskRequestSchema, {
        target: { type: "base_branch", branch: "main" },
      }),
    ).toBe(true);
    expect(Value.Check(ReviewAgentTaskRequestSchema, { target: { type: "base_branch" } })).toBe(
      false,
    );
    expect(Value.Check(ReviewAgentTaskResponseSchema, { taskId: "task-1", turn })).toBe(true);
    expect(Value.Check(CompactAgentTaskRequestSchema, {})).toBe(true);
    expect(
      Value.Check(CompactAgentTaskResponseSchema, { status: "compacting", taskId: "task-1" }),
    ).toBe(true);
    expect(Value.Check(ForkAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(ForkAgentTaskRequestSchema, { lastTurnId: "turn-1" })).toBe(true);
    expect(Value.Check(ForkAgentTaskRequestSchema, { lastTurnId: "" })).toBe(false);
    expect(Value.Check(ForkAgentTaskResponseSchema, { task })).toBe(true);
    expect(Value.Check(PinAgentTaskRequestSchema, { pinned: true })).toBe(true);
    expect(Value.Check(PinAgentTaskRequestSchema, { pinned: true, taskId: "task-2" })).toBe(false);
    expect(Value.Check(PinAgentTaskResponseSchema, { task: { ...task, pinned: true } })).toBe(true);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "重命名任务" })).toBe(true);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "   " })).toBe(false);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "" })).toBe(false);
    expect(
      Value.Check(RenameAgentTaskResponseSchema, { task: { ...task, title: "重命名任务" } }),
    ).toBe(true);
    expect(Value.Check(ArchiveAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(ArchiveAgentTaskRequestSchema, { permanent: true })).toBe(false);
    expect(
      Value.Check(ArchiveAgentTaskResponseSchema, { status: "archived", taskId: "task-2" }),
    ).toBe(true);
    expect(
      Value.Check(UploadAgentFeedbackRequestSchema, {
        classification: "other",
        includeLogs: true,
        reason: "菜单操作不符合预期",
      }),
    ).toBe(true);
    expect(
      Value.Check(UploadAgentFeedbackResponseSchema, { status: "sent", taskId: "task-1" }),
    ).toBe(true);
  });

  it("validates structured Agent inputs and mutation contracts", () => {
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "code-agent",
      title: "实现写入闭环",
      updatedAt: "2026-07-23T00:00:00.000Z",
    };
    const turn = {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [],
      startedAt: "2026-07-23T00:00:00.000Z",
      status: "running",
    };

    const attachment = {
      id: "attachment-1",
      kind: "image",
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    };
    const prompt = {
      attachments: [{ id: attachment.id }],
      skills: [],
      text: "参考截图实现功能",
      type: "prompt",
    };

    expect(
      Value.Check(AgentSkillPageSchema, {
        data: [
          {
            description: "执行严格的安全审查",
            displayName: "Security review",
            id: "skill_01J00000000000000000000000",
            name: "review-security",
            scope: "system",
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMcpServerPageSchema, {
        data: [
          {
            authStatus: "unknown",
            description: "Search the current repository",
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "ready",
            title: "Fast Context",
            toolCount: 3,
            version: "1.2.0",
          },
          {
            authStatus: null,
            description: null,
            error: "MCP startup timed out after 10s",
            failureReason: null,
            name: "chrome-devtools",
            status: "failed",
            title: null,
            toolCount: 0,
            version: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMcpServerPageSchema, {
        data: [
          {
            authStatus: "unsupported",
            command: "npx",
            description: null,
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "ready",
            title: null,
            toolCount: 1,
            version: null,
          },
        ],
      }),
    ).toBe(false);
    expect(Value.Check(ReloadAgentMcpServersRequestSchema, {})).toBe(true);
    expect(
      Value.Check(ReloadAgentMcpServersResponseSchema, {
        data: [
          {
            authStatus: null,
            description: null,
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "starting",
            title: null,
            toolCount: 0,
            version: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMcpServerPageSchema, {
        data: [
          {
            authStatus: null,
            description: null,
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "unknown",
            title: null,
            toolCount: 0,
            version: null,
          },
        ],
      }),
    ).toBe(false);

    expect(
      Value.Check(AgentModelPageSchema, {
        data: [
          {
            defaultReasoningEffort: "high",
            description: "适合复杂编码任务",
            displayName: "GPT-5.6 Sol",
            id: "gpt-5.6-sol",
            isDefault: true,
            supportedReasoningEfforts: [
              { description: "快速回答", id: "low" },
              { description: "深入分析", id: "high" },
            ],
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(Value.Check(AgentAttachmentSchema, attachment)).toBe(true);
    expect(Value.Check(AgentAttachmentUploadResponseSchema, { attachment })).toBe(true);
    expect(Value.Check(AgentPromptInputSchema, prompt)).toBe(true);
    const planTurnOptions = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      collaborationMode: "plan",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };
    expect(Value.Check(AgentTurnOptionsSchema, planTurnOptions)).toBe(true);
    expect(Value.Check(AgentTaskSettingsSchema, planTurnOptions)).toBe(false);
    expect(Value.Check(AgentTurnOptionsSchema, { ...planTurnOptions, fastMode: true })).toBe(true);
    expect(Value.Check(AgentTurnOptionsSchema, { ...planTurnOptions, fastMode: false })).toBe(
      false,
    );
    const goalTurnOptions = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      goalMode: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };
    expect(Value.Check(AgentTurnOptionsSchema, goalTurnOptions)).toBe(true);
    expect(Value.Check(AgentTaskSettingsSchema, goalTurnOptions)).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [{ id: attachment.id }],
        skills: [],
        text: "",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [{ id: "skill_01J00000000000000000000000", name: "review-security" }],
        text: "",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [],
        text: "",
        type: "prompt",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [
          { id: "skill-1", name: "first" },
          { id: "skill-2", name: "second" },
        ],
        text: "run",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [{ id: "skill-1", name: "first", path: "/private/skill" }],
        text: "run",
        type: "prompt",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentAttachmentSchema, {
        id: "attachment-text",
        kind: "text",
        mediaType: "text/plain",
        name: "Pasted text.txt",
        size: 5,
      }),
    ).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, { nativeOptions: {} })).toBe(false);
    expect(Value.Check(StartAgentTaskResponseSchema, { task })).toBe(true);
    expect(
      Value.Check(StartAgentTurnRequestSchema, {
        input: prompt,
        options: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(StartAgentTurnRequestSchema, {
        input: prompt,
        options: {
          approvalPolicy: "always",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).toBe(false);
    expect(Value.Check(StartAgentTurnResponseSchema, { taskId: task.id, turn })).toBe(true);
    expect(Value.Check(SteerAgentTurnRequestSchema, { input: prompt, taskId: task.id })).toBe(true);
    expect(
      Value.Check(SteerAgentTurnResponseSchema, {
        status: "accepted",
        taskId: task.id,
        turnId: turn.id,
      }),
    ).toBe(true);
    expect(
      Value.Check(SteerAgentTurnRequestSchema, {
        input: prompt,
        options: { model: "gpt-5.6-sol" },
        taskId: task.id,
      }),
    ).toBe(false);
    expect(Value.Check(InterruptAgentTurnRequestSchema, { taskId: task.id })).toBe(true);
    expect(
      Value.Check(InterruptAgentTurnResponseSchema, {
        status: "interrupting",
        taskId: task.id,
        turnId: turn.id,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMutationErrorSchema, {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key was already used with another request",
        retryable: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMutationErrorSchema, {
        code: "IDEMPOTENCY_CAPACITY_EXCEEDED",
        message: "Too many idempotent requests are in progress",
        retryable: true,
      }),
    ).toBe(true);
    for (const code of [
      "ACCESS_DENIED",
      "PAIRING_FAILED",
      "PAIRING_RATE_LIMITED",
      "GIT_WORKTREE_ALREADY_ACTIVE",
      "GIT_WORKTREE_CREATE_FAILED",
      "GIT_WORKTREE_NOT_FOUND",
    ]) {
      expect(
        Value.Check(AgentMutationErrorSchema, {
          code,
          message: "Access request failed",
          retryable: false,
        }),
      ).toBe(true);
    }
  });

  it("uses bounded image, file, and pasted text input limits", () => {
    expect(MAX_AGENT_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_AGENT_FILE_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_AGENT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_AGENT_IMAGES).toBe(20);
    expect(MAX_AGENT_IMAGE_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_AGENT_TEXT_BYTES).toBe(1024 * 1024);
  });
});
