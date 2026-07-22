import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  shell: false,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const output = JSON.parse(result.stdout);
// pnpm 返回单个对象；保留数组分支便于兼容不同打包器的 JSON 形态。
const manifest = Array.isArray(output) ? output[0] : output;

if (!manifest) {
  throw new Error("Package manifest is missing from pack output");
}

const files = new Set(manifest.files.map(({ path }) => path));
const requiredFiles = ["dist/cli.js", "dist/server/index.js", "dist/web/index.html"];
const missingFiles = requiredFiles.filter((path) => !files.has(path));

if (missingFiles.length > 0) {
  throw new Error(`Package is missing required files: ${missingFiles.join(", ")}`);
}

process.stdout.write(`Package verified: ${manifest.filename} (${manifest.files.length} files)\n`);
