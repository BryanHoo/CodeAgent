import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv.includes("--release") ? "release" : "debug";
const performanceProbe = process.argv.includes("--performance-probe");
const sourceName =
  process.platform === "win32"
    ? "code_agent_node_binding.dll"
    : process.platform === "darwin"
      ? "libcode_agent_node_binding.dylib"
      : "libcode_agent_node_binding.so";
const source = resolve(root, "target", profile, sourceName);
const nativeTarget = new Map([
  ["darwin-arm64", "darwin-arm64"],
  ["darwin-x64", "darwin-x64"],
  ["linux-x64", "linux-x64-gnu"],
  ["win32-x64", "win32-x64-msvc"],
]).get(`${process.platform}-${process.arch}`);
if (nativeTarget === undefined) {
  throw new Error(`Unsupported native build target: ${process.platform}-${process.arch}`);
}
const destinations = performanceProbe
  ? [resolve(root, ".cache/performance/code-agent-node-binding.node")]
  : [
      resolve(root, "packages/engine-node/native/code-agent-node-binding.node"),
      resolve(root, `packages/node-binding-${nativeTarget}/code-agent-node-binding.node`),
    ];

// Cargo 负责增量编译，脚本只执行确定性的扩展名转换，不扫描 target 目录。
await execFileAsync(
  "cargo",
  [
    "build",
    "-p",
    "code-agent-node-binding",
    "--locked",
    ...(profile === "release" ? ["--release"] : []),
    ...(performanceProbe ? ["--features", "performance-probe"] : []),
  ],
  { cwd: root },
);
await Promise.all(
  destinations.map(async (destination) => {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }),
);
