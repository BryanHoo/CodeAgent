import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveTauriArguments } from "./tauri-build-constraints.mjs";

const tauriCli = fileURLToPath(
  new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
);

let argumentsList;
try {
  argumentsList = resolveTauriArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const result = spawnSync(process.execPath, [tauriCli, ...argumentsList], {
  stdio: "inherit",
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
