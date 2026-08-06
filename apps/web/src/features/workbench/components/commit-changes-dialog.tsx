import type {
  CommitProjectChangesRequest,
  CommitProjectChangesResponse,
  GenerateCommitMessageRequest,
  ProjectGitStatus,
} from "@code-agent/protocol";
import {
  Check,
  ChevronDown,
  ChevronRight,
  GitCommitHorizontal,
  LoaderCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { PromptInputButton } from "../../../shared/ai-elements/prompt-input-controls.js";
import { cn } from "../../../shared/lib/utils.js";
import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { Button } from "../../../shared/ui/button.js";
import { ButtonGroup } from "../../../shared/ui/button-group.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../shared/ui/collapsible.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui/dropdown-menu.js";
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "../../../shared/ui/input-group.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select.js";
import { Sheet, SheetContent, SheetTitle } from "../../../shared/ui/sheet.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodeAgentGitHistoryClient } from "../../projects/project-queries.js";
import { CommitChangesTreeSection } from "./commit-changes-tree.js";
import { GitHistoryList } from "./git-history-list.js";

type CommitFileEntry = Readonly<{
  path: string;
  staged: boolean;
  unstaged: boolean;
}>;

type CommitChangesDialogProps = Readonly<{
  client: CodeAgentGitHistoryClient;
  error?: Error | null;
  gitStatus: ProjectGitStatus;
  isCommitting?: boolean;
  isGenerating?: boolean;
  isRepositoryLoading?: boolean;
  onClose: () => void;
  onCommit: (request: CommitProjectChangesRequest) => Promise<void>;
  onGenerateMessage: (request: GenerateCommitMessageRequest) => Promise<string>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onSelectRepository?: (repository: string) => void;
  projectId: string;
  repositories?: readonly string[];
  result?: CommitProjectChangesResponse | null;
  selectedRepository?: string | null;
}>;

export function collectCommitFileEntries(status: ProjectGitStatus): readonly CommitFileEntry[] {
  const entries = new Map<string, { path: string; staged: boolean; unstaged: boolean }>();
  for (const change of status.staged) {
    entries.set(change.path, { path: change.path, staged: true, unstaged: false });
  }
  for (const change of status.unstaged) {
    const current = entries.get(change.path);
    entries.set(change.path, {
      path: change.path,
      staged: current?.staged ?? false,
      unstaged: true,
    });
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

export function collectCommitRepositories(status: ProjectGitStatus): readonly string[] {
  if (status.repositoryMode !== "children") {
    return [];
  }
  const repositories = new Set<string>();
  for (const change of [...status.staged, ...status.unstaged]) {
    const separator = change.path.indexOf("/");
    if (separator > 0) {
      repositories.add(change.path.slice(0, separator));
    }
  }
  return [...repositories].toSorted((left, right) => left.localeCompare(right, "en"));
}

function commitResultMessageKey(result: CommitProjectChangesResponse): string {
  if (result.pushStatus === "failed") return "commit.commitCompletePushFailed";
  if (result.pushStatus === "not_configured") return "commit.commitCompleteUpstreamMissing";
  return result.pushStatus === "pushed" ? "commit.commitAndPushComplete" : "commit.commitComplete";
}

export function CommitChangesDialog({
  client,
  error = null,
  gitStatus,
  isCommitting = false,
  isGenerating = false,
  isRepositoryLoading = false,
  onClose,
  onCommit,
  onGenerateMessage,
  onOpenFileDiff,
  onSelectRepository = () => undefined,
  projectId,
  repositories = [],
  result = null,
  selectedRepository = null,
}: CommitChangesDialogProps) {
  const { t } = useTranslation("workbench");
  const entries = useMemo(() => collectCommitFileEntries(gitStatus), [gitStatus]);
  const [selectedPaths, setSelectedPaths] = useState(
    () => new Set(entries.map((entry) => entry.path)),
  );
  const [message, setMessage] = useState("");
  const [changesOpen, setChangesOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage === "en" ? "en" : "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [],
  );
  const commitActionLockRef = useRef(createAsyncActionLock());
  const isPending = isGenerating || isCommitting;
  const requiresRepository = repositories.length > 0 || gitStatus.repositoryMode === "children";
  const repositoryReady =
    !requiresRepository ||
    (selectedRepository !== null && !isRepositoryLoading && gitStatus.repositoryMode === "root");
  const canGenerate = repositoryReady && selectedPaths.size > 0 && !isPending && result === null;
  const canCommit = canGenerate && message.trim().length > 0;
  const displayBranch = gitStatus.branch ?? "detached HEAD";

  const generateMessage = () =>
    commitActionLockRef.current.run(async () => {
      const generated = await onGenerateMessage({
        expectedSnapshot: gitStatus.snapshot,
        paths: [...selectedPaths],
        ...(selectedRepository === null ? {} : { repository: selectedRepository }),
      });
      setMessage(generated);
    });

  const commit = (action: CommitProjectChangesRequest["action"]) =>
    commitActionLockRef.current.run(() =>
      onCommit({
        action,
        expectedSnapshot: gitStatus.snapshot,
        message,
        paths: [...selectedPaths],
        ...(selectedRepository === null ? {} : { repository: selectedRepository }),
      }),
    );

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      open
    >
      <SheetContent
        aria-labelledby="commit-changes-title"
        className="sm:max-w-[36rem]"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
        showCloseButton={false}
        side="right"
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-separator px-4">
          <div className="flex min-w-0 items-center gap-2">
            <GitCommitHorizontal aria-hidden="true" className="size-4 shrink-0 text-primary" />
            <SheetTitle className="truncate text-body-small" id="commit-changes-title">
              {t("commit.title")}
            </SheetTitle>
          </div>
          <Button
            aria-label={t("commit.closeDialog")}
            disabled={isPending}
            onClick={onClose}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </header>

        {requiresRepository ? (
          <div className="shrink-0 border-b border-separator px-3 py-2">
            <label className="text-label font-medium" id="commit-repository-label">
              {t("commit.repository")}
            </label>
            <Select
              disabled={isPending || result !== null}
              onValueChange={onSelectRepository}
              {...(selectedRepository === null ? {} : { value: selectedRepository })}
            >
              <SelectTrigger aria-labelledby="commit-repository-label" className="mt-1 w-full">
                <SelectValue placeholder={t("commit.selectRepository")} />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  {repositories.map((repository) => (
                    <SelectItem key={repository} value={repository}>
                      {repository}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {isRepositoryLoading ? (
              <p className="mt-1 text-caption text-muted-foreground" role="status">
                {t("commit.repositoryLoading")}
              </p>
            ) : null}
            {repositories.length === 0 ? (
              <p className="mt-1 text-caption text-danger" role="alert">
                {t("commit.repositoryUnavailable")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-slot="commit-sheet-body">
          {error === null ? null : (
            <p className="mx-3 mt-2 shrink-0 text-caption text-danger" role="alert">
              {error.message}
            </p>
          )}

          {repositoryReady ? (
            <>
              <section className="shrink-0 px-3 py-2">
                <InputGroup className="h-8 gap-1 rounded-surface border border-separator-strong bg-panel shadow-sm focus-within:border-primary focus-within:shadow-focus max-workbench:h-11">
                  <InputGroupTextarea
                    aria-label={t("commit.commitMessage")}
                    className="h-full min-h-0 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-label leading-5 outline-none disabled:opacity-60 max-workbench:py-3"
                    disabled={isPending || result !== null}
                    id="commit-message"
                    onChange={(event) => {
                      setMessage(event.currentTarget.value);
                    }}
                    placeholder={t("commit.messagePlaceholder")}
                    rows={1}
                    value={message}
                  />
                  <InputGroupAddon align="inline-end" className="ml-auto">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PromptInputButton
                          aria-label={t("commit.generateMessage")}
                          className="size-7 shrink-0 justify-center p-0 [&_svg]:size-3.5 max-workbench:size-11"
                          disabled={!canGenerate}
                          onClick={() => {
                            void generateMessage().catch(() => undefined);
                          }}
                          type="button"
                        >
                          {isGenerating ? (
                            <LoaderCircle aria-hidden="true" className="animate-spin" />
                          ) : (
                            <Sparkles aria-hidden="true" />
                          )}
                        </PromptInputButton>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t("commit.generateMessage")}</TooltipContent>
                    </Tooltip>
                  </InputGroupAddon>
                </InputGroup>

                {result === null ? (
                  <ButtonGroup className="mt-2 w-full">
                    <Button
                      className="flex-1 rounded-r-none"
                      disabled={!canCommit}
                      onClick={() => {
                        void commit("commit").catch(() => undefined);
                      }}
                      type="button"
                    >
                      {isCommitting ? (
                        <LoaderCircle
                          aria-hidden="true"
                          className="size-3.5 animate-spin"
                          data-icon="inline-start"
                        />
                      ) : (
                        <Check aria-hidden="true" className="size-3.5" data-icon="inline-start" />
                      )}
                      {t("commit.commit")}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={t("commit.commitActions")}
                          className="w-10 rounded-l-none border-l border-primary-foreground/30 px-0"
                          disabled={!canCommit}
                          type="button"
                        >
                          <ChevronDown aria-hidden="true" className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            onSelect={() => {
                              void commit("commit").catch(() => undefined);
                            }}
                          >
                            <Check aria-hidden="true" className="size-3.5" />
                            {t("commit.commit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              void commit("commit_and_push").catch(() => undefined);
                            }}
                          >
                            <Upload aria-hidden="true" className="size-3.5" />
                            {t("commit.commitAndPush")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ButtonGroup>
                ) : (
                  <div className="mt-2" role="status">
                    <p className="text-label font-medium">{t(commitResultMessageKey(result))}</p>
                    <p className="mt-1 font-mono text-caption text-muted-foreground">
                      {result.commitSha.slice(0, 7)}
                    </p>
                  </div>
                )}
              </section>

              {/* 两个可折叠模块共享剩余视口高度，长内容只在各自区域内部滚动。 */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Collapsible
                  className={cn(
                    "flex min-h-0 flex-col border-t border-separator",
                    changesOpen ? "flex-[3_1_0%]" : "shrink-0",
                  )}
                  onOpenChange={setChangesOpen}
                  open={changesOpen}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      className="group flex h-8 w-full shrink-0 items-center gap-1.5 px-3 text-left text-label font-semibold hover:bg-control-hover max-workbench:h-11"
                      type="button"
                      variant="ghost"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
                      />
                      <span>{t("commit.changes")}</span>
                      <span className="ml-auto text-caption font-normal text-muted-foreground">
                        {t("commit.totalFiles", { count: entries.length })}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="min-h-0 flex-1 overflow-hidden">
                    <div
                      className="h-full overflow-y-auto overscroll-contain py-0.5"
                      data-slot="commit-changes-scroll"
                    >
                      <CommitChangesTreeSection
                        changes={gitStatus.staged}
                        disabled={isPending || result !== null}
                        label={t("commit.staged")}
                        onOpenFileDiff={onOpenFileDiff}
                        onSelectedPathsChange={setSelectedPaths}
                        selectedPaths={selectedPaths}
                      />
                      <CommitChangesTreeSection
                        changes={gitStatus.unstaged}
                        disabled={isPending || result !== null}
                        label={t("commit.unstaged")}
                        onOpenFileDiff={onOpenFileDiff}
                        onSelectedPathsChange={setSelectedPaths}
                        selectedPaths={selectedPaths}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible
                  className={cn(
                    "flex min-h-0 flex-col border-t border-separator",
                    historyOpen ? "flex-[2_1_0%]" : "shrink-0",
                  )}
                  onOpenChange={setHistoryOpen}
                  open={historyOpen}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      className="group flex h-8 w-full shrink-0 items-center gap-1.5 px-3 text-left text-label font-semibold hover:bg-control-hover max-workbench:h-11"
                      type="button"
                      variant="ghost"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
                      />
                      <span>{t("commit.history")}</span>
                      <span
                        aria-hidden="true"
                        className="ml-auto max-w-[55%] truncate text-caption font-normal text-muted-foreground"
                        title={displayBranch}
                      >
                        {displayBranch}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="min-h-0 flex-1 overflow-hidden">
                    <div className="h-full min-h-0" data-slot="commit-history-scroll">
                      <GitHistoryList
                        client={client}
                        compact
                        dateFormatter={dateFormatter}
                        panelId="commit-git-history"
                        projectId={projectId}
                        {...(selectedRepository === null ? {} : { repository: selectedRepository })}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
