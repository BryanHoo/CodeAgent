import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cliRoot = resolve(root, "apps/node-cli");
const packageManagerCli = process.env["npm_execpath"];
if (!packageManagerCli) throw new Error("package:check must run through pnpm");

const nativeTarget = new Map([
  ["darwin-arm64", "darwin-arm64"],
  ["darwin-x64", "darwin-x64"],
  ["linux-x64", "linux-x64-gnu"],
  ["win32-x64", "win32-x64-msvc"],
]).get(`${process.platform}-${process.arch}`);
if (nativeTarget === undefined) {
  throw new Error(`Unsupported package check target: ${process.platform}-${process.arch}`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function pack(workspaceRoot, destination) {
  const output = run(
    process.execPath,
    [packageManagerCli, "pack", "--pack-destination", destination, "--json"],
    workspaceRoot,
  );
  const value = JSON.parse(output);
  const manifest = Array.isArray(value) ? value[0] : value;
  if (!manifest?.filename) throw new Error(`Pack output is invalid for ${workspaceRoot}`);
  return manifest;
}

const packRoot = mkdtempSync(join(tmpdir(), "code-agent-pack-check-"));
const installRoot = mkdtempSync(join(tmpdir(), "code-agent-install-check-"));
try {
  const cliManifest = pack(cliRoot, packRoot);
  const nativeManifest = pack(resolve(root, `packages/node-binding-${nativeTarget}`), packRoot);
  const expectedVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;

  if (cliManifest.name !== "@bryanhu/code-agent") {
    throw new Error(`Unexpected package name: ${String(cliManifest.name)}`);
  }
  const files = new Set(cliManifest.files.map(({ path }) => path));
  const requiredFiles = [
    "dist/CHANGELOG.md",
    "dist/LICENSE",
    "dist/README.md",
    "dist/README.zh-CN.md",
    "dist/cli.js",
    "dist/engine-node/index.js",
    "dist/server/index.js",
    "dist/web/index.html",
  ];
  const missingFiles = requiredFiles.filter((path) => !files.has(path));
  const forbiddenFiles = [...files].filter(
    (path) => path.endsWith(".map") || path.endsWith(".node") || path.startsWith("src/"),
  );
  if (missingFiles.length > 0) {
    throw new Error(`Package is missing required files: ${missingFiles.join(", ")}`);
  }
  if (forbiddenFiles.length > 0) {
    throw new Error(`Main package contains forbidden files: ${forbiddenFiles.join(", ")}`);
  }

  const packedManifest = JSON.parse(
    run("tar", ["-xOf", cliManifest.filename, "package/package.json"], root),
  );
  const unresolvedDependencies = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ].flatMap((field) =>
    Object.entries(packedManifest[field] ?? {})
      .filter(([, version]) => /^(catalog|workspace):/.test(version))
      .map(([name, version]) => `${field}.${name}=${String(version)}`),
  );
  if (unresolvedDependencies.length > 0) {
    throw new Error(`Package contains unresolved protocols: ${unresolvedDependencies.join(", ")}`);
  }
  if (
    Object.values(packedManifest.optionalDependencies ?? {}).some(
      (version) => version !== expectedVersion,
    )
  ) {
    throw new Error("Native optional dependencies must use the exact product version");
  }

  const scopeRoot = join(installRoot, "node_modules/@bryanhu");
  mkdirSync(scopeRoot, { recursive: true });
  run("tar", ["-xf", cliManifest.filename, "-C", installRoot], root);
  run("tar", ["-xf", nativeManifest.filename, "-C", scopeRoot], root);
  const installedCli = join(installRoot, "package");
  const nativePackageName = `code-agent-${nativeTarget}`;
  const extractedNative = join(scopeRoot, "package");
  const installedNative = join(scopeRoot, nativePackageName);
  renameSync(extractedNative, installedNative);

  const cliResult = spawnSync(process.execPath, [join(installedCli, "dist/cli.js"), "--help"], {
    encoding: "utf8",
    shell: false,
  });
  if (cliResult.status !== 0 || !cliResult.stdout.includes("Usage: code-agent")) {
    process.stderr.write(cliResult.stderr);
    throw new Error("Packed CLI is not executable");
  }
  const binding = createRequire(import.meta.url)(
    join(installedNative, "code-agent-node-binding.node"),
  );
  if (
    typeof binding.addonVersion !== "function" ||
    typeof binding.NodeEngine?.open !== "function"
  ) {
    throw new Error("Packed native addon exports are invalid");
  }

  process.stdout.write(`Packages verified: ${cliManifest.filename}, ${nativeManifest.filename}\n`);
} finally {
  rmSync(packRoot, { force: true, recursive: true });
  rmSync(installRoot, { force: true, recursive: true });
}
