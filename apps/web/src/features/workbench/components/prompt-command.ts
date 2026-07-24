export type PromptCommandItem = Readonly<{
  id: string;
  keywords: readonly string[];
  label: string;
}>;

export type PromptSlashCommand = Readonly<{
  end: number;
  query: string;
  start: number;
}>;

export function resolvePromptSlashCommand(
  draft: string,
  cursorPosition: number,
): PromptSlashCommand | null {
  if (!draft.startsWith("/") || cursorPosition !== draft.length || /\s/u.test(draft)) {
    return null;
  }

  return {
    end: draft.length,
    query: draft.slice(1),
    start: 0,
  };
}

export function filterPromptCommandItems<TItem extends PromptCommandItem>(
  items: readonly TItem[],
  query: string,
): readonly TItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery === "") {
    return items;
  }

  return items.filter((item) =>
    [item.label, ...item.keywords].some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
}

export function movePromptCommandSelection(
  currentIndex: number,
  direction: -1 | 1,
  itemCount: number,
): number {
  if (itemCount === 0) {
    return 0;
  }
  return (currentIndex + direction + itemCount) % itemCount;
}
