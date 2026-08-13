import type { ProjectDirectoryListing } from "@code-agent/protocol";
import { useCallback } from "react";

import type { CodeAgentProjectDirectoryClient } from "../project-queries.js";
import { HostFilePickerDialog } from "./host-file-picker-dialog.js";

type ProjectDirectoryPickerDialogProps = Readonly<{
  addError: Error | null;
  client: CodeAgentProjectDirectoryClient;
  isAdding: boolean;
  onAdd: (path: string) => Promise<void> | void;
  onClose: () => void;
}>;

export function projectDirectoryListing(
  listing: ProjectDirectoryListing,
): ProjectDirectoryListing & {
  entries: readonly Readonly<{ name: string; path: string; type: "directory" }>[];
} {
  return {
    ...listing,
    entries: listing.entries.map((entry) => ({ ...entry, type: "directory" as const })),
  };
}

export function ProjectDirectoryPickerDialog({
  addError,
  client,
  isAdding,
  onAdd,
  onClose,
}: ProjectDirectoryPickerDialogProps) {
  const loadDirectory = useCallback(
    async (path: string | undefined, showHidden: boolean, signal: AbortSignal) =>
      projectDirectoryListing(await client.listProjectDirectories(path, showHidden, { signal })),
    [client],
  );

  return (
    <HostFilePickerDialog
      error={addError}
      isConfirming={isAdding}
      loadDirectory={loadDirectory}
      mode="directory"
      onClose={onClose}
      onConfirm={onAdd}
    />
  );
}
