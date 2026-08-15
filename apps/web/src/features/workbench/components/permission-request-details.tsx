import type { PendingRequest } from "@code-agent/protocol";

import { useTranslation } from "../../../i18n/i18n.js";

type PermissionProfile = Extract<PendingRequest, { type: "permissions_approval" }>["permissions"];
type FileSystemPath = NonNullable<
  NonNullable<PermissionProfile["fileSystem"]>["entries"]
>[number]["path"];

type PermissionItem = Readonly<{
  access: "deny" | "network" | "read" | "write";
  key: string;
  value: string;
}>;

function specialPathLabel(path: Extract<FileSystemPath, { type: "special" }>): string {
  switch (path.value.kind) {
    case "root":
      return "/";
    case "minimal":
      return "minimal";
    case "project_roots":
      return path.value.subpath === null ? "project roots" : `project roots/${path.value.subpath}`;
    case "tmpdir":
      return "system tmpdir";
    case "slash_tmp":
      return "/tmp";
    case "unknown":
      return path.value.subpath === null
        ? path.value.path
        : `${path.value.path}/${path.value.subpath}`;
  }
}

function fileSystemPathLabel(path: FileSystemPath): string {
  switch (path.type) {
    case "path":
      return path.path;
    case "glob_pattern":
      return path.pattern;
    case "special":
      return specialPathLabel(path);
  }
}

function permissionItems(profile: PermissionProfile): PermissionItem[] {
  const items: PermissionItem[] = [];
  if (profile.network !== null && profile.network.enabled !== null) {
    items.push({ access: "network", key: "network", value: String(profile.network.enabled) });
  }
  const fileSystem = profile.fileSystem;
  if (fileSystem === null) return items;
  fileSystem.read?.forEach((path, index) => {
    items.push({ access: "read", key: `fileSystem.read.${String(index)}`, value: path });
  });
  fileSystem.write?.forEach((path, index) => {
    items.push({ access: "write", key: `fileSystem.write.${String(index)}`, value: path });
  });
  fileSystem.entries?.forEach((entry, index) => {
    items.push({
      access: entry.access,
      key: `fileSystem.entries.${String(index)}`,
      value: fileSystemPathLabel(entry.path),
    });
  });
  return items;
}

export function allPermissionKeys(profile: PermissionProfile): ReadonlySet<string> {
  return new Set(permissionItems(profile).map((item) => item.key));
}

export function selectPermissionProfile(
  profile: PermissionProfile,
  selected: ReadonlySet<string>,
): PermissionProfile {
  const fileSystem = profile.fileSystem;
  const read = fileSystem?.read?.filter((_, index) =>
    selected.has(`fileSystem.read.${String(index)}`),
  );
  const write = fileSystem?.write?.filter((_, index) =>
    selected.has(`fileSystem.write.${String(index)}`),
  );
  const entries = fileSystem?.entries?.filter((_, index) =>
    selected.has(`fileSystem.entries.${String(index)}`),
  );
  const hasFileSystem =
    (read?.length ?? 0) > 0 || (write?.length ?? 0) > 0 || (entries?.length ?? 0) > 0;
  return {
    fileSystem:
      fileSystem === null || !hasFileSystem
        ? null
        : {
            entries: entries?.length ? entries : null,
            globScanMaxDepth: fileSystem.globScanMaxDepth,
            read: read?.length ? read : null,
            write: write?.length ? write : null,
          },
    network: selected.has("network") ? profile.network : null,
  };
}

type PermissionRequestDetailsProps = Readonly<{
  disabled?: boolean;
  onToggle?: (key: string) => void;
  profile: PermissionProfile;
  selected?: ReadonlySet<string>;
}>;

export function PermissionRequestDetails({
  disabled = false,
  onToggle,
  profile,
  selected,
}: PermissionRequestDetailsProps) {
  const { t } = useTranslation("workbench");
  const items = permissionItems(profile);
  return (
    <ul className="mt-2 divide-y divide-border border-y border-border">
      {items.map((item) => {
        const content = (
          <>
            <span className="w-20 shrink-0 text-meta font-medium text-muted-foreground">
              {item.access === "network"
                ? t("pending.networkPermission")
                : t(`pending.${item.access}Permission`)}
            </span>
            <code className="min-w-0 break-all font-mono text-meta text-foreground">
              {item.access === "network" ? t("pending.enabled") : item.value}
            </code>
          </>
        );
        return (
          <li className="py-2" key={item.key}>
            {selected === undefined ? (
              <div className="flex items-start gap-2">{content}</div>
            ) : (
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  checked={selected.has(item.key)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  disabled={disabled}
                  onChange={() => onToggle?.(item.key)}
                  type="checkbox"
                />
                {content}
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}
