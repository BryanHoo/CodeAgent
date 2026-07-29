import type {
  AgentApprovalPolicy,
  AgentAttachment,
  AgentCapabilities,
  AgentModel,
  AgentPromptInput,
  AgentSandboxMode,
  AgentSkill,
  AgentTask,
  AgentTaskSettings,
  AgentTaskSnapshot,
  AgentTurn,
  AgentTurnOptions,
} from "@code-agent/protocol";
import {
  Bug,
  CircleGauge,
  FilePlus2,
  Folder,
  GitBranch,
  GitFork,
  MessageCirclePlus,
  MessageSquareText,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { TaskRuntimeView } from "../../conversation/runtime/use-task-runtime.js";
import type { CodeAgentMutationClient } from "../../projects/project-queries.js";
import {
  createComposerDraftScope,
  useComposerDraftStore,
  type ComposerCommandDraftMode,
} from "../composer-draft-context.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "../../../shared/ai-elements/attachments.js";
import { Context, ContextTrigger } from "../../../shared/ai-elements/context.js";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputAttachment,
  type PromptInputMessage,
} from "../../../shared/ai-elements/prompt-input.js";
import {
  insertPromptSkill,
  isPromptSkillContentEmpty,
  PromptSkillEditor,
  toPromptSkillSubmission,
  type PromptSkillContent,
  type PromptSkillEditorHandle,
} from "./prompt-skill-editor.js";
import {
  filterPromptCommandItems,
  filterPromptSkills,
  getPromptCommandAvailability,
  movePromptCommandSelection,
  promptCommandItems,
  resolvePromptSlashCommand,
  type PromptCommandAction,
  type PromptCommandItem,
  type PromptSlashCommand,
} from "./prompt-command.js";

export type ComposerState = "failed" | "idle" | "reconnecting" | "running" | "submitting";
export type ApprovalMode = AgentApprovalPolicy | "auto-review";

export type IdempotencyAttempt = Readonly<{
  fingerprint: string;
  key: string;
}>;

export function resolveIdempotencyAttempt(
  previous: IdempotencyAttempt | undefined,
  fingerprint: string,
  createKey: () => string = () => globalThis.crypto.randomUUID(),
): IdempotencyAttempt {
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: createKey() };
}

export function resolveReasoningEffort(
  model:
    | Readonly<{
        defaultReasoningEffort: string;
        supportedReasoningEfforts: readonly Readonly<{ id: string }>[];
      }>
    | undefined,
  requestedEffort: string,
): string | undefined {
  if (model === undefined) {
    return undefined;
  }
  return model.supportedReasoningEfforts.some((option) => option.id === requestedEffort)
    ? requestedEffort
    : model.defaultReasoningEffort;
}

export function deriveApprovalMode(
  settings: Pick<AgentTaskSettings, "approvalPolicy" | "approvalsReviewer">,
): ApprovalMode {
  return settings.approvalPolicy === "on-request" && settings.approvalsReviewer === "auto_review"
    ? "auto-review"
    : settings.approvalPolicy;
}

export function applyApprovalMode(
  settings: AgentTaskSettings,
  mode: ApprovalMode,
): AgentTaskSettings {
  // 自动审批是 on-request 策略加自动审核方，不能降级成语义不同的 never。
  return mode === "auto-review"
    ? { ...settings, approvalPolicy: "on-request", approvalsReviewer: "auto_review" }
    : { ...settings, approvalPolicy: mode, approvalsReviewer: "user" };
}

const reasoningEffortLabels: Readonly<Record<string, string>> = {
  high: "高",
  low: "低",
  max: "最大",
  medium: "中",
  minimal: "最低",
  ultra: "超高",
  xhigh: "极高",
};

export function deriveComposerActions(
  capabilities: AgentCapabilities | undefined,
  hasTask: boolean,
): Readonly<{ canInterrupt: boolean; canSubmit: boolean }> {
  return {
    canInterrupt: capabilities?.turns.interrupt ?? false,
    canSubmit:
      capabilities !== undefined &&
      capabilities.turns.start &&
      (hasTask || capabilities.tasks.start),
  };
}

export function deriveComposerState(
  input: Readonly<{
    activeTurnId: string | undefined;
    connectionState: TaskRuntimeView["connectionState"];
    isSubmitting?: boolean;
    mutationFailed?: boolean;
  }>,
): ComposerState {
  if (input.isSubmitting === true) {
    return "submitting";
  }
  if (
    input.connectionState === "closed" ||
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting"
  ) {
    return "reconnecting";
  }
  if (input.activeTurnId !== undefined) {
    return "running";
  }
  return input.mutationFailed === true ? "failed" : "idle";
}

