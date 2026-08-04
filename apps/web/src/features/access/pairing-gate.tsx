import { ArrowRight, KeyRound, RotateCw } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { useTranslation } from "../../i18n/i18n.js";
import type { AccessError } from "./access-context.js";

export function PairingGate({
  error,
  loading,
  onPair,
  onRetry,
  pairing,
}: Readonly<{
  error: AccessError;
  loading: boolean;
  onPair: (code: string) => Promise<void>;
  onRetry: () => void;
  pairing: boolean;
}>) {
  const { t } = useTranslation("common");
  const [code, setCode] = useState("");

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = code.trim();
    if (value.length > 0 && !pairing) {
      void onPair(value);
    }
  };

  return (
    <main className="access-gate grid min-h-dvh place-items-center bg-window px-5 py-10 text-foreground">
      <section aria-labelledby="access-gate-title" className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="access-gate-mark" aria-hidden="true" />
          <h1 className="text-title font-semibold" id="access-gate-title">
            CodeAgent
          </h1>
        </div>

        {loading ? (
          <p className="text-body-small text-muted-foreground" role="status">
            {t("access.checking")}
          </p>
        ) : error === "load" ? (
          <div className="space-y-4" role="alert">
            <p className="text-body-small text-danger">{t("access.loadError")}</p>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-control bg-control px-3 text-body-small font-medium hover:bg-control-hover focus-visible:shadow-focus"
              onClick={onRetry}
              type="button"
            >
              <RotateCw aria-hidden="true" className="size-4" />
              {t("actions.retry")}
            </button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submit}>
            <div>
              <p className="text-heading font-semibold">{t("access.pairingTitle")}</p>
              <p className="mt-1 text-body-small text-muted-foreground">
                {t("access.pairingDescription")}
              </p>
            </div>
            <label className="block text-body-small font-medium" htmlFor="access-pairing-code">
              {t("access.codeLabel")}
            </label>
            <div className="flex h-10 items-center rounded-control border border-separator-strong bg-panel focus-within:border-accent focus-within:shadow-focus">
              <KeyRound aria-hidden="true" className="ml-3 size-4 shrink-0 text-muted-foreground" />
              <input
                aria-label={t("access.codeLabel")}
                autoComplete="one-time-code"
                className="access-code-input min-w-0 flex-1 bg-transparent px-3 font-mono text-body"
                id="access-pairing-code"
                onChange={(event) => {
                  setCode(event.currentTarget.value);
                }}
                spellCheck={false}
                type="password"
                value={code}
              />
              <button
                aria-label={t("access.pair")}
                className="mr-1 inline-grid size-8 place-items-center rounded-control bg-accent text-white hover:bg-accent-strong focus-visible:shadow-focus disabled:opacity-50"
                disabled={pairing || code.trim().length === 0}
                title={t("access.pair")}
                type="submit"
              >
                <ArrowRight aria-hidden="true" className="size-4" />
              </button>
            </div>
            {pairing ? (
              <p className="text-meta text-muted-foreground" role="status">
                {t("access.pairing")}
              </p>
            ) : error === "pairing" ? (
              <p className="text-meta text-danger" role="alert">
                {t("access.pairingError")}
              </p>
            ) : null}
          </form>
        )}
      </section>
    </main>
  );
}
