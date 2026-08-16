import { execFileSync } from "node:child_process";
import {
  constants,
  accessSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";

const bundleRoot = resolve("target/release/bundle");
if (!existsSync(bundleRoot)) {
  throw new Error("Desktop bundle is missing; run pnpm --filter @code-agent/desktop build first");
}

const forbiddenNames = ["node", "node.exe", "code-agent-node-binding.node"];
const forbiddenContent = ["fastify", "@fastify/websocket", "node:child_process"];
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const textExtensions = new Set([".html", ".js", ".json", ".txt"]);

const findCodexRuntimeDirectories = (root) => {
  const directories = [];
  const visit = (directory) => {
    if (directory.endsWith("codex-runtime") && existsSync(join(directory, "codex-package.json"))) {
      directories.push(directory);
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(directory, entry.name));
    }
  };
  visit(root);
  return directories;
};

const scanForForbiddenArtifacts = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (forbiddenNames.includes(entry.name.toLowerCase())) {
      throw new Error(`Desktop bundle contains forbidden runtime: ${path}`);
    }
    if (entry.isDirectory()) {
      scanForForbiddenArtifacts(path);
      continue;
    }
    if (textExtensions.has(extname(entry.name)) && statSync(path).size <= 16 * 1024 * 1024) {
      const content = readFileSync(path, "utf8");
      const marker = forbiddenContent.find((value) => content.includes(value));
      if (marker !== undefined) throw new Error(`Desktop bundle contains ${marker}: ${path}`);
    }
  }
};

const withTemporaryDirectory = (callback) => {
  const directory = mkdtempSync(join(tmpdir(), "code-agent-artifact-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const extractArchive = (archivePath, destination) => {
  if (archivePath.endsWith(".tar.gz")) {
    execFileSync("tar", ["-xzf", archivePath, "-C", destination], { stdio: "pipe" });
    return;
  }
  execFileSync("tar", ["-xf", archivePath, "-C", destination], { stdio: "pipe" });
};

const discoverBundledRuntimeDirectories = () => {
  const fromBundle = findCodexRuntimeDirectories(bundleRoot);
  if (fromBundle.length > 0) return fromBundle;

  if (process.platform === "darwin") {
    const macosDirectory = join(bundleRoot, "macos");
    const appArchive = existsSync(macosDirectory)
      ? readdirSync(macosDirectory).find(
          (entry) => entry.endsWith(".app.tar.gz") && !entry.endsWith(".sig"),
        )
      : undefined;
    if (appArchive !== undefined) {
      return withTemporaryDirectory((directory) => {
        extractArchive(join(macosDirectory, appArchive), directory);
        return findCodexRuntimeDirectories(directory);
      });
    }

    const dmgDirectory = join(bundleRoot, "dmg");
    const dmg = existsSync(dmgDirectory)
      ? readdirSync(dmgDirectory).find((entry) => entry.endsWith(".dmg"))
      : undefined;
    if (dmg !== undefined) {
      return withTemporaryDirectory((mountPoint) => {
        execFileSync(
          "hdiutil",
          ["attach", join(dmgDirectory, dmg), "-nobrowse", "-readonly", "-mountpoint", mountPoint],
          { stdio: "pipe" },
        );
        try {
          return findCodexRuntimeDirectories(mountPoint);
        } finally {
          execFileSync("hdiutil", ["detach", mountPoint, "-quiet"], { stdio: "pipe" });
        }
      });
    }
  }

  if (process.platform === "win32") {
    const nsisDirectory = join(bundleRoot, "nsis");
    const nsisArchive = existsSync(nsisDirectory)
      ? readdirSync(nsisDirectory).find((entry) => entry.endsWith(".nsis.zip"))
      : undefined;
    if (nsisArchive !== undefined) {
      return withTemporaryDirectory((directory) => {
        extractArchive(join(nsisDirectory, nsisArchive), directory);
        return findCodexRuntimeDirectories(directory);
      });
    }
  }

  return [];
};

scanForForbiddenArtifacts(bundleRoot);

const preparedRuntime = resolve("apps/desktop/src-tauri/resources/codex-runtime");
if (!existsSync(preparedRuntime)) {
  throw new Error("Prepared Codex runtime is missing");
}
const runtimeManifest = JSON.parse(
  readFileSync(join(preparedRuntime, "codex-package.json"), "utf8"),
);
if (
  runtimeManifest.entrypoint !== `bin/codex${executableSuffix}` ||
  runtimeManifest.pathDir !== "codex-path" ||
  runtimeManifest.resourcesDir !== "codex-resources"
) {
  throw new Error("Prepared Codex runtime manifest is invalid");
}

const runtimeFiles = [];
const collectRuntimeFiles = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectRuntimeFiles(path);
    else runtimeFiles.push(relative(preparedRuntime, path));
  }
};
collectRuntimeFiles(preparedRuntime);

const bundledRuntimeDirectories = discoverBundledRuntimeDirectories();
if (bundledRuntimeDirectories.length === 0) {
  throw new Error("Desktop bundle is missing the canonical Codex runtime package");
}

for (const runtimeDirectory of bundledRuntimeDirectories) {
  for (const relativePath of runtimeFiles) {
    const source = join(preparedRuntime, relativePath);
    const path = join(runtimeDirectory, relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Desktop bundle is missing required Codex runtime: ${path}`);
    }
    if (process.platform !== "win32" && (statSync(source).mode & 0o111) !== 0) {
      accessSync(path, constants.X_OK);
    }
  }
  const requiredExecutables = [
    runtimeManifest.entrypoint,
    `bin/codex-code-mode-host${executableSuffix}`,
    `${runtimeManifest.pathDir}/rg${executableSuffix}`,
    ...(process.platform === "win32" ? [`${runtimeManifest.pathDir}/npx.exe`] : []),
  ];
  for (const relativePath of requiredExecutables) {
    accessSync(join(runtimeDirectory, relativePath), constants.X_OK);
  }
}
process.stdout.write("Desktop artifact isolation verified.\n");
