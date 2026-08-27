import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(workspaceRoot, relativePath), "utf8"));
}

const packageVersion = readJson("package.json").version;
const tauriVersion = readJson("src-tauri/tauri.conf.json").version;
const cargoMetadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version=1",
      "--no-deps",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ],
    { cwd: workspaceRoot, encoding: "utf8" },
  ),
);
const cargoPackage = cargoMetadata.packages.find((item) => item.name === "codeagent");

if (!cargoPackage) {
  throw new Error("codeagent Cargo package was not found");
}

const versions = new Set([packageVersion, tauriVersion, cargoPackage.version]);

if (versions.size !== 1) {
  throw new Error(
    `version mismatch: package=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoPackage.version}`,
  );
}

const releaseTag = process.env.RELEASE_TAG?.trim();

// Tag 发布必须与三处应用版本完全一致，避免生成名称正确但元数据错误的安装包。
if (releaseTag && releaseTag !== `v${packageVersion}`) {
  throw new Error(`release tag ${releaseTag} does not match v${packageVersion}`);
}

process.stdout.write(`version ${packageVersion} is consistent\n`);
