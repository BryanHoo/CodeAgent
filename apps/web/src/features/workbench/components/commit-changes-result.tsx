import type { CommitProjectChangesResponse } from "@code-agent/protocol";

import { useTranslation } from "../../../i18n/i18n.js";

function resultMessageKey(result: CommitProjectChangesResponse): string {
  if (result.pushStatus === "failed") return "commit.commitCompletePushFailed";
  if (result.pushStatus === "not_configured") return "commit.commitCompleteUpstreamMissing";
  return result.pushStatus === "pushed" ? "commit.commitAndPushComplete" : "commit.commitComplete";
}

export function CommitChangesResult({
  result,
}: Readonly<{ result: CommitProjectChangesResponse }>) {
  const { t } = useTranslation("workbench");

  return (
    <div className="mt-2" role="status">
      <p className="text-label font-medium">{t(resultMessageKey(result))}</p>
      <p className="mt-1 font-mono text-caption text-muted-foreground">
        {result.commitSha.slice(0, 7)}
      </p>
      {result.pushError === null ? null : (
        <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words font-mono text-caption text-danger">
          {result.pushError.message}
        </p>
      )}
    </div>
  );
}
