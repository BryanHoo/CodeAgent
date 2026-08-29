import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function collectInitialKeys(manifest) {
  const entries = Object.entries(manifest).filter(([, value]) => value.isEntry);
  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    visited.add(key);
    for (const dependency of manifest[key]?.imports ?? []) visit(dependency);
  };
  for (const [key] of entries) visit(key);
  return visited;
}

export function analyzeBundle(manifest, sizes) {
  const initialKeys = collectInitialKeys(manifest);
  const initialFiles = new Set();
  for (const key of initialKeys) {
    const chunk = manifest[key];
    if (chunk === undefined) continue;
    initialFiles.add(chunk.file);
    for (const css of chunk.css ?? []) initialFiles.add(css);
  }
  const toEntry = (file) => ({ bytes: sizes.get(file) ?? 0, file });
  const initialChunks = [...initialFiles].sort().map(toEntry);
  // 动态入口的静态依赖同样会占用解析和传输预算，必须覆盖全部非首屏 JS Chunk。
  const asyncFiles = new Set(
    Object.entries(manifest)
      .filter(([key, chunk]) => !initialKeys.has(key) && chunk.file.endsWith(".js"))
      .map(([, chunk]) => chunk.file),
  );
  return {
    asyncChunks: [...asyncFiles].sort().map(toEntry),
    initialBytes: initialChunks.reduce((total, chunk) => total + chunk.bytes, 0),
    initialChunks,
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dist = path.join(root, "dist");
  const manifest = JSON.parse(await readFile(path.join(dist, ".vite/manifest.json"), "utf8"));
  const budget = JSON.parse(await readFile(path.join(root, "performance-budget.json"), "utf8"));
  const files = new Set(Object.values(manifest).flatMap((chunk) => [chunk.file, ...(chunk.css ?? [])]));
  const sizes = new Map();
  for (const file of files) sizes.set(file, (await stat(path.join(dist, file))).size);
  const report = analyzeBundle(manifest, sizes);
  const largestAsyncBytes = Math.max(0, ...report.asyncChunks.map((chunk) => chunk.bytes));
  console.log(JSON.stringify({ ...report, largestAsyncBytes }, null, 2));
  const failures = [];
  if (report.initialBytes > budget.initialLoadBytes) {
    failures.push(`initial load ${report.initialBytes} > ${budget.initialLoadBytes} bytes`);
  }
  if (largestAsyncBytes > budget.asyncChunkBytes) {
    failures.push(`largest async chunk ${largestAsyncBytes} > ${budget.asyncChunkBytes} bytes`);
  }
  if (failures.length > 0) throw new Error(`Performance budget exceeded: ${failures.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
