import type {
  AgentGlobalSettings,
  AgentModel,
  AgentProjectDefaults,
  ProjectOpenApp,
} from "@code-agent/protocol";
import { Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PromptInputSelect } from "../../../shared/ai-elements/prompt-input.js";

type ApprovalMode = AgentGlobalSettings["approvalPolicy"] | "auto-review";

const reasoningEffortLabels: Readonly<Record<string, string>> = {
  high: "高",
  low: "低",
  max: "最大",
  medium: "中",
  minimal: "最低",
  ultra: "超高",
  xhigh: "极高",
};

export function resolveGlobalSettingsModel(
  models: readonly AgentModel[],
  modelId: string,
  requestedEffort: string,
): Pick<AgentProjectDefaults, "model" | "reasoningEffort"> {
  const model = models.find((item) => item.id === modelId);
  if (model === undefined) {
    return { model: modelId, reasoningEffort: requestedEffort };
  }
  const reasoningEffort = model.supportedReasoningEfforts.some(
    (effort) => effort.id === requestedEffort,
  )
    ? requestedEffort
    : model.defaultReasoningEffort;
  return { model: model.id, reasoningEffort };
}

function deriveApprovalMode(settings: AgentGlobalSettings): ApprovalMode {
  return settings.approvalsReviewer === "auto_review" ? "auto-review" : settings.approvalPolicy;
}

function applyApprovalMode(settings: AgentGlobalSettings, mode: ApprovalMode): AgentGlobalSettings {
  // 自动审批由 on-request 与 auto_review 共同表达，不能映射为权限更宽的 never。
  return mode === "auto-review"
    ? { ...settings, approvalPolicy: "on-request", approvalsReviewer: "auto_review" }
    : { ...settings, approvalPolicy: mode, approvalsReviewer: "user" };
}

function createFallbackSettings(models: readonly AgentModel[]): AgentGlobalSettings {
  const model = models.find((item) => item.isDefault) ?? models[0];
  return {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    defaultOpenAppId: null,
    model: model?.id ?? "",
    reasoningEffort: model?.defaultReasoningEffort ?? "",
    sandboxMode: "workspace-write",
  };
}

type GlobalSettingsDialogProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  error: Error | null;
  isPending: boolean;
  models: readonly AgentModel[];
  onClose: () => void;
  onRetry: () => unknown;
  onSave: (settings: AgentGlobalSettings) => Promise<void>;
  settings?: AgentGlobalSettings;
}>;

