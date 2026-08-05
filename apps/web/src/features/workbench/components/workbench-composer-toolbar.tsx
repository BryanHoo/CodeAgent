import { Bug, CircleGauge, FilePlus2, GitFork, Lightbulb, X } from "lucide-react";
import type { PromptCommandAction } from "./prompt-command.js";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "../../../shared/ai-elements/attachments.js";
import {
  PromptInputButton,
  PromptInputHeader,
  usePromptInputAttachments,
} from "../../../shared/ai-elements/prompt-input.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/ui/tooltip.js";

export function PromptCommandIcon({ action }: Readonly<{ action: PromptCommandAction }>) {
  const className = "size-4 shrink-0 text-primary";
  switch (action) {
    case "review":
      return <Bug aria-hidden="true" className={className} />;
    case "initialize":
      return <FilePlus2 aria-hidden="true" className={className} />;
    case "compact":
      return <CircleGauge aria-hidden="true" className={className} />;
    case "fork":
      return <GitFork aria-hidden="true" className={className} />;
    case "plan":
      return <Lightbulb aria-hidden="true" className={className} />;
  }
}

export function PlanModeTag({
  disabled,
  onRemove,
}: Readonly<{ disabled: boolean; onRemove: () => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton
          aria-label={t("composer.cancelPlanMode")}
          className="group/plan-mode gap-1 px-1.5 text-foreground max-workbench:gap-0.5"
          data-plan-mode=""
          disabled={disabled}
          onClick={onRemove}
        >
          <Lightbulb aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
          <span className="max-workbench:hidden">{t("composer.planMode")}</span>
          <X
            aria-hidden="true"
            className="size-3 shrink-0 opacity-0 transition-opacity group-hover/plan-mode:opacity-100 group-focus-visible/plan-mode:opacity-100"
          />
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>{t("composer.cancelPlanMode")}</TooltipContent>
    </Tooltip>
  );
}

export function ComposerAttachments() {
  const { t } = useTranslation("workbench");
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) {
    return null;
  }
  return (
    <PromptInputHeader>
      <Attachments aria-label={t("composer.addedAttachments")}>
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
