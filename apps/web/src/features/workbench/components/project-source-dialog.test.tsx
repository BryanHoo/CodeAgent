import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";

const resolveAssetUrl = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("source preview must not resolve a project image URL");
  }),
);

vi.mock("../../../app/create-host-client.js", () => ({
  codeAgentClient: { resolveAssetUrl },
}));

import {
  getCodeLanguage,
  getNextSourceCursor,
  mergeProjectSourcePages,
  ProjectSourceDialog,
  shouldLoadNextSourcePage,
} from "./project-source-dialog.js";

describe("getCodeLanguage", () => {
  it.each([
    ["src/example.ts", "typescript"],
    ["src/component.TSX", "tsx"],
    ["docs/guide.md", "markdown"],
    ["config/.env", "dotenv"],
    ["assets/archive.unknown", "text"],
    ["LICENSE", "text"],
  ])("maps %s to %s", (path, expectedLanguage) => {
    expect(getCodeLanguage(path)).toBe(expectedLanguage);
  });
});

describe("project source pagination", () => {
  it("does not resolve a project image asset while rendering source text", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["projects", "project-a", "source-file", "/tmp/main.ts"], {
      pageParams: [undefined],
      pages: [{ content: "export {};", nextCursor: null, path: "/tmp/main.ts" }],
    });

    expect(() =>
      renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ProjectSourceDialog
              client={{ readProjectSourceFile: vi.fn() }}
              onClose={vi.fn()}
              onOpenSystemDefault={vi.fn()}
              previewKind="source"
              projectId="project-a"
              reference={{ lineNumber: null, path: "/tmp/main.ts" }}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    ).not.toThrow();
    expect(resolveAssetUrl).not.toHaveBeenCalled();
  });

  it("merges loaded pages without losing content and exposes the final cursor", () => {
    expect(
      mergeProjectSourcePages([
        { content: "first\n", nextCursor: 6, path: "src/large.ts" },
        { content: "second\n", nextCursor: null, path: "src/large.ts" },
      ]),
    ).toEqual({
      content: "first\nsecond\n",
      nextCursor: null,
      path: "src/large.ts",
    });
  });

  it("stops pagination when the server repeats a cursor", () => {
    expect(
      getNextSourceCursor({ content: "first", nextCursor: 128, path: "src/large.ts" }, 0),
    ).toBe(128);
    expect(
      getNextSourceCursor({ content: "second", nextCursor: 128, path: "src/large.ts" }, 128),
    ).toBeUndefined();
    expect(
      getNextSourceCursor({ content: "last", nextCursor: null, path: "src/large.ts" }, 128),
    ).toBeUndefined();
  });

  it("loads the next page only when vertical scrolling approaches the bottom", () => {
    expect(
      shouldLoadNextSourcePage({ clientHeight: 600, scrollHeight: 2_000, scrollTop: 950 }),
    ).toBe(false);
    expect(
      shouldLoadNextSourcePage({ clientHeight: 600, scrollHeight: 2_000, scrollTop: 1_050 }),
    ).toBe(true);
  });
});
