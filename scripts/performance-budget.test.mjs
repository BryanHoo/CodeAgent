import assert from "node:assert/strict";
import test from "node:test";

import { analyzeBundle } from "./performance-budget.mjs";

test("analyzeBundle separates initial and asynchronous chunks", () => {
  const manifest = {
    "src/main.tsx": { file: "assets/main.js", imports: ["vendor"], isEntry: true },
    vendor: { file: "assets/vendor.js", imports: [] },
    source: { file: "assets/source.js", imports: ["vendor"], isDynamicEntry: true },
    "source-support": { file: "assets/source-support.js", imports: [] },
  };
  const sizes = new Map([
    ["assets/main.js", 100],
    ["assets/vendor.js", 200],
    ["assets/source.js", 300],
    ["assets/source-support.js", 450],
  ]);

  assert.deepEqual(analyzeBundle(manifest, sizes), {
    asyncChunks: [
      { bytes: 450, file: "assets/source-support.js" },
      { bytes: 300, file: "assets/source.js" },
    ],
    initialBytes: 300,
    initialChunks: [
      { bytes: 100, file: "assets/main.js" },
      { bytes: 200, file: "assets/vendor.js" },
    ],
  });
});