export function deriveComposerInputAvailability(state: ComposerState): Readonly<{
  attachmentsDisabled: boolean;
  draftInputDisabled: boolean;
  turnControlsDisabled: boolean;
}> {
  return {
    // 草稿与附件都是本地输入，实时连接恢复期间不能禁用，否则浏览器会终止原生 IME 上下文。
    attachmentsDisabled: state === "submitting",
    draftInputDisabled: state === "submitting",
    turnControlsDisabled: state === "reconnecting" || state === "submitting",
  };
}

export function resolveActiveTurnId(
  snapshot:
    (Pick<AgentTaskSnapshot, "turns"> & Partial<Pick<AgentTaskSnapshot, "status">>) | undefined,
  submittedTurnId: string | undefined,
): string | undefined {
  const runningTurn = snapshot?.turns.findLast((turn) => turn.status === "running");
  if (runningTurn !== undefined) {
    return runningTurn.id;
  }
  const submittedTurn = snapshot?.turns.find((turn) => turn.id === submittedTurnId);
  return submittedTurn === undefined || submittedTurn.status === "running"
    ? submittedTurnId
    : undefined;
}

type StartPromptTurnOptions = Readonly<{
  idempotencyKeys: Readonly<{ startTask?: string; startTurn: string }>;
  input: AgentPromptInput;
  onTaskCreated?: (task: AgentTask) => void;
  projectId: string;
  taskId?: string;
  turnOptions: AgentTurnOptions;
}>;

export async function startPromptTurn(
  client: Pick<CodeAgentMutationClient, "startTask" | "startTurn">,
  options: StartPromptTurnOptions,
): Promise<Readonly<{ createdTask?: AgentTask; taskId: string; turn: AgentTurn }>> {
  let taskId = options.taskId;
  let createdTask: AgentTask | undefined;
  if (taskId === undefined) {
    const startTaskKey = options.idempotencyKeys.startTask;
    if (startTaskKey === undefined) {
      throw new Error("Task creation requires an idempotency key");
    }
    const response = await client.startTask(options.projectId, {
      idempotencyKey: startTaskKey,
    });
    createdTask = response.task;
    taskId = response.task.id;
    options.onTaskCreated?.(response.task);
  }
  const response = await client.startTurn(
    options.projectId,
    taskId,
    options.input,
    options.turnOptions,
    {
      idempotencyKey: options.idempotencyKeys.startTurn,
    },
  );
  return {
    ...(createdTask === undefined ? {} : { createdTask }),
    taskId,
    turn: response.turn,
  };
}

export function interruptPromptTurn(
  client: Pick<CodeAgentMutationClient, "interruptTurn">,
  projectId: string,
  taskId: string,
  turnId: string,
  idempotencyKey: string,
) {
  return client.interruptTurn(projectId, taskId, turnId, { idempotencyKey });
}

type WorkbenchComposerProps = Readonly<{
  capabilities: AgentCapabilities | undefined;
  client: CodeAgentMutationClient;
  models: readonly AgentModel[];
  modelsError: Error | null;
  modelsPending: boolean;
  onSettingsChange: (
    settings: AgentTaskSettings,
    field: keyof AgentTaskSettings,
  ) => Promise<void> | void;
  onTurnStarted?: (turn: AgentTurn, input: AgentPromptInput) => void;
  onTaskStarted: (
    task: AgentTask,
    turn?: AgentTurn,
    input?: AgentPromptInput,
    settings?: AgentTaskSettings,
  ) => void;
  projectId: string;
  projectPath: string;
  runtime?: TaskRuntimeView;
  settings: AgentTaskSettings;
  skills: readonly AgentSkill[];
  taskId?: string;
}>;

function PromptCommandIcon({ action }: Readonly<{ action: PromptCommandAction }>) {
  const className = "size-4 shrink-0 text-accent";
  switch (action) {
    case "review":
      return <Bug aria-hidden="true" className={className} />;
    case "initialize":
      return <FilePlus2 aria-hidden="true" className={className} />;
    case "subtask":
      return <MessageCirclePlus aria-hidden="true" className={className} />;
    case "compact":
      return <CircleGauge aria-hidden="true" className={className} />;
    case "feedback":
      return <MessageSquareText aria-hidden="true" className={className} />;
    case "fork":
      return <GitFork aria-hidden="true" className={className} />;
  }
}

function ComposerAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) {
    return null;
  }
  return (
    <PromptInputHeader>
      <Attachments aria-label="已添加附件">
        {attachments.files.map((attachment) => (
          <Attachment
            data={attachment}
            key={attachment.id}
            onRemove={() => {
              attachments.remove(attachment.id);
            }}
          >
            <AttachmentPreview />
            <AttachmentInfo />
            <AttachmentRemove disabled={attachments.disabled} />
          </Attachment>
        ))}
      </Attachments>
    </PromptInputHeader>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("附件读取失败"));
    });
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("附件读取失败"));
      }
    });
    reader.readAsDataURL(file);
  });
}

