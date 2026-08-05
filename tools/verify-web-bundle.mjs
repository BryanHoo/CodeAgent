import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const initialGzipBudgetBytes = 240 * 1024;
const maxAsyncGzipBudgetBytes = 200 * 1024;

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function readManifest(root) {
  const manifestPath = resolve(root, ".vite/manifest.json");
  const value = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid Vite manifest: expected an object");
  }
  return value;
}

function readChunk(manifest, key) {
  const chunk = manifest[key];
  if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)) {
    throw new Error(`unknown manifest chunk: ${key}`);
  }
  if (typeof chunk.file !== "string") {
    throw new Error(`invalid manifest chunk file: ${key}`);
  }
  if (
    chunk.imports !== undefined &&
    (!Array.isArray(chunk.imports) || chunk.imports.some((item) => typeof item !== "string"))
  ) {
    throw new Error(`invalid manifest chunk imports: ${key}`);
  }
  return chunk;
}

function collectStaticGraph(manifest, roots, excluded = new Set()) {
  const chunks = new Set();
  const visit = (key) => {
    if (chunks.has(key) || excluded.has(key)) return;
    const chunk = readChunk(manifest, key);
    chunks.add(key);
    for (const importedKey of chunk.imports ?? []) {
      visit(importedKey);
    }
  };
  for (const root of roots) visit(root);
  return chunks;
}

function measureGraph(root, manifest, graph) {
  let gzipBytes = 0;
  const files = [];
  for (const key of graph) {
    const { file } = readChunk(manifest, key);
    if (!file.endsWith(".js")) continue;
    gzipBytes += gzipSync(readFileSync(resolve(root, file))).byteLength;
    files.push(file);
  }
  return { files: files.toSorted(), gzipBytes };
}

function analyzeBundle(root, manifest) {
  const entries = Object.keys(manifest).filter((key) => readChunk(manifest, key).isEntry === true);
  if (entries.length === 0) {
    throw new Error("invalid Vite manifest: no JavaScript entry found");
  }

  // 首屏统计入口及其全部静态依赖；异步组只统计首屏尚未下载的静态闭包。
  const initialGraph = collectStaticGraph(manifest, entries);
  const initial = measureGraph(root, manifest, initialGraph);
  const asyncGroups = Object.keys(manifest)
    .filter((key) => readChunk(manifest, key).isDynamicEntry === true)
    .map((key) => ({
      key,
      ...measureGraph(root, manifest, collectStaticGraph(manifest, [key], initialGraph)),
    }))
    .toSorted((left, right) => right.gzipBytes - left.gzipBytes);

  return { initial, largestAsync: asyncGroups[0] ?? null };
}

function assertBudgets(analysis) {
  const errors = [];
  if (analysis.initial.gzipBytes > initialGzipBudgetBytes) {
    errors.push(
      `initial gzip budget exceeded: ${formatKiB(analysis.initial.gzipBytes)} > ${formatKiB(initialGzipBudgetBytes)}`,
    );
  }
  if (analysis.largestAsync !== null && analysis.largestAsync.gzipBytes > maxAsyncGzipBudgetBytes) {
    errors.push(
      `async gzip budget exceeded: ${formatKiB(analysis.largestAsync.gzipBytes)} > ${formatKiB(maxAsyncGzipBudgetBytes)} (${analysis.largestAsync.key})`,
    );
  }
  if (errors.length > 0) {
    throw new Error(`Web Bundle budget failed\n- ${errors.join("\n- ")}`);
  }
}

function main() {
  const root = resolve(process.argv[2] ?? "dist/web");
  const analysis = analyzeBundle(root, readManifest(root));
  assertBudgets(analysis);
  const asyncSummary =
    analysis.largestAsync === null
      ? "none"
      : `${formatKiB(analysis.largestAsync.gzipBytes)} (${analysis.largestAsync.key})`;
  console.log(
    `Web Bundle budget passed: initial ${formatKiB(analysis.initial.gzipBytes)} / ${formatKiB(initialGzipBudgetBytes)}; max async ${asyncSummary} / ${formatKiB(maxAsyncGzipBudgetBytes)}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
