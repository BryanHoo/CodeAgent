import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, MessageCircleQuestion, X, type LucideIcon } from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../shared/components/core/tooltip.js";
import type { TaskStore } from "../../conversation/runtime/task-store-core.js";
import { createAsyncQuestionProjection, type QuestionEntry } from "./async-question-projection.js";
import { dismissQuestion, useAsyncQuestionSession } from "./async-question-session.js";
import { AsyncQuestions } from "./async-questions.js";

export function AsyncQuestionDock({ taskStore }: Readonly<{ taskStore: TaskStore | undefined }>) {
  const session = useAsyncQuestionSession();
  const projection = useMemo(() => createAsyncQuestionProjection(taskStore), [taskStore]);
  const entries = useSyncExternalStore(projection.subscribe, projection.getSnapshot);
  return session === null ? null : <QuestionDockContent entries={entries} session={session} />;
}

function QuestionDockContent({ entries, session }: Readonly<{
  entries: readonly QuestionEntry[];
  session: NonNullable<ReturnType<typeof useAsyncQuestionSession>>;
}>) {
  const { t } = useTranslation("conversation");
  const pending = useStore(session.store, useShallow((state) =>
    entries.filter((entry) => {
      const status = state.drafts.get(entry.item.id)?.status;
      return status !== "sent" && status !== "dismissed";
    })));
  const [selectedKey, setSelectedKey] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const selectedIndex = Math.max(0, pending.findIndex((entry) => entry.key === selectedKey));
  const selected = pending[selectedIndex];
  const sending = useStore(session.store, (state) =>
    selected !== undefined && state.drafts.get(selected.item.id)?.status === "sending");
  if (selected === undefined) return null;

  return (
    <section aria-label={t("asyncQuestions.pending")} className="w-full shrink-0 min-w-0 border-b border-separator bg-content px-5 pb-2">
      <div className="flex min-w-0 items-center gap-2 pt-2 pb-1">
        <MessageCircleQuestion aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-label font-medium">
          {t("asyncQuestions.pendingCount", { count: pending.length })}
        </span>
        {pending.length < 2 ? null : (
          <>
            <DockButton icon={ChevronLeft} label={t("asyncQuestions.previous")} disabled={selectedIndex === 0}
              onClick={() => setSelectedKey(pending[selectedIndex - 1]!.key)} />
            <span className="min-w-12 text-center text-caption tabular-nums">{selectedIndex + 1}/{pending.length}</span>
            <DockButton icon={ChevronRight} label={t("asyncQuestions.next")} disabled={selectedIndex === pending.length - 1}
              onClick={() => setSelectedKey(pending[selectedIndex + 1]!.key)} />
          </>
        )}
        <DockButton icon={collapsed ? ChevronUp : ChevronDown} label={t(collapsed ? "asyncQuestions.expand" : "asyncQuestions.collapse")}
          controls={contentId} expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} />
        <DockButton icon={X} label={t("asyncQuestions.dismiss")} disabled={sending}
          onClick={() => dismissQuestion(session.store, selected.item.id)} />
      </div>
      {/* 问答区独立滚动且限制高度，不改变时间线的虚拟滚动容器。 */}
      <div id={contentId} hidden={collapsed} className="max-h-[min(32vh,20rem)] overflow-y-auto overscroll-contain py-2">
        <AsyncQuestions key={selected.key} item={selected.item} />
      </div>
    </section>
  );
}

function DockButton({ label, disabled, controls, expanded, onClick, icon: Icon }: Readonly<{
  label: string;
  disabled?: boolean;
  controls?: string;
  expanded?: boolean;
  onClick: () => void;
  icon: LucideIcon;
}>) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-controls={controls}
        aria-expanded={expanded} disabled={disabled} onClick={onClick}>
        <Icon className="size-3.5" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>;
}
