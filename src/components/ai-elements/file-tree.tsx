import {
  buildProxiedInstance,
  hotkeysCoreFeature,
  propMemoizationFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type ItemInstance,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRightIcon, FileCode2Icon, FileIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { useMemo, useRef, useState, type HTMLAttributes, type RefCallback } from "react";

export type FileTreeEntry = Readonly<{
  depth: number;
  kind: "file" | "folder";
  name: string;
}>;
type TreeNode = Readonly<{ children: readonly string[]; id: string; kind: "file" | "folder"; name: string }>;
const ROOT_ID = "__root__";
const ROW_HEIGHT = 28;

function createModel(entries: readonly FileTreeEntry[]) {
  const mutable = new Map<string, { children: string[]; id: string; kind: "file" | "folder"; name: string }>();
  mutable.set(ROOT_ID, { children: [], id: ROOT_ID, kind: "folder", name: "root" });
  const folderStack: string[] = [];
  for (const entry of entries) {
    folderStack.length = entry.depth;
    const parentId = entry.depth === 0 ? ROOT_ID : folderStack[entry.depth - 1];
    if (parentId === undefined) throw new Error(`Missing parent for ${entry.name}`);
    const id = `${parentId}/${entry.name}`;
    mutable.set(id, { children: [], id, kind: entry.kind, name: entry.name });
    mutable.get(parentId)?.children.push(id);
    if (entry.kind === "folder") folderStack[entry.depth] = id;
  }
  return mutable as ReadonlyMap<string, TreeNode>;
}

export function FileTree({ entries, onSelect }: Readonly<{ entries: readonly FileTreeEntry[]; onSelect: (name: string) => void }>) {
  const model = useMemo(() => createModel(entries), [entries]);
  const rootChild = model.get(ROOT_ID)?.children[0];
  const defaultExpanded = rootChild === undefined ? [] : [rootChild, `${rootChild}/src`, `${rootChild}/src/app`];
  const [expandedItems, setExpandedItems] = useState<string[]>(defaultExpanded);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tree = useTree<TreeNode>({
    dataLoader: {
      getChildren: (id) => [...(model.get(id)?.children ?? [])],
      getItem: (id) => {
        const node = model.get(id);
        if (node === undefined) throw new Error(`Unknown file tree item: ${id}`);
        return node;
      },
    },
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, propMemoizationFeature],
    getItemName: (item) => item.getItemData().name,
    instanceBuilder: buildProxiedInstance,
    isItemFolder: (item) => item.getItemData().kind === "folder",
    onPrimaryAction: (item) => {
      const data = item.getItemData();
      if (data.kind === "file") onSelect(data.name);
    },
    rootItemId: ROOT_ID,
    setExpandedItems,
    setSelectedItems,
    state: { expandedItems, selectedItems },
  });
  const items = tree.getItems();
  // Headless Tree 管理语义与键盘，TanStack Virtual 只负责可见行挂载。
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({ count: items.length, estimateSize: () => ROW_HEIGHT, getItemKey: (index) => items[index]?.getKey() ?? index, getScrollElement: () => scrollRef.current, initialRect: { height: 420, width: 320 }, overscan: 8 });
  const { ref: treeRef, ...treeProps } = tree.getContainerProps("CodeAgent 文件树") as HTMLAttributes<HTMLDivElement> & Readonly<{ ref?: RefCallback<HTMLElement> }>;
  return (
    <div {...treeProps} className="ai-file-tree" ref={(node) => { scrollRef.current = node; treeRef?.(node); }}>
      <div className="ai-file-tree-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return <FileTreeRow item={item} key={virtualItem.key} start={virtualItem.start} />;
        })}
      </div>
    </div>
  );
}

function FileTreeRow({ item, start }: Readonly<{ item: ItemInstance<TreeNode>; start: number }>) {
  const data = item.getItemData();
  const folder = item.isFolder();
  const expanded = item.isExpanded();
  const Icon = folder ? (expanded ? FolderOpenIcon : FolderIcon) : data.name.endsWith(".ts") || data.name.endsWith(".tsx") ? FileCode2Icon : FileIcon;
  const { ref, ...props } = item.getProps() as HTMLAttributes<HTMLDivElement> & Readonly<{ ref?: RefCallback<HTMLElement> }>;
  return <div {...props} className={item.isSelected() ? "ai-file-tree-row selected" : "ai-file-tree-row"} ref={ref} style={{ paddingLeft: item.getItemMeta().level * 16 + 2, transform: `translateY(${String(start)}px)` }}><span className="ai-file-tree-toggle">{folder ? <ChevronRightIcon className={expanded ? "expanded" : ""} aria-hidden="true" /> : null}</span><Icon aria-hidden="true" /><span>{data.name}</span>{data.name === "src" ? <small><b>+1089</b><i>−1146</i></small> : data.name === "public" ? <small><b>+22</b><i>−0</i></small> : null}</div>;
}
