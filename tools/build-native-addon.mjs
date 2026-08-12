import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv.includes("--release") ? "release" : "debug";
const sourceName =
  process.platform === "win32"
    ? "code_agent_node_binding.dll"
    : process.platform === "darwin"
      ? "libcode_agent_node_binding.dylib"
      : "libcode_agent_node_binding.so";
const source = resolve(root, "target", profile, sourceName);
const destinations = [
  resolve(root, "packages/engine-node/native/code-agent-node-binding.node"),
  resolve(root, "dist/native/code-agent-node-binding.node"),
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
  ],
  { cwd: root },
);
await Promise.all(
  destinations.map(async (destination) => {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }),
);