export function GlobalSettingsDialog({
  apps,
  error,
  isPending,
  models,
  onClose,
  onRetry,
  onSave,
  settings,
}: GlobalSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<AgentGlobalSettings>(
    () => settings ?? createFallbackSettings(models),
  );
  const [saveError, setSaveError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const selectedModel = models.find((model) => model.id === draft.model);

  useEffect(() => {
    if (settings !== undefined) {
      setDraft(settings);
    }
  }, [settings]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      // 原生 dialog 统一负责焦点圈定和 Escape 行为。
      dialog.showModal();
    }
  }, []);

  const close = () => {
    if (!isSaving) {
      onClose();
    }
  };

  return (
    <dialog
      aria-labelledby="global-settings-title"
      className="file-diff-dialog m-auto max-h-[min(88vh,42rem)] w-[min(92vw,40rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
      ref={dialogRef}
      role="dialog"
    >
      <form
        className="grid max-h-[min(88vh,42rem)] grid-rows-[auto_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (settings === undefined || isPending || isSaving) {
            return;
          }
          setSaveError(false);
          setIsSaving(true);
          void onSave(draft)
            .then(onClose)
            .catch(() => {
              setSaveError(true);
            })
            .finally(() => {
              setIsSaving(false);
            });
        }}
      >
        <header className="flex h-12 items-center gap-2.5 px-4 shadow-toolbar">
          <Settings className="size-4 text-accent" aria-hidden="true" />
          <h2
            className="min-w-0 flex-1 truncate text-heading font-semibold"
            id="global-settings-title"
          >
            全局设置
          </h2>
          <button
            aria-label="关闭全局设置"
            className="inline-grid size-8 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground focus-visible:shadow-focus disabled:opacity-50"
            disabled={isSaving}
            onClick={close}
            type="button"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-2 sm:px-5">
          {error !== null ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3" role="alert">
              <p className="text-body-small text-danger">无法加载全局设置</p>
              <button
                className="h-8 rounded-control bg-control px-3 text-body-small font-medium hover:bg-control-hover"
                onClick={() => void onRetry()}
                type="button"
              >
                重试
              </button>
            </div>
          ) : isPending || settings === undefined ? (
            <div
              className="grid min-h-40 place-items-center text-body-small text-muted-foreground"
              role="status"
            >
              正在加载全局设置
            </div>
          ) : (
            <div className="divide-y divide-separator">
              <SettingsField label="审批">
                <PromptInputSelect
                  aria-label="审批"
                  className="h-9 w-full max-w-none bg-control px-2.5 text-body-small text-foreground"
                  disabled={isSaving}
                  onChange={(event) => {
                    const mode = event.currentTarget.value as ApprovalMode;
                    setDraft((current) => applyApprovalMode(current, mode));
                  }}
                  value={deriveApprovalMode(draft)}
                >
                  <option value="untrusted">仅不受信任操作</option>
                  <option value="on-request">按需审批</option>
                  <option value="auto-review">自动审批</option>
                  <option value="never">从不询问</option>
                </PromptInputSelect>
              </SettingsField>

              <SettingsField label="工作区">
                <PromptInputSelect
                  aria-label="工作区"
                  className="h-9 w-full max-w-none bg-control px-2.5 text-body-small text-foreground"
                  disabled={isSaving}
                  onChange={(event) => {
                    const sandboxMode = event.currentTarget
                      .value as AgentGlobalSettings["sandboxMode"];
                    setDraft((current) => ({
                      ...current,
                      sandboxMode,
                    }));
                  }}
                  value={draft.sandboxMode}
                >
                  <option value="read-only">只读</option>
                  <option value="workspace-write">工作区可写</option>
                  <option value="danger-full-access">完全访问</option>
                </PromptInputSelect>
              </SettingsField>

              <SettingsField label="模型">
                <PromptInputSelect
                  aria-label="模型"
                  className="h-9 w-full max-w-none bg-control px-2.5 text-body-small text-foreground"
                  disabled={isSaving}
                  onChange={(event) => {
                    const modelId = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      ...resolveGlobalSettingsModel(models, modelId, current.reasoningEffort),
                    }));
                  }}
                  value={draft.model}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </PromptInputSelect>
              </SettingsField>

              <SettingsField label="思考">
                <PromptInputSelect
                  aria-label="思考"
                  className="h-9 w-full max-w-none bg-control px-2.5 text-body-small text-foreground"
                  disabled={isSaving || selectedModel === undefined}
                  onChange={(event) => {
                    const reasoningEffort = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      reasoningEffort,
                    }));
                  }}
                  value={draft.reasoningEffort}
                >
                  {selectedModel?.supportedReasoningEfforts.map((effort) => (
                    <option key={effort.id} value={effort.id}>
                      {reasoningEffortLabels[effort.id] ?? effort.id}
                    </option>
                  ))}
                </PromptInputSelect>
              </SettingsField>

              <SettingsField label="默认打开方式">
                <PromptInputSelect
                  aria-label="默认打开方式"
                  className="h-9 w-full max-w-none bg-control px-2.5 text-body-small text-foreground"
                  disabled={isSaving}
                  onChange={(event) => {
                    const appId = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      defaultOpenAppId:
                        appId === "" ? null : (appId as AgentGlobalSettings["defaultOpenAppId"]),
                    }));
                  }}
                  value={draft.defaultOpenAppId ?? ""}
                >
                  <option value="">自动选择</option>
                  {apps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.name}
                    </option>
                  ))}
                </PromptInputSelect>
              </SettingsField>
            </div>
          )}
        </div>

        <footer className="flex min-h-14 items-center justify-end gap-2 px-4 shadow-[0_-1px_0_var(--ui-color-separator)] sm:px-5">
          {saveError ? (
            <p className="mr-auto text-meta text-danger" role="alert">
              无法保存全局设置
            </p>
          ) : null}
          <button
            className="h-8 rounded-control px-3 text-body-small text-muted-foreground hover:bg-control-hover hover:text-foreground disabled:opacity-50"
            disabled={isSaving}
            onClick={close}
            type="button"
          >
            取消
          </button>
          <button
            className="h-8 rounded-control bg-accent px-3 text-body-small font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            disabled={isPending || isSaving || settings === undefined}
            type="submit"
          >
            {isSaving ? "正在保存" : "保存全局默认"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function SettingsField({
  children,
  label,
}: Readonly<{ children: React.ReactNode; label: string }>) {
  return (
    <div className="grid min-h-16 items-center gap-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <span className="text-body-small font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}
