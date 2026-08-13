import type { HostFileKind } from "@code-agent/protocol";
import { useCallback, useRef, useState } from "react";

import { codeAgentClient } from "../../../app/create-host-client.js";
import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import { HostFilePickerDialog } from "../../projects/components/host-file-picker-dialog.js";
import type { CodeAgentHostAttachmentClient } from "../../projects/project-queries.js";
import { resolveIdempotencyAttempt, type IdempotencyAttempt } from "../composer-state.js";

type HostAttachmentPickerDialogProps = Readonly<{
  client: CodeAgentHostAttachmentClient;
  kind: HostFileKind;
  onAdd: (attachment: PromptInputAttachment) => void;
  onClose: () => void;
  projectId: string;
}>;

export function HostAttachmentPickerDialog({
  client,
  kind,
  onAdd,
  onClose,
  projectId,
}: HostAttachmentPickerDialogProps) {
  const [importError, setImportError] = useState<Error | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importLockRef = useRef(false);
  const importAttemptRef = useRef<IdempotencyAttempt | undefined>(undefined);
  const loadDirectory = useCallback(
    (path: string | undefined, showHidden: boolean, signal: AbortSignal) =>
      client.listHostFiles(kind, path, showHidden, { signal }),
    [client, kind],
  );
  const importFile = useCallback(
    async (path: string) => {
      if (importLockRef.current) return;
      importLockRef.current = true;
      setIsImporting(true);
      setImportError(null);
      const attempt = resolveIdempotencyAttempt(
        importAttemptRef.current,
        `${projectId}:${kind}:${path}`,
      );
      importAttemptRef.current = attempt;
      try {
        const response = await client.importHostAttachment(projectId, kind, path, {
          idempotencyKey: attempt.key,
        });
        if (response.attachment.kind !== kind) {
          throw new TypeError("Imported attachment kind does not match the selection");
        }
        onAdd({
          attachment: response.attachment,
          ...response.attachment,
          previewUrl:
            kind === "image"
              ? codeAgentClient.resolveAssetUrl({
                  attachmentId: response.attachment.id,
                  kind: "project-attachment",
                  path: response.attachment.id,
                  projectId,
                })
              : "",
          source: "host",
        });
        importAttemptRef.current = undefined;
      } catch (error) {
        setImportError(error instanceof Error ? error : new Error("Host attachment import failed"));
      } finally {
        importLockRef.current = false;
        setIsImporting(false);
      }
    },
    [client, kind, onAdd, projectId],
  );

  return (
    <HostFilePickerDialog
      error={importError}
      isConfirming={isImporting}
      loadDirectory={loadDirectory}
      mode={kind}
      onClose={onClose}
      onConfirm={importFile}
    />
  );
}
