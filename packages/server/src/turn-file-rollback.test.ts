import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  prepareTurnFileRollback,
  TurnFileRollbackError,
  type PatchExecutor,
} from "./turn-file-rollback.js";

async function createProjectRoot(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "code-agent-rollback-")));
}

describe("prepareTurnFileRollback", () => {
  it("rebuilds safe headers, preflights, and exposes both patch directions", async () => {
    const projectRoot = await createProjectRoot();
    const patchExecutor = vi.fn<PatchExecutor>(() => Promise.resolve());
    const prepared = await prepareTurnFileRollback(
      projectRoot,
      [
        {
          diff: "--- /untrusted/path\n+++ /another/path\n@@ -1 +1 @@\n-old\n+new",
          kind: "update",
          path: join(projectRoot, "src/index.ts"),
        },
      ],
      patchExecutor,
    );

    expect(prepared.restoredFiles).toEqual(["src/index.ts"]);
    expect(patchExecutor).toHaveBeenNthCalledWith(
      1,
      projectRoot,
      "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new",
      "reverse",
      true,
    );

    await prepared.applyReverse();
    await prepared.applyForward();
    expect(patchExecutor).toHaveBeenNthCalledWith(
      2,
      projectRoot,
      expect.any(String),
      "reverse",
      false,
    );
    expect(patchExecutor).toHaveBeenNthCalledWith(
      3,
      projectRoot,
      expect.any(String),
      "forward",
      false,
    );
  });

  it("converts complete create content into an applicable patch", async () => {
    const projectRoot = await createProjectRoot();
    const patchExecutor = vi.fn<PatchExecutor>(() => Promise.resolve());

    await prepareTurnFileRollback(
      projectRoot,
      [{ diff: "first\nsecond", kind: "create", path: "docs/new.md" }],
      patchExecutor,
    );

    expect(patchExecutor.mock.calls[0]?.[1]).toBe(
      "--- /dev/null\n+++ b/docs/new.md\n@@ -0,0 +1,2 @@\n+first\n+second",
    );
  });

  it("rejects unsafe, binary, and incomplete update patches before execution", async () => {
    const projectRoot = await createProjectRoot();
    const patchExecutor = vi.fn<PatchExecutor>(() => Promise.resolve());

    await expect(
      prepareTurnFileRollback(
        projectRoot,
        [{ diff: "+outside", kind: "create", path: "../outside.ts" }],
        patchExecutor,
      ),
    ).rejects.toBeInstanceOf(TurnFileRollbackError);
    await expect(
      prepareTurnFileRollback(
        projectRoot,
        [
          {
            diff: "Binary files a/image.png and b/image.png differ",
            kind: "update",
            path: "image.png",
          },
        ],
        patchExecutor,
      ),
    ).rejects.toThrow("Binary file changes cannot be rolled back");
    await expect(
      prepareTurnFileRollback(
        projectRoot,
        [{ diff: "old content", kind: "update", path: "src/index.ts" }],
        patchExecutor,
      ),
    ).rejects.toThrow("Update patch has no unified diff hunk");
    await expect(
      prepareTurnFileRollback(
        projectRoot,
        [
          { diff: "first", kind: "create", path: "same.ts" },
          { diff: "second", kind: "create", path: "same.ts" },
        ],
        patchExecutor,
      ),
    ).rejects.toThrow("multiple patches for the same file");
    expect(patchExecutor).not.toHaveBeenCalled();
  });
});
