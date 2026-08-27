import {
  ChevronDownIcon,
  ChevronRightIcon,
  Clock3Icon,
  FileCode2Icon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
} from "lucide-react";

type TreeEntry = {
  name: string;
  depth: number;
  kind: "folder" | "file";
  open?: boolean;
};

// 静态树数据保持显式层级，便于准确复刻桌面 IDE 的紧凑缩进。
const TREE_ENTRIES: TreeEntry[] = [
  { name: "CodeAgent", depth: 0, kind: "folder", open: true },
  { name: ".github", depth: 1, kind: "folder" },
  { name: ".superwork", depth: 1, kind: "folder" },
  { name: ".vscode", depth: 1, kind: "folder" },
  { name: "docs", depth: 1, kind: "folder" },
  { name: "public", depth: 1, kind: "folder" },
  { name: "scripts", depth: 1, kind: "folder" },
  { name: "src", depth: 1, kind: "folder" },
  { name: "src-tauri", depth: 1, kind: "folder" },
  { name: ".editorconfig", depth: 1, kind: "file" },
  { name: ".gitattributes", depth: 1, kind: "file" },
  { name: ".gitignore", depth: 1, kind: "file" },
  { name: ".oxlintrc.json", depth: 1, kind: "file" },
  { name: "components.json", depth: 1, kind: "file" },
  { name: "index.html", depth: 1, kind: "file" },
  { name: "package.json", depth: 1, kind: "file" },
  { name: "pnpm-lock.yaml", depth: 1, kind: "file" },
  { name: "README.md", depth: 1, kind: "file" },
  { name: "rust-toolchain.toml", depth: 1, kind: "file" },
  { name: "SECURITY.md", depth: 1, kind: "file" },
  { name: "tsconfig.app.json", depth: 1, kind: "file" },
  { name: "tsconfig.json", depth: 1, kind: "file" },
  { name: "vite.config.ts", depth: 1, kind: "file" },
];

function TreeIcon({ entry }: { entry: TreeEntry }) {
  if (entry.kind === "folder") {
    return entry.open ? <FolderOpenIcon aria-hidden="true" /> : <FolderIcon aria-hidden="true" />;
  }

  return entry.name.endsWith(".json") || entry.name.endsWith(".ts") ? (
    <FileCode2Icon aria-hidden="true" />
  ) : (
    <FileIcon aria-hidden="true" />
  );
}

export function ProjectPanel() {
  return (
    <aside className="project-panel" id="project-panel" aria-label="项目文件">
      <header className="project-tabs">
        <button className="project-tab project-tab-active" type="button">
          <GitBranchIcon aria-hidden="true" />
          <span>项目</span>
        </button>
        <button className="project-tab" type="button">
          <Clock3Icon aria-hidden="true" />
          <span>历史</span>
        </button>
      </header>

      <div className="file-tree" role="tree" aria-label="CodeAgent 文件树">
        {TREE_ENTRIES.map((entry) => (
          <button
            className={`tree-row tree-row-${entry.kind}`}
            data-depth={entry.depth}
            key={entry.name}
            role="treeitem"
            type="button"
          >
            {entry.kind === "folder" ? (
              entry.open ? (
                <ChevronDownIcon className="tree-chevron" aria-hidden="true" />
              ) : (
                <ChevronRightIcon className="tree-chevron" aria-hidden="true" />
              )
            ) : (
              <span className="tree-chevron-placeholder" />
            )}
            <TreeIcon entry={entry} />
            <span>{entry.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
