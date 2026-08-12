import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const targets = [
  {
    directory: "dist/web",
    forbidden: ["@tauri-apps/api", "__TAURI_INTERNALS__", "TauriCodeAgentTransport"],
    name: "web",
  },
  {
    directory: "dist/desktop",
    forbidden: ["HttpCodeAgentTransport", "WebSocket", "/v1/"],
    name: "desktop",
  },
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    else if (/\.(?:html|js|json)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

for (const target of targets) {
  const files = await collectFiles(target.directory);
  const content = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  for (const forbidden of target.forbidden) {
    if (content.includes(forbidden)) {
      throw new Error(`${target.name} bundle contains forbidden host module marker: ${forbidden}`);
    }
  }
}

console.log("Host bundle isolation verified.");
