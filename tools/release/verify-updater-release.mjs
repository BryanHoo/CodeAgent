import {
  copyFileSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const repository = "BryanHoo/CodeAgent";
const supportedPlatforms = ["darwin-aarch64", "linux-x86_64", "windows-x86_64"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function resolveAssetName(urlValue, release) {
  const url = new URL(urlValue);
  const apiMatch = url.pathname.match(/^\/repos\/BryanHoo\/CodeAgent\/releases\/assets\/(\d+)$/u);
  if (url.origin === "https://api.github.com" && apiMatch !== null) {
    const assetId = Number(apiMatch[1]);
    const asset = release.assets.find((candidate) => candidate.id === assetId);
    invariant(asset !== undefined, `latest.json references unknown release asset ${assetId}`);
    return asset.name;
  }

  const downloadPrefix = `/BryanHoo/CodeAgent/releases/download/${encodeURIComponent(release.tag_name)}/`;
  invariant(
    url.origin === "https://github.com" && url.pathname.startsWith(downloadPrefix),
    `Updater URL is outside ${repository}: ${urlValue}`,
  );
  return decodeURIComponent(url.pathname.slice(downloadPrefix.length));
}

function tamperArtifact(sourcePath, destinationPath) {
  copyFileSync(sourcePath, destinationPath);
  const descriptor = openSync(destinationPath, "r+");
  try {
    const firstByte = Buffer.allocUnsafe(1);
    const bytesRead = readSync(descriptor, firstByte, 0, 1, 0);
    invariant(bytesRead === 1, `Updater artifact is empty: ${sourcePath}`);
    firstByte[0] ^= 0xff;
    writeSync(descriptor, firstByte, 0, 1, 0);
  } finally {
    closeSync(descriptor);
  }
}

function tamperSignature(signature) {
  const lines = signature.split(/\r?\n/u);
  const signatureLine = lines.findIndex((line) => /^[A-Za-z0-9+/=]{40,}$/u.test(line));
  if (signatureLine >= 0) {
    const line = lines[signatureLine];
    lines[signatureLine] = `${line[0] === "A" ? "B" : "A"}${line.slice(1)}`;
    return lines.join("\n");
  }
  return signature.replace(/[A-Za-z0-9]/u, (value) => (value === "A" ? "B" : "A"));
}

export async function verifyUpdaterRelease({
  artifactDirectory,
  expectedTag,
  expectedVersion,
  manifest,
  publicKeyPath,
  release,
  verifySignature,
}) {
  invariant(release?.draft === true, "Updater acceptance requires a draft release");
  invariant(release?.tag_name === expectedTag, `Release tag must be ${expectedTag}`);
  invariant(Array.isArray(release?.assets), "Release assets are required");
  invariant(manifest?.version === expectedVersion, `Updater version must be ${expectedVersion}`);
  invariant(manifest?.platforms !== null, "Updater platforms are required");
  invariant(statSync(publicKeyPath).size > 0, "Updater public key is empty");

  const entries = supportedPlatforms.map((platform) => {
    const entry = manifest.platforms[platform];
    invariant(entry !== undefined, `latest.json is missing ${platform}`);
    invariant(
      typeof entry.signature === "string" && entry.signature !== "",
      `${platform} signature is missing`,
    );
    invariant(typeof entry.url === "string", `${platform} URL is missing`);
    const assetName = resolveAssetName(entry.url, release);
    invariant(basename(assetName) === assetName, `Unsafe updater asset name: ${assetName}`);
    const artifactPath = resolve(artifactDirectory, assetName);
    invariant(statSync(artifactPath).size > 0, `Updater artifact is empty: ${assetName}`);
    return { artifactPath, entry, platform };
  });

  const workspace = mkdtempSync(join(tmpdir(), "code-agent-updater-verify-"));
  try {
    for (const { artifactPath, entry, platform } of entries) {
      const signaturePath = join(workspace, `${platform}.sig`);
      const tamperedArtifactPath = join(workspace, `${platform}.tampered`);
      const tamperedSignaturePath = join(workspace, `${platform}.tampered.sig`);
      writeFileSync(signaturePath, entry.signature);
      tamperArtifact(artifactPath, tamperedArtifactPath);
      writeFileSync(tamperedSignaturePath, tamperSignature(entry.signature));

      const verify = (candidateArtifactPath, candidateSignaturePath) =>
        verifySignature({
          artifactPath: candidateArtifactPath,
          publicKeyPath,
          signaturePath: candidateSignaturePath,
        });
      invariant(
        await verify(artifactPath, signaturePath),
        `${platform} valid signature was rejected`,
      );
      invariant(
        !(await verify(tamperedArtifactPath, signaturePath)),
        `${platform} tampered artifact was accepted`,
      );
      invariant(
        !(await verify(artifactPath, tamperedSignaturePath)),
        `${platform} tampered signature was accepted`,
      );
    }
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }

  return { mode: "bootstrap", platformCount: supportedPlatforms.length };
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    invariant(key?.startsWith("--") && value !== undefined, `Invalid argument: ${key ?? ""}`);
    values.set(key.slice(2), value);
  }
  for (const required of ["artifacts", "config", "manifest", "release", "tag", "version"]) {
    invariant(values.has(required), `Missing --${required}`);
  }
  return values;
}

function minisignVerifier({ artifactPath, publicKeyPath, signaturePath }) {
  const result = spawnSync(
    "minisign",
    ["-Vm", artifactPath, "-x", signaturePath, "-p", publicKeyPath],
    { encoding: "utf8", stdio: "pipe" },
  );
  if (result.error?.code === "ENOENT") throw new Error("minisign is not installed");
  return result.status === 0;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const config = JSON.parse(readFileSync(arguments_.get("config"), "utf8"));
  const encodedPublicKey = config?.plugins?.updater?.pubkey;
  invariant(typeof encodedPublicKey === "string", "Tauri updater public key is missing");

  const workspace = mkdtempSync(join(tmpdir(), "code-agent-updater-key-"));
  try {
    const publicKeyPath = join(workspace, "updater.pub");
    writeFileSync(publicKeyPath, Buffer.from(encodedPublicKey, "base64"));
    const report = await verifyUpdaterRelease({
      artifactDirectory: arguments_.get("artifacts"),
      expectedTag: arguments_.get("tag"),
      expectedVersion: arguments_.get("version"),
      manifest: JSON.parse(readFileSync(arguments_.get("manifest"), "utf8")),
      publicKeyPath,
      release: JSON.parse(readFileSync(arguments_.get("release"), "utf8")),
      verifySignature: minisignVerifier,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
