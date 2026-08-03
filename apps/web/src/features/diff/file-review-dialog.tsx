import { ChevronDown, ChevronUp, FileCode2, Files, X } from "lucide-react";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { FileTree, FileTreeFile, FileTreeFolder } from "../../shared/ai-elements/file-tree.js";
import { IconButton } from "../../shared/ui/icon-button.js";
import { useTranslation } from "../../i18n/i18n.js";
import type { AgentFileChange } from "./file-change.js";
import { countFileChangeLines, getFileName } from "./file-change.js";

const PatchDiffViewer = lazy(() => import("./patch-diff-viewer.js"));

export type ReviewFileTreeFile = Readonly<{
  additions: number;
  changeIndex: number;
  name: string;
  path: string;
  removals: number;
  type: "file";
}>;

export type ReviewFileTreeFolder = Readonly<{
  children: readonly ReviewFileTreeNode[];
  name: string;
  path: string;
  type: "folder";
}>;

export type ReviewFileTreeNode = ReviewFileTreeFile | ReviewFileTreeFolder;

interface MutableReviewDirectory {
  directories: Map<string, MutableReviewDirectory>;
  files: ReviewFileTreeFile[];
  name: string;
  path: string;
}

function compareReviewTreeNames(
  left: Pick<ReviewFileTreeNode, "name">,
  right: Pick<ReviewFileTreeNode, "name">,
): number {
  return left.name.localeCompare(right.name, "en");
}

function buildReviewFileTreeFolder(directory: MutableReviewDirectory): ReviewFileTreeFolder {
  const compactNames = [directory.name];
  let compactDirectory = directory;

  // 没有直接文件和同级分支的目录不单独占一行，直到真正的内容层级才展开。
  while (compactDirectory.files.length === 0 && compactDirectory.directories.size === 1) {
    const child = compactDirectory.directories.values().next().value;
    if (child === undefined) {
      break;
    }
    compactNames.push(child.name);
    compactDirectory = child;
  }

  const directories = [...compactDirectory.directories.values()]
    .sort(compareReviewTreeNames)
    .map(buildReviewFileTreeFolder);
  const files = compactDirectory.files.toSorted(compareReviewTreeNames);
  return {
    children: [...directories, ...files],
    name: compactNames.join("/"),
    path: compactDirectory.path,
    type: "folder",
  };
}

export function buildReviewFileTree(
  changes: readonly AgentFileChange[],
): readonly ReviewFileTreeNode[] {
  const root: MutableReviewDirectory = {
    directories: new Map(),
    files: [],
    name: "",
    path: "",
  };

  changes.forEach((change, changeIndex) => {
    const segments = change.path.split(/[\\/]/);
    const name = segments.at(-1) ?? change.path;
    let directory = root;
    let directoryPath = "";

    for (const segment of segments.slice(0, -1)) {
      directoryPath = directoryPath.length === 0 ? segment : `${directoryPath}/${segment}`;
      let child = directory.directories.get(segment);
      if (child === undefined) {
        child = { directories: new Map(), files: [], name: segment, path: directoryPath };
        directory.directories.set(segment, child);
      }
      directory = child;
    }

    const { additions, removals } = countFileChangeLines(change);
    directory.files.push({
      additions,
      changeIndex,
      name,
      path: segments.join("/"),
      removals,
      type: "file",
    });
  });

  return [
    ...[...root.directories.values()].sort(compareReviewTreeNames).map(buildReviewFileTreeFolder),
    ...root.files.toSorted(compareReviewTreeNames),
  ];
}

function collectReviewFileTreeFolderPaths(
  nodes: readonly ReviewFileTreeNode[],
  paths = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.type === "folder") {
      paths.add(node.path);
      collectReviewFileTreeFolderPaths(node.children, paths);
    }
  }
  return paths;
}

type ReviewFileTreeNodesProps = Readonly<{
  fileLabel: (node: ReviewFileTreeFile) => string;
  nodes: readonly ReviewFileTreeNode[];
}>;

function ReviewFileTreeNodes({ fileLabel, nodes }: ReviewFileTreeNodesProps) {
  return nodes.map((node) =>
    node.type === "folder" ? (
      <FileTreeFolder key={node.path} name={node.name} path={node.path}>
        <ReviewFileTreeNodes fileLabel={fileLabel} nodes={node.children} />
      </FileTreeFolder>
    ) : (
      <FileTreeFile
        aria-label={fileLabel(node)}
        icon={<FileCode2 aria-hidden="true" className="size-3.5 text-muted-foreground" />}
        key={`${node.path}:${String(node.changeIndex)}`}
        name={node.name}
        path={node.path}
        trailing={
          <span aria-hidden="true" className="ml-auto flex shrink-0 items-center gap-1 text-meta">
            <span className="font-medium text-diff-added">+{node.additions}</span>
            <span className="font-medium text-diff-removed">-{node.removals}</span>
          </span>
        }
      />
    ),
  );
}

type ReviewFileTreeNavigationProps = Readonly<{
  nodes: readonly ReviewFileTreeNode[];
  onSelect: (path: string) => void;
  selectedPath: string;
}>;

export function ReviewFileTreeNavigation({
  nodes,
  onSelect,
  selectedPath,
}: ReviewFileTreeNavigationProps) {
  const { t } = useTranslation("workbench");
  const defaultExpanded = useMemo(() => collectReviewFileTreeFolderPaths(nodes), [nodes]);

  return (
    <FileTree
      aria-label={t("diff.changedFilesNavigation")}
      defaultExpanded={defaultExpanded}
      onSelect={onSelect}
      selectedPath={selectedPath}
    >
      <ReviewFileTreeNodes
        fileLabel={(node) =>
          t("diff.fileStats", {
            additions: node.additions,
            path: node.path,
            removals: node.removals,
          })
        }
        nodes={nodes}
      />
    </FileTree>
  );
}

