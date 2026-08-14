import { LoaderCircle, Pencil, SendHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { QueuedComposerPrompt } from "../composer-draft-context.js";
import { resolveQueuedPromptSummary } from "./workbench-composer-view-contracts.js";

export function ComposerQueuedPrompts({
  activeTurnId,
  canEdit,
  canSteer,
  isSubmitting,
  onEdit,
  onRemove,
  onSteer,
  prompts,
}: Readonly<{
  activeTurnId: string | undefined;
  canEdit: boolean;
  canSteer: boolean;
  isSubmitting: boolean;
  onEdit: (prompt: QueuedComposerPrompt) => void;
  onRemove: (promptId: string) => void;
  onSteer: (prompt: QueuedComposerPrompt) => void;
  prompts: readonly QueuedComposerPrompt[];
}>) {
  const { t } = useTranslation("workbench");
  const visiblePrompts = prompts.filter((prompt) => prompt.presentation === "queue");
  if (visiblePrompts.length === 0) return null;

  return (
    <div aria-label={t("composer.queuedMessages")} className="mb-2 space-y-1.5" role="list">
      {visiblePrompts.map((prompt) => {
        const summary = resolveQueuedPromptSummary(
          prompt,
          t("composer.attachmentCount", { count: prompt.files.length }),
        );
        const waiting = prompt.deliveryState === "awaiting_acknowledgement";
        return (
          <div
            className="flex min-w-0 items-center gap-2 rounded-control border border-separator bg-control px-2 py-1.5"
            key={prompt.id}
            role="listitem"
          >
            <span className="min-w-0 flex-1 truncate text-label text-foreground">{summary}</span>
            {waiting ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 text-caption text-muted-foreground"
                role="status"
              >
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                {t("composer.waitingToSend")}
              </span>
            ) : (
              <>
                <QueueAction
                  label={t("composer.editQueued", { summary })}
                  onClick={() => {
                    onEdit(prompt);
                  }}
                  tooltip={t("composer.editQueuedTooltip")}
                  disabled={!canEdit || isSubmitting}
                >
                  <Pencil aria-hidden="true" className="size-3.5" />
                </QueueAction>
                <QueueAction
                  label={t("composer.steerNow", { summary })}
                  onClick={() => {
                    onSteer(prompt);
                  }}
                  tooltip={t("composer.steerNowTooltip")}
                  disabled={!canSteer || activeTurnId === undefined || isSubmitting}
                >
                  <SendHorizontal aria-hidden="true" className="size-3.5" />
                </QueueAction>
                <QueueAction
                  danger
                  label={t("composer.cancelQueued", { summary })}
                  onClick={() => {
                    onRemove(prompt.id);
                  }}
                  tooltip={t("composer.cancelQueuedTooltip")}
                  disabled={isSubmitting}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </QueueAction>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QueueAction({
  children,
  danger = false,
  disabled,
  label,
  onClick,
  tooltip,
}: Readonly<{
  children: ReactNode;
  danger?: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  tooltip: string;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={danger ? "hover:text-danger" : "hover:text-brand"}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerWaitingForAcknowledgement() {
  const { t } = useTranslation("workbench");
  return (
    <p
      className="inline-flex items-center gap-1 px-1 pb-1 text-label text-muted-foreground"
      role="status"
    >
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      {t("composer.waitingToSend")}
    </p>
  );
}