export function WorkbenchComposer({
  capabilities,
  client,
  models,
  modelsError,
  modelsPending,
  onSettingsChange,
  onTaskStarted,
  onTurnStarted,
  projectId,
  projectPath,
  runtime,
  settings,
  skills,
  taskId,
}: WorkbenchComposerProps) {
  const routeScope = `${projectId}:${taskId ?? "draft"}`;
  const composerScope = createComposerDraftScope(projectId, taskId);
  const composerDraftStore = useComposerDraftStore();
  const initialComposerDraft = composerDraftStore.read(composerScope);
  const [settingsOverride, setSettingsOverride] = useState<{
    scope: string;
    settings: AgentTaskSettings;
  }>();
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [attachments, setAttachments] = useState<readonly PromptInputAttachment[]>(
    initialComposerDraft.attachments,
  );
  const [commandDraftMode, setCommandDraftMode] = useState<ComposerCommandDraftMode | null>(
    initialComposerDraft.commandDraftMode,
  );
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string>();
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSlashCommand, setCommandSlashCommand] = useState<PromptSlashCommand>();
  const [promptContent, setPromptContent] = useState<PromptSkillContent>(
    initialComposerDraft.content,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const [pendingTaskState, setPendingTaskState] = useState<{
    scope: string;
    task: AgentTask;
  }>();
  const [submittedTurnState, setSubmittedTurnState] = useState<{
    scope: string;
    turnId: string;
  }>();
  const commandMenuId = useId();
  const commandSurfaceRef = useRef<HTMLDivElement>(null);
  const skillEditorRef = useRef<PromptSkillEditorHandle>(null);
  const routeScopeRef = useRef(routeScope);
  const previousRouteScopeRef = useRef(routeScope);
  const previousComposerScopeRef = useRef(composerScope);
  routeScopeRef.current = routeScope;
  const startTaskAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const startTurnAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const interruptAttempt = useRef<IdempotencyAttempt | undefined>(undefined);
  const uploadedAttachments = useRef(new Map<string, AgentAttachment>());
  const uploadAttempts = useRef(new Map<string, string>());
  const commandAttempts = useRef(new Map<PromptCommandAction, IdempotencyAttempt>());
  const submittedTurnId =
    submittedTurnState?.scope === routeScope ? submittedTurnState.turnId : undefined;
  const pendingTask = pendingTaskState?.scope === routeScope ? pendingTaskState.task : undefined;
  const activeTurnId = resolveActiveTurnId(runtime?.snapshot, submittedTurnId);
  const activeTaskId = taskId ?? pendingTask?.id;
  const { canInterrupt, canSubmit } = deriveComposerActions(
    capabilities,
    activeTaskId !== undefined,
  );
  const connectionState = runtime?.connectionState ?? "connected";
  const state = deriveComposerState({
    activeTurnId,
    connectionState,
    isSubmitting,
    mutationFailed: mutationError !== null || runtime?.error !== null,
  });
  const promptSubmission = toPromptSkillSubmission(promptContent);
  const activeSettings =
    settingsOverride?.scope === routeScope ? settingsOverride.settings : settings;
  const selectedModel =
    models.find((model) => model.id === activeSettings.model) ??
    models.find((model) => model.isDefault) ??
    models[0];
  const selectedReasoningEffort = resolveReasoningEffort(
    selectedModel,
    activeSettings.reasoningEffort,
  );
  const contextUsage = runtime?.snapshot?.contextUsage;
  const attachmentCount = attachments.length;
  const { attachmentsDisabled, draftInputDisabled, turnControlsDisabled } =
    deriveComposerInputAvailability(state);
  const filteredSkills = filterPromptSkills(
    capabilities?.skills.use === true ? skills : [],
    commandQuery,
  );
  const filteredCommands = filterPromptCommandItems(promptCommandItems, commandQuery);
  const menuItemCount = filteredSkills.length + filteredCommands.length;
  const activeCommandItemId =
    !commandMenuOpen || menuItemCount === 0
      ? undefined
      : `${commandMenuId}-item-${String(activeCommandIndex)}`;
  const handleAttachmentsChange = useCallback(
    (files: readonly PromptInputAttachment[]) => {
      setAttachments(files);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        attachments: files,
      }));
    },
    [composerDraftStore, composerScope],
  );
  const closeCommandMenu = useCallback(() => {
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
  }, []);
  const replacePromptContent = useCallback(
    (nextContent: PromptSkillContent, cursorOffset?: number) => {
      setPromptContent(nextContent);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        content: nextContent,
      }));
      // 程序化命令直接同步编辑 DOM，避免受控回写破坏 IME 组合缓冲。
      skillEditorRef.current?.replace(nextContent, cursorOffset);
    },
    [composerDraftStore, composerScope],
  );

  const replaceCommandDraftMode = useCallback(
    (mode: ComposerCommandDraftMode | null) => {
      setCommandDraftMode(mode);
      composerDraftStore.update(composerScope, (current) => ({
        ...current,
        commandDraftMode: mode,
      }));
    },
    [composerDraftStore, composerScope],
  );

  const clearComposerDraft = useCallback(() => {
    composerDraftStore.clear(composerScope);
    setPromptContent([]);
    setAttachments([]);
    setCommandDraftMode(null);
    skillEditorRef.current?.replace([]);
  }, [composerDraftStore, composerScope]);

  useLayoutEffect(() => {
    if (previousRouteScopeRef.current === routeScope) {
      return;
    }
    previousRouteScopeRef.current = routeScope;
    if (previousComposerScopeRef.current !== composerScope) {
      previousComposerScopeRef.current = composerScope;
      const restoredDraft = composerDraftStore.read(composerScope);
      // 切换聊天时恢复对应草稿，同时保留编辑节点和焦点，避免重建原生 IME 会话。
      setPromptContent(restoredDraft.content);
      setAttachments(restoredDraft.attachments);
      setCommandDraftMode(restoredDraft.commandDraftMode);
      skillEditorRef.current?.replace(restoredDraft.content);
      setSettingsOverride(undefined);
      setActiveCommandIndex(0);
      setCommandMenuOpen(false);
      setCommandNotice(undefined);
      setCommandQuery("");
      setCommandSlashCommand(undefined);
      setPendingTaskState(undefined);
      setSubmittedTurnState(undefined);
    }
    // 路由相关请求结果不能写入刚激活的其他聊天。
    setIsSubmitting(false);
    setMutationError(null);
    startTaskAttempt.current = undefined;
    startTurnAttempt.current = undefined;
    interruptAttempt.current = undefined;
    uploadedAttachments.current.clear();
    uploadAttempts.current.clear();
    commandAttempts.current.clear();
  }, [composerDraftStore, composerScope, routeScope]);

  const updateSettings = (nextSettings: AgentTaskSettings, field: keyof AgentTaskSettings) => {
    const requestScope = routeScope;
    setSettingsOverride({ scope: requestScope, settings: nextSettings });
    setMutationError(null);
    // 设置写回由用户事件直接触发，避免 effect 重放或并发渲染造成重复请求。
    void Promise.resolve(onSettingsChange(nextSettings, field)).catch((error: unknown) => {
      if (routeScopeRef.current === requestScope) {
        setMutationError(error instanceof Error ? error : new Error("Settings update failed"));
      }
    });
  };

  useEffect(() => {
    if (turnControlsDisabled) {
      closeCommandMenu();
    }
  }, [closeCommandMenu, turnControlsDisabled]);

  useEffect(() => {
    if (!commandMenuOpen) {
      return undefined;
    }
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandMenu();
      }
    };
    const handleDocumentPointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && !commandSurfaceRef.current?.contains(eventTarget)) {
        // 输入框和命令弹层共享一个交互区域，只有点击区域外部才关闭弹层。
        closeCommandMenu();
      }
    };
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [closeCommandMenu, commandMenuOpen]);

  const focusEditor = (cursorPosition?: number) => {
    requestAnimationFrame(() => {
      skillEditorRef.current?.focus(cursorPosition);
    });
  };

  const submitPrompt = async (
    message: PromptInputMessage,
    promptSkills?: readonly AgentSkill[],
  ) => {
    const requestScope = routeScope;
    const text = message.text.trim();
    const skills =
      promptSkills ??
      toPromptSkillSubmission(skillEditorRef.current?.getContent() ?? promptContent).skills;
    if (
      !canSubmit ||
      (text === "" && message.files.length === 0 && skills.length === 0) ||
      selectedModel === undefined ||
      selectedReasoningEffort === undefined ||
      turnControlsDisabled ||
      state === "running"
    ) {
      return;
    }
    setIsSubmitting(true);
    setMutationError(null);
    let input: AgentPromptInput;
    try {
      const attachments = await Promise.all(
        message.files.map(async (attachment) => {
          const uploaded = uploadedAttachments.current.get(attachment.id);
          if (uploaded !== undefined) {
            return { id: uploaded.id };
          }
          const idempotencyKey =
            uploadAttempts.current.get(attachment.id) ?? globalThis.crypto.randomUUID();
          uploadAttempts.current.set(attachment.id, idempotencyKey);
          const response = await client.uploadAttachment(
            projectId,
            { dataUrl: await readFileAsDataUrl(attachment.file), name: attachment.name },
            { idempotencyKey },
          );
          if (routeScopeRef.current === requestScope) {
            uploadedAttachments.current.set(attachment.id, response.attachment);
          }
          return { id: response.attachment.id };
        }),
      );
      input = {
        attachments,
        skills: skills.map((skill) => ({ id: skill.id, name: skill.name })),
        text,
        type: "prompt",
      };
    } catch (error) {
      if (routeScopeRef.current === requestScope) {
        setMutationError(error instanceof Error ? error : new Error("附件上传失败"));
        setIsSubmitting(false);
      }
      return;
    }

    const turnOptions: AgentTurnOptions = {
      ...activeSettings,
      model: selectedModel.id,
      reasoningEffort: selectedReasoningEffort,
    };
    const turnAttempt = resolveIdempotencyAttempt(
      startTurnAttempt.current,
      JSON.stringify({ input, options: turnOptions }),
    );
    startTurnAttempt.current = turnAttempt;
    const taskAttempt =
      activeTaskId === undefined
        ? resolveIdempotencyAttempt(startTaskAttempt.current, projectId)
        : undefined;
    startTaskAttempt.current = taskAttempt;
    try {
      const result = await startPromptTurn(client, {
        idempotencyKeys: {
          ...(taskAttempt === undefined ? {} : { startTask: taskAttempt.key }),
          startTurn: turnAttempt.key,
        },
        input,
        onTaskCreated(task) {
          // Turn 启动失败时保留已创建 Task，重试不能重复创建。
          if (routeScopeRef.current === requestScope) {
            setPendingTaskState({ scope: requestScope, task });
            startTaskAttempt.current = undefined;
          }
        },
        projectId,
        ...(activeTaskId === undefined ? {} : { taskId: activeTaskId }),
        turnOptions,
      });
      if (routeScopeRef.current === requestScope) {
        clearComposerDraft();
        setSubmittedTurnState({ scope: requestScope, turnId: result.turn.id });
      }
      // Mutation 返回后立即上报本次提交，Timeline 不等待 Provider Snapshot 落盘。
      onTurnStarted?.(result.turn, input);
      if (routeScopeRef.current === requestScope) {
        startTurnAttempt.current = undefined;
        uploadedAttachments.current.clear();
        uploadAttempts.current.clear();
      }
      if (taskId === undefined) {
        const startedTask = result.createdTask ?? pendingTask;
        if (startedTask !== undefined) {
          onTaskStarted(startedTask, result.turn, input, turnOptions);
        }
      }
    } catch (error) {
      if (routeScopeRef.current === requestScope) {
        setMutationError(error instanceof Error ? error : new Error("Prompt submission failed"));
      }
    } finally {
      if (routeScopeRef.current === requestScope) {
        setIsSubmitting(false);
      }
    }
  };

  const getCommandAvailability = (command: PromptCommandItem) => {
    const availability = getPromptCommandAvailability(
      command,
      capabilities,
      activeTaskId !== undefined,
    );
    if (availability.available && state === "running") {
      return { available: false, reason: "任务运行中" } as const;
    }
    return availability;
  };

  const beginCommandDraft = (mode: ComposerCommandDraftMode) => {
    replaceCommandDraftMode(mode);
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
    setCommandNotice(undefined);
    replacePromptContent([]);
    handleAttachmentsChange([]);
    focusEditor();
  };

  const submitFeedback = async (reason: string) => {
    const requestScope = routeScope;
    const normalizedReason = reason.trim();
    if (
      activeTaskId === undefined ||
      normalizedReason === "" ||
      !capabilities?.feedback.upload ||
      turnControlsDisabled
    ) {
      return;
    }
    setIsSubmitting(true);
    setMutationError(null);
    const input = { classification: "other", includeLogs: true, reason: normalizedReason };
    const attempt = resolveIdempotencyAttempt(
      commandAttempts.current.get("feedback"),
      JSON.stringify({ input, taskId: activeTaskId }),
    );
    commandAttempts.current.set("feedback", attempt);
    try {
      await client.uploadFeedback(projectId, activeTaskId, input, {
        idempotencyKey: attempt.key,
      });
      if (routeScopeRef.current === requestScope) {
        commandAttempts.current.delete("feedback");
        replaceCommandDraftMode(null);
        setCommandNotice("反馈已发送");
        replacePromptContent([]);
      }
    } catch (error) {
      if (routeScopeRef.current === requestScope) {
        setMutationError(error instanceof Error ? error : new Error("Feedback submission failed"));
      }
    } finally {
      if (routeScopeRef.current === requestScope) {
        setIsSubmitting(false);
      }
    }
  };

  const executePromptCommand = async (command: PromptCommandItem) => {
    const requestScope = routeScope;
    if (!getCommandAvailability(command).available) {
      return;
    }
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
    setCommandNotice(undefined);
    replacePromptContent([]);

    if (command.action === "feedback" || command.action === "subtask") {
      beginCommandDraft(command.action);
      return;
    }
    if (command.action === "initialize") {
      await submitPrompt(
        {
          files: [],
          text: "请检查当前项目，并在项目根目录创建或完善 AGENTS.md，写入适用于 Codex 的项目说明、常用命令和验证要求。",
        },
        [],
      );
      return;
    }
    if (activeTaskId === undefined) {
      return;
    }

    setIsSubmitting(true);
    setMutationError(null);
    const attempt = resolveIdempotencyAttempt(
      commandAttempts.current.get(command.action),
      `${command.action}:${activeTaskId}`,
    );
    commandAttempts.current.set(command.action, attempt);
    try {
      if (command.action === "review") {
        const response = await client.startReview(
          projectId,
          activeTaskId,
          { target: { type: "uncommitted_changes" } },
          { idempotencyKey: attempt.key },
        );
        if (routeScopeRef.current === requestScope) {
          setSubmittedTurnState({ scope: requestScope, turnId: response.turn.id });
          setCommandNotice("代码审查已开始");
        }
      } else if (command.action === "compact") {
        await client.compactTask(projectId, activeTaskId, { idempotencyKey: attempt.key });
        if (routeScopeRef.current === requestScope) {
          setCommandNotice("正在压缩上下文");
        }
      } else {
        const response = await client.forkTask(projectId, activeTaskId, {
          idempotencyKey: attempt.key,
        });
        onTaskStarted(response.task);
      }
      if (routeScopeRef.current === requestScope) {
        commandAttempts.current.delete(command.action);
      }
    } catch (error) {
      if (routeScopeRef.current === requestScope) {
        setMutationError(error instanceof Error ? error : new Error("Task command failed"));
      }
    } finally {
      if (routeScopeRef.current === requestScope) {
        setIsSubmitting(false);
      }
    }
  };

  const selectSkill = (skill: AgentSkill) => {
    // Skill 选择只保存不透明引用；原生路径由 Provider 在提交边界解析。
    const slashCommand = commandSlashCommand;
    if (slashCommand === undefined) {
      return;
    }
    const currentContent = skillEditorRef.current?.getContent() ?? promptContent;
    const nextContent = insertPromptSkill(currentContent, slashCommand, skill);
    const cursorPosition = slashCommand.start + `$${skill.name}`.length;
    replacePromptContent(nextContent, cursorPosition);
    setCommandMenuOpen(false);
    setCommandQuery("");
    setCommandSlashCommand(undefined);
    setCommandNotice(undefined);
    focusEditor(cursorPosition);
  };

  const selectActiveCommandItem = () => {
    const command = filteredCommands[activeCommandIndex];
    if (command !== undefined) {
      void executePromptCommand(command);
      return;
    }
    const skill = filteredSkills[activeCommandIndex - filteredCommands.length];
    if (skill !== undefined) {
      selectSkill(skill);
    }
  };

  const interruptTurn = async () => {
    const requestScope = routeScope;
    if (
      !canInterrupt ||
      activeTaskId === undefined ||
      activeTurnId === undefined ||
      turnControlsDisabled
    ) {
      return;
    }
    setIsSubmitting(true);
    setMutationError(null);
    const attempt = resolveIdempotencyAttempt(
      interruptAttempt.current,
      `${activeTaskId}:${activeTurnId}`,
    );
    interruptAttempt.current = attempt;
    try {
      // `202` 仅确认请求已接收；同一 Turn 到达终态前继续复用当前 Key。
      await interruptPromptTurn(client, projectId, activeTaskId, activeTurnId, attempt.key);
    } catch (error) {
      if (routeScopeRef.current === requestScope) {
        setMutationError(error instanceof Error ? error : new Error("Turn interruption failed"));
      }
    } finally {
      if (routeScopeRef.current === requestScope) {
        setIsSubmitting(false);
      }
    }
  };

  const commandMenu =
    !commandMenuOpen || turnControlsDisabled ? null : (
      <PromptInputCommand
        aria-label="输入命令"
        className="absolute inset-x-0 bottom-full z-20 mb-2"
        id={commandMenuId}
      >
        <PromptInputCommandList>
          <PromptInputCommandGroup label="命令">
            {filteredCommands.map((command, index) => {
              const availability = getCommandAvailability(command);
              return (
                <PromptInputCommandItem
                  active={index === activeCommandIndex}
                  aria-description={availability.reason}
                  disabled={!availability.available}
                  id={`${commandMenuId}-item-${String(index)}`}
                  key={command.id}
                  onClick={() => {
                    void executePromptCommand(command);
                  }}
                >
                  <PromptCommandIcon action={command.action} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{command.label}</span>
                    <span className="text-caption text-muted-foreground">
                      {availability.reason ?? command.description}
                    </span>
                  </span>
                </PromptInputCommandItem>
              );
            })}
          </PromptInputCommandGroup>
          {filteredSkills.length === 0 ? null : (
            <PromptInputCommandGroup label="Skills">
              {filteredSkills.map((skill, index) => {
                const menuIndex = filteredCommands.length + index;
                return (
                  <PromptInputCommandItem
                    active={menuIndex === activeCommandIndex}
                    id={`${commandMenuId}-item-${String(menuIndex)}`}
                    key={skill.id}
                    onClick={() => {
                      selectSkill(skill);
                    }}
                  >
                    <Sparkles aria-hidden="true" className="size-4 shrink-0 text-skill" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium text-skill">{skill.displayName}</span>
                      <span className="block max-w-full truncate text-caption text-muted-foreground">
                        /{skill.name} · {skill.description}
                      </span>
                    </span>
                  </PromptInputCommandItem>
                );
              })}
            </PromptInputCommandGroup>
          )}
          {menuItemCount === 0 ? (
            <PromptInputCommandEmpty>没有匹配的 Skill 或命令</PromptInputCommandEmpty>
          ) : null}
        </PromptInputCommandList>
      </PromptInputCommand>
    );

  return (
    <section className="shrink-0 bg-content px-3 pb-2 sm:px-5" aria-label="Composer">
      <div className="relative mx-auto w-full max-w-content" ref={commandSurfaceRef}>
        {commandMenu}
        <PromptInput
          accept="image/gif,image/jpeg,image/png,image/webp"
          attachments={attachments}
          aria-busy={state === "submitting" || state === "reconnecting"}
          className="w-full"
          data-state={state}
          disabled={attachmentsDisabled}
          globalDrop
          maxFiles={4}
          maxFileSize={2 * 1024 * 1024}
          multiple
          onAttachmentsChange={handleAttachmentsChange}
          onError={(error) => {
            setMutationError(new Error(error.message));
          }}
          onSubmit={(message) => {
            if (commandDraftMode === "feedback") {
              void submitFeedback(message.text);
              return;
            }
            if (commandDraftMode === "subtask") {
              void submitPrompt({
                ...message,
                text: `请使用子代理独立处理以下副任务，并在完成后汇总结果：\n\n${message.text}`,
              });
              return;
            }
            void submitPrompt(message);
          }}
        >
          {commandDraftMode === null ? null : (
            <PromptInputHeader className="flex items-center">
              <PromptInputButton
                aria-label={`取消${commandDraftMode === "feedback" ? "反馈" : "副任务"}`}
                className="max-w-full border border-separator-strong bg-control text-foreground"
                onClick={() => {
                  replaceCommandDraftMode(null);
                  replacePromptContent([]);
                  focusEditor();
                }}
              >
                {commandDraftMode === "feedback" ? (
                  <MessageSquareText className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                ) : (
                  <MessageCirclePlus className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                )}
                <span>{commandDraftMode === "feedback" ? "任务反馈" : "副任务"}</span>
                <X className="size-3.5 shrink-0" aria-hidden="true" />
              </PromptInputButton>
            </PromptInputHeader>
          )}
          <ComposerAttachments />
          <PromptInputBody>
            <input name="message" type="hidden" value={promptSubmission.text} />
            <PromptSkillEditor
              aria-activedescendant={activeCommandItemId}
              aria-controls={commandMenuOpen ? commandMenuId : undefined}
              aria-expanded={commandMenuOpen}
              aria-haspopup="listbox"
              aria-label="任务输入"
              content={promptContent}
              disabled={draftInputDisabled}
              onChange={(nextContent, serializedText, cursorOffset) => {
                setPromptContent(nextContent);
                composerDraftStore.update(composerScope, (current) => ({
                  ...current,
                  content: nextContent,
                }));
                setCommandNotice(undefined);
                if (commandDraftMode !== null) {
                  return;
                }
                const slashCommand = resolvePromptSlashCommand(serializedText, cursorOffset);
                if (slashCommand === null) {
                  setCommandMenuOpen(false);
                  setCommandQuery("");
                  setCommandSlashCommand(undefined);
                  return;
                }
                // 文本开头或空白后的 `/` 片段驱动过滤，连续正文中的斜杠保持普通字符。
                setActiveCommandIndex(0);
                setCommandMenuOpen(true);
                setCommandQuery(slashCommand.query);
                setCommandSlashCommand(slashCommand);
              }}
              onKeyDown={(event) => {
                if (!commandMenuOpen || event.nativeEvent.isComposing) {
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveCommandIndex((currentIndex) =>
                    movePromptCommandSelection(
                      currentIndex,
                      event.key === "ArrowDown" ? 1 : -1,
                      menuItemCount,
                    ),
                  );
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  selectActiveCommandItem();
                }
              }}
              placeholder={
                commandDraftMode === "feedback"
                  ? "输入关于此任务的反馈"
                  : commandDraftMode === "subtask"
                    ? "描述需要交给子代理的任务"
                    : taskId === undefined
                      ? "描述一个新任务"
                      : "继续这个任务"
              }
              ref={skillEditorRef}
              scope={composerScope}
            />
            {mutationError === null ? null : (
              <p className="px-1 pb-1 text-label text-danger" role="alert">
                操作失败，请重试
              </p>
            )}
            {commandNotice === undefined ? null : (
              <p className="px-1 pb-1 text-label text-muted-foreground" role="status">
                {commandNotice}
              </p>
            )}
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionAddAttachments
                disabled={attachmentsDisabled || commandDraftMode === "feedback"}
                label="添加图片"
              />
              <PromptInputSelect
                aria-label="批准模式"
                disabled={turnControlsDisabled}
                onChange={(event) => {
                  updateSettings(
                    applyApprovalMode(activeSettings, event.currentTarget.value as ApprovalMode),
                    "approvalPolicy",
                  );
                }}
                value={deriveApprovalMode(activeSettings)}
              >
                <option value="untrusted">仅不受信任操作</option>
                <option value="on-request">按需审批</option>
                <option value="auto-review">自动审批</option>
                <option value="never">从不询问</option>
              </PromptInputSelect>
              <PromptInputSelect
                aria-label="沙盒模式"
                disabled={turnControlsDisabled}
                onChange={(event) => {
                  updateSettings(
                    {
                      ...activeSettings,
                      sandboxMode: event.currentTarget.value as AgentSandboxMode,
                    },
                    "sandboxMode",
                  );
                }}
                value={activeSettings.sandboxMode}
              >
                <option value="read-only">只读</option>
                <option value="workspace-write">工作区可写</option>
                <option value="danger-full-access">完全访问</option>
              </PromptInputSelect>
            </PromptInputTools>
            <div className="flex min-w-0 items-center gap-1">
              <PromptInputSelect
                aria-label="选择模型"
                disabled={turnControlsDisabled || modelsPending || selectedModel === undefined}
                onChange={(event) => {
                  const nextModel = models.find((model) => model.id === event.currentTarget.value);
                  const nextReasoningEffort = resolveReasoningEffort(
                    nextModel,
                    activeSettings.reasoningEffort,
                  );
                  if (nextModel !== undefined && nextReasoningEffort !== undefined) {
                    updateSettings(
                      {
                        ...activeSettings,
                        model: nextModel.id,
                        reasoningEffort: nextReasoningEffort,
                      },
                      "model",
                    );
                  }
                }}
                value={selectedModel?.id ?? ""}
              >
                {models.length === 0 ? (
                  <option value="">{modelsPending ? "模型加载中" : "暂无可用模型"}</option>
                ) : (
                  models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))
                )}
              </PromptInputSelect>
              <PromptInputSelect
                aria-label="选择思考量"
                disabled={turnControlsDisabled || modelsPending || selectedModel === undefined}
                onChange={(event) => {
                  updateSettings(
                    { ...activeSettings, reasoningEffort: event.currentTarget.value },
                    "reasoningEffort",
                  );
                }}
                title={
                  selectedModel?.supportedReasoningEfforts.find(
                    (option) => option.id === selectedReasoningEffort,
                  )?.description
                }
                value={selectedReasoningEffort ?? ""}
              >
                {selectedModel?.supportedReasoningEfforts.map((option) => (
                  <option key={option.id} value={option.id}>
                    {reasoningEffortLabels[option.id] ?? option.id}
                  </option>
                ))}
              </PromptInputSelect>
              <PromptInputSubmit
                aria-label={state === "running" ? "停止" : "提交"}
                disabled={
                  turnControlsDisabled ||
                  (state !== "running" &&
                    (!canSubmit ||
                      selectedModel === undefined ||
                      selectedReasoningEffort === undefined ||
                      (isPromptSkillContentEmpty(promptContent) && attachmentCount === 0))) ||
                  (state === "running" && (!canInterrupt || activeTurnId === undefined))
                }
                onClick={state === "running" ? () => void interruptTurn() : undefined}
                status={state}
                type={state === "running" ? "button" : "submit"}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
      {modelsError === null ? null : (
        <p className="mx-auto mt-1 w-full max-w-content px-1 text-caption text-danger" role="alert">
          模型列表加载失败
        </p>
      )}
      <div className="mx-auto mt-1.5 flex w-full max-w-content min-w-0 items-center gap-3 px-1 text-caption text-muted-foreground">
        <span className="inline-flex shrink-0 items-center gap-1">
          <GitBranch className="size-3" aria-hidden="true" /> main
        </span>
        <span
          aria-label="项目路径"
          className="inline-flex min-w-0 flex-1 items-center gap-1"
          title={projectPath}
        >
          <Folder className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{projectPath}</span>
        </span>
        <Context
          className="ml-auto"
          maxTokens={contextUsage?.contextWindow}
          usedTokens={contextUsage?.usedTokens}
        >
          <ContextTrigger />
        </Context>
      </div>
    </section>
  );
}
