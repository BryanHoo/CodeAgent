import type { MockRoute as Route } from "./mock-route.js";
import {
  architectureSourceFirstPage,
  architectureSourceNextCursor,
  architectureSourceSecondPage,
  packageJsonDiff,
  projectFileSearchEntries,
  projectFileTreeByDirectory,
  taskSnapshot,
} from "./mock-data.js";
import {
  parseProjectDefaultsRequest,
  parseRequestRecord,
  parseTaskSettingsRequest,
} from "./mock-request.js";
import type { AppShellApiState } from "./mock-state.js";

// 按协议领域处理一段 API 路由；未命中时交给下一处理器。
export async function handleAppShellProjectRoute(
  route: Route,
  state: AppShellApiState,
): Promise<boolean> {
  const url = new URL(route.request().url());
  const defaultsMatch = /^\/v1\/projects\/([^/]+)\/defaults$/u.exec(url.pathname);
  const settingsMatch = /^\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/settings$/u.exec(url.pathname);
  const projectRenameMatch = /^\/v1\/projects\/([^/]+)\/rename$/u.exec(url.pathname);
  const projectRemoveMatch = /^\/v1\/projects\/([^/]+)\/remove$/u.exec(url.pathname);
  let body: unknown;
  if (projectRenameMatch !== null && route.request().method() === "POST") {
    const projectId = projectRenameMatch[1] ?? "";
    const request = parseRequestRecord(route.request().postData());
    const name = request["name"];
    const projectIndex = state.routedProjects.findIndex((project) => project.id === projectId);
    const project = state.routedProjects[projectIndex];
    if (project === undefined || typeof name !== "string") {
      throw new Error("Invalid rename project request");
    }
    const renamedProject = { ...project, name };
    state.routedProjects[projectIndex] = renamedProject;
    body = { project: renamedProject };
  } else if (projectRemoveMatch !== null && route.request().method() === "POST") {
    const projectId = projectRemoveMatch[1] ?? "";
    state.routedProjects = state.routedProjects.filter((project) => project.id !== projectId);
    body = { projectId, status: "removed" };
  } else if (url.pathname === "/v1/projects") {
    body = { data: state.routedProjects, nextCursor: null };
  } else if (
    /^\/v1\/projects\/[^/]+\/files\/search\/stop$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    body = {};
  } else if (/^\/v1\/projects\/[^/]+\/files\/search$/u.test(url.pathname)) {
    const query = (url.searchParams.get("query") ?? "").toLocaleLowerCase();
    body = {
      data: projectFileSearchEntries.filter((file) =>
        file.name.toLocaleLowerCase().includes(query),
      ),
    };
  } else if (/^\/v1\/projects\/[^/]+\/files\/tree$/u.test(url.pathname)) {
    const directoryPath = url.searchParams.get("path");
    // 文件树接口只返回当前目录的直接子项，用于验证点击目录后才按需加载。
    body = projectFileTreeByDirectory.get(directoryPath) ?? { entries: [], path: directoryPath };
  } else if (url.pathname === "/v1/temporary/files/source") {
    body = {
      content: "# 临时文件\n\n允许从临时任务打开。\n",
      nextCursor: null,
      path: "/tmp/temporary-note.md",
    };
  } else if (url.pathname === "/v1/projects/codexly/files/source") {
    body =
      url.searchParams.get("cursor") === String(architectureSourceNextCursor)
        ? {
            content: architectureSourceSecondPage,
            nextCursor: null,
            path: "docs/architecture-design.md",
          }
        : {
            content: architectureSourceFirstPage,
            nextCursor: architectureSourceNextCursor,
            path: "docs/architecture-design.md",
          };
  } else if (
    url.pathname === "/v1/projects/codexly/git/worktrees" &&
    route.request().method() === "GET"
  ) {
    body = { worktrees: state.routedProjectGitWorktrees };
  } else if (
    url.pathname === "/v1/projects/codexly/git/worktrees" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const branch = request["branch"];
    if (
      typeof branch !== "string" ||
      request["expectedSnapshot"] !== state.routedProjectGitStatus.snapshot
    ) {
      throw new Error("Invalid worktree creation request");
    }
    const worktree = {
      branch,
      current: false,
      path: "/workspace/Codexly-composer-worktree",
    };
    const project = {
      createdAt: "2026-08-18T00:00:00.000Z",
      id: "codexly-composer-worktree",
      name: "Codexly-composer-worktree",
      roots: [{ id: "root-codexly-composer-worktree", path: worktree.path }],
    };
    state.routedProjectGitWorktrees.push(worktree);
    state.routedProjects = [...state.routedProjects, project];
    body = { project, worktree };
  } else if (
    url.pathname === "/v1/projects/codexly/git/worktree" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const worktree = state.routedProjectGitWorktrees.find(
      (candidate) => candidate.path === request["path"] && !candidate.current,
    );
    if (worktree === undefined) throw new Error("Invalid worktree switch request");
    const project = {
      createdAt: "2026-08-18T00:00:00.000Z",
      id: "codexly-worktree-review",
      name: "Codexly-worktree-review",
      roots: [{ id: "root-codexly-worktree-review", path: worktree.path }],
    };
    if (!state.routedProjects.some((candidate) => candidate.id === project.id)) {
      state.routedProjects = [...state.routedProjects, project];
    }
    body = { project, worktree };
  } else if (
    url.pathname === "/v1/projects/codexly/git/branch" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const branch = request["branch"];
    if (
      typeof branch !== "string" ||
      request["expectedSnapshot"] !== state.routedProjectGitStatus.snapshot ||
      !state.routedProjectGitStatus.branches.includes(branch)
    ) {
      throw new Error("Invalid branch switch request");
    }
    const previousBranch = state.routedProjectGitStatus.branch;
    state.routedProjectGitStatus = {
      ...state.routedProjectGitStatus,
      baseBranches: [
        ...state.routedProjectGitStatus.baseBranches.filter((candidate) => candidate !== branch),
        previousBranch,
      ],
      branch,
      branches: [
        branch,
        ...state.routedProjectGitStatus.branches.filter((candidate) => candidate !== branch),
      ],
      snapshot: "b".repeat(64),
    };
    body = state.routedProjectGitStatus;
  } else if (/^\/v1\/projects\/[^/]+\/git\/history$/u.test(url.pathname)) {
    body = {
      branch: state.routedProjectGitStatus.branch,
      commits: [
        {
          authoredAt: "2026-08-27T10:30:00.000Z",
          authorEmail: "developer@codeagent.local",
          authorName: "CodeAgent Developer",
          sha: "1".repeat(40),
          title: "feat(workbench): 完整迁移工作台",
        },
        {
          authoredAt: "2026-08-26T08:15:00.000Z",
          authorEmail: "developer@codeagent.local",
          authorName: "CodeAgent Developer",
          sha: "2".repeat(40),
          title: "refactor(runtime): 优化任务状态投影",
        },
      ],
      nextCursor: null,
      repositories: [],
      repository: null,
      repositoryMode: "root",
    };
  } else if (/^\/v1\/projects\/[^/]+\/git\/commit-files$/u.test(url.pathname)) {
    body = {
      files: [
        { kind: "update", path: "package.json" },
        { kind: "create", path: "src/mock/mock-fetch.ts" },
      ],
      nextCursor: null,
    };
  } else if (/^\/v1\/projects\/[^/]+\/git\/commit-diff$/u.test(url.pathname)) {
    body = { diff: packageJsonDiff, truncated: false };
  } else if (
    /^\/v1\/projects\/[^/]+\/git\/commit-message$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    body = {
      message: "feat(workbench): 完整迁移前端工作台",
      snapshot: state.routedProjectGitStatus.snapshot,
    };
  } else if (
    /^\/v1\/projects\/[^/]+\/git\/commits$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const message = request["message"];
    if (typeof message !== "string") throw new Error("Invalid commit request");
    state.routedProjectGitStatus = {
      ...state.routedProjectGitStatus,
      snapshot: "d".repeat(64),
      staged: [],
      unstaged: [],
    };
    body = {
      branch: state.routedProjectGitStatus.branch,
      commitSha: "d".repeat(40),
      message,
      pushError: null,
      pushStatus: request["action"] === "commit_and_push" ? "pushed" : "not_requested",
    };
  } else if (
    url.pathname === "/v1/projects/codexly/git/branches" &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const branch = request["branch"];
    if (
      typeof branch !== "string" ||
      request["expectedSnapshot"] !== state.routedProjectGitStatus.snapshot ||
      state.routedProjectGitStatus.branches.includes(branch)
    ) {
      throw new Error("Invalid branch creation request");
    }
    const previousBranch = state.routedProjectGitStatus.branch;
    state.routedProjectGitStatus = {
      ...state.routedProjectGitStatus,
      baseBranches: [...state.routedProjectGitStatus.baseBranches, previousBranch],
      branch,
      branches: [branch, ...state.routedProjectGitStatus.branches],
      snapshot: "c".repeat(64),
    };
    body = state.routedProjectGitStatus;
  } else if (/^\/v1\/projects\/[^/]+\/git\/status$/u.test(url.pathname)) {
    body =
      url.searchParams.get("rootPath") === "/workspace/shared"
        ? { ...state.routedProjectGitStatus, branch: "shared-main" }
        : state.routedProjectGitStatus;
  } else if (
    /^\/v1\/projects\/[^/]+\/files\/rename$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const path = request["path"];
    const name = request["name"];
    if (typeof path !== "string" || typeof name !== "string") {
      throw new Error("Invalid file rename request");
    }
    body = { path: [...path.split("/").slice(0, -1), name].filter(Boolean).join("/") };
  } else if (
    /^\/v1\/projects\/[^/]+\/files\/delete$/u.test(url.pathname) &&
    route.request().method() === "POST"
  ) {
    const request = parseRequestRecord(route.request().postData());
    const path = request["path"];
    if (typeof path !== "string") throw new Error("Invalid file delete request");
    body = { path, status: "deleted" };
  } else if (defaultsMatch !== null) {
    const projectId = defaultsMatch[1] ?? "";
    if (route.request().method() === "PUT") {
      state.projectDefaults.set(projectId, parseProjectDefaultsRequest(route.request().postData()));
    }
    body = { settings: state.projectDefaults.get(projectId) };
  } else if (settingsMatch !== null) {
    const projectId = settingsMatch[1] ?? "";
    const taskId = settingsMatch[2] ?? "";
    const key = `${projectId}:${taskId}`;
    if (route.request().method() === "PUT") {
      state.taskSettings.set(key, parseTaskSettingsRequest(route.request().postData()));
    }
    body = { settings: state.taskSettings.get(key) ?? taskSnapshot.settings };
  } else {
    return false;
  }
  await route.fulfill({ contentType: "application/json", json: body });
  return true;
}