export function getReviewNavigationDirection(key: string): "next" | "previous" | null {
  if (key === "ArrowUp" || key === "ArrowLeft") {
    return "previous";
  }
  if (key === "ArrowDown" || key === "ArrowRight") {
    return "next";
  }
  return null;
}

export function resolveReviewIndex(
  currentIndex: number,
  direction: "next" | "previous",
  changeCount: number,
): number {
  if (changeCount <= 0) {
    return 0;
  }
  const offset = direction === "next" ? 1 : -1;
  return Math.min(Math.max(currentIndex + offset, 0), changeCount - 1);
}

type FileReviewDialogProps = Readonly<{
  changes: readonly AgentFileChange[] | null;
  onClose: () => void;
}>;

export function FileReviewDialog({ changes, onClose }: FileReviewDialogProps) {
  const { t } = useTranslation("workbench");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reviewContentRef = useRef<HTMLElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const fileTree = useMemo(() => buildReviewFileTree(changes ?? []), [changes]);
  const fileIndexByPath = useMemo(
    () =>
      new Map(
        (changes ?? []).map((change, changeIndex) => [
          change.path.replaceAll("\\", "/"),
          changeIndex,
        ]),
      ),
    [changes],
  );

  useEffect(() => {
    if (changes === null) {
      return;
    }
    setCurrentIndex(0);
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, [changes]);

  useEffect(() => {
    if (changes === null) {
      return;
    }
    // 切换后原焦点按钮可能变为 disabled；窗口级监听保证四个方向键不因焦点丢失而中断。
    const handleReviewKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const direction = getReviewNavigationDirection(event.key);
      if (direction !== null) {
        event.preventDefault();
        setCurrentIndex((index) => resolveReviewIndex(index, direction, changes.length));
      }
    };
    window.addEventListener("keydown", handleReviewKeyDown);
    return () => {
      window.removeEventListener("keydown", handleReviewKeyDown);
    };
  }, [changes]);

  useLayoutEffect(() => {
    // 左侧容器会跨文件复用，切换后必须主动清除上一个 Diff 的纵向滚动位置。
    if (reviewContentRef.current !== null) {
      reviewContentRef.current.scrollTop = 0;
    }
  }, [currentIndex]);

  if (changes === null || changes.length === 0) {
    return null;
  }

  const firstChange = changes[0];
  if (firstChange === undefined) {
    return null;
  }
  const change = changes[currentIndex] ?? firstChange;
  const selectedPath = change.path.replaceAll("\\", "/");
  const fileName = getFileName(change.path);
  const titleId = "file-review-dialog-title";
  const navigate = (direction: "next" | "previous") => {
    setCurrentIndex((index) => resolveReviewIndex(index, direction, changes.length));
  };

  return (
    // 原生 dialog 已通过 onCancel 提供 Escape 行为，onClick 仅识别不可聚焦的 backdrop。
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      aria-labelledby={titleId}
      className="file-diff-dialog m-auto h-[min(86vh,58rem)] w-[min(94vw,78rem)] max-w-none overflow-hidden rounded-surface bg-raised p-0 text-foreground shadow-panel backdrop:bg-scrim"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
        <header className="flex min-h-toolbar items-center gap-2 px-3 shadow-toolbar sm:px-4">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-body-small font-semibold" id={titleId} title={change.path}>
              {fileName}
            </h2>
            <p className="truncate text-caption text-muted-foreground" title={change.path}>
              {change.path}
            </p>
          </div>
          <span className="shrink-0 text-label text-muted-foreground">
            {currentIndex + 1} / {changes.length}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              disabled={currentIndex === 0}
              label={t("diff.previousFile")}
              onClick={() => {
                navigate("previous");
              }}
              size="small"
            >
              <ChevronUp className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton
              disabled={currentIndex === changes.length - 1}
              label={t("diff.nextFile")}
              onClick={() => {
                navigate("next");
              }}
              size="small"
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </IconButton>
            <IconButton label={t("diff.closeReview")} onClick={onClose} size="small">
              <X className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        </header>
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(12rem,26%)] bg-content">
          <section
            aria-label={t("diff.reviewContent")}
            className="min-h-0 overflow-auto"
            ref={reviewContentRef}
          >
            <Suspense
              fallback={
                <div
                  className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
                  role="status"
                >
                  {t("diff.loading")}
                </div>
              }
            >
              <PatchDiffViewer change={change} />
            </Suspense>
          </section>
          <aside
            aria-label={t("diff.changedFilesNavigation")}
            className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border-l border-separator bg-panel"
          >
            <div className="flex min-h-toolbar items-center gap-2 border-b border-separator px-3">
              <Files aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <h3 className="min-w-0 flex-1 truncate text-label font-semibold">
                {t("diff.changedFiles")}
              </h3>
              <span className="text-meta text-muted-foreground">{changes.length}</span>
            </div>
            <div className="min-h-0 overflow-y-auto px-2 py-2">
              <ReviewFileTreeNavigation
                nodes={fileTree}
                onSelect={(path) => {
                  const nextIndex = fileIndexByPath.get(path);
                  if (nextIndex !== undefined) {
                    setCurrentIndex(nextIndex);
                  }
                }}
                selectedPath={selectedPath}
              />
            </div>
          </aside>
        </div>
      </section>
    </dialog>
  );
}
