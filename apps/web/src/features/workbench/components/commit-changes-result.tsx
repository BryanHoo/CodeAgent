import type { CommitProjectChangesResponse } from "@code-agent/protocol";

import { useTranslation } from "../../../i18n/i18n.js";
import { useErrorToast } from "../../../shared/errors/error-toast.js";

function resultMessageKey(result: CommitProjectChangesResponse): string {
  return result.pushStatus === "pushed" ? "commit.commitAndPushComplete" : "commit.commitComplete";
}

export function CommitChangesResult({
  result,
}: Readonly<{ result: CommitProjectChangesResponse }>) {
  const { t } = useTranslation("workbench");
  useErrorToast(result.pushError);
  useErrorToast(
    result.pushStatus === "not_configured" ? t("commit.commitCompleteUpstreamMissing") : null,
  );

  return (
    <div className="mt-2" role="status">
      <p className="text-label font-medium">{t(resultMessageKey(result))}</p>
      <p className="mt-1 font-mono text-caption text-muted-foreground">
        {result.commitSha.slice(0, 7)}
      </p>
    </div>
  );
}
