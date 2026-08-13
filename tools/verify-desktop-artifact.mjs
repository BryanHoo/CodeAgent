import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const bundleRoot = resolve("target/release/bundle");
if (!existsSync(bundleRoot)) {
  throw new Error("Desktop bundle is missing; run pnpm --filter @code-agent/desktop build first");
}

const forbiddenNames = ["node", "node.exe", "code-agent-node-binding.node"];
const forbiddenContent = ["fastify", "@fastify/websocket", "node:child_process"];
const textExtensions = new Set([".html", ".js", ".json", ".txt"]);
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (forbiddenNames.includes(entry.name.toLowerCase())) {
      throw new Error(`Desktop bundle contains forbidden runtime: ${path}`);
    }
    if (entry.isDirectory()) {
      visit(path);
    } else if (textExtensions.has(extname(entry.name)) && statSync(path).size <= 16 * 1024 * 1024) {
      const content = readFileSync(path, "utf8");
      const marker = forbiddenContent.find((value) => content.includes(value));
      if (marker !== undefined) throw new Error(`Desktop bundle contains ${marker}: ${path}`);
    }
  }
};

visit(bundleRoot);
process.stdout.write("Desktop artifact isolation verified.\n");
