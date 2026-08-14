import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const readJson = (path) => JSON.parse(read(path));

const rootManifest = readJson("package.json");
const cargoManifest = read("Cargo.toml");
const cargoVersion = cargoManifest.match(
  /\[workspace\.package\][\s\S]*?\nversion = "([^"]+)"/,
)?.[1];
const tauriConfig = readJson("apps/desktop/src-tauri/tauri.conf.json");
const versionedPackages = [
  "apps/node-cli/package.json",
  "packages/node-binding-darwin-arm64/package.json",
  "packages/node-binding-linux-x64-gnu/package.json",
  "packages/node-binding-win32-x64-msvc/package.json",
];

if (typeof rootManifest.version !== "string" || rootManifest.version.length === 0) {
  throw new Error("Root product version is missing");
}
if (cargoVersion !== rootManifest.version) {
  throw new Error(`Cargo workspace version ${String(cargoVersion)} != ${rootManifest.version}`);
}
if (tauriConfig.version !== "../../../package.json") {
  throw new Error(`Tauri version must reference root package.json: ${String(tauriConfig.version)}`);
}

for (const path of versionedPackages) {
  const manifest = readJson(path);
  if (manifest.version !== rootManifest.version) {
    throw new Error(`${path} version ${String(manifest.version)} != ${rootManifest.version}`);
  }
}

const optionalDependencies = readJson("apps/node-cli/package.json").optionalDependencies ?? {};
for (const [name, version] of Object.entries(optionalDependencies)) {
  if (version !== rootManifest.version) {
    throw new Error(`${name} optional dependency ${String(version)} != ${rootManifest.version}`);
  }
}

process.stdout.write(`Release versions verified: ${rootManifest.version}\n`);
