import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SUPPORTED_CODEX_VERSION, checkCodexVersion, locateCodexBinary } from "./binary.js";

const temporaryDirectories: string[] = [];

async function createExecutable(output: string, exitCode = 0, name = "codex"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "code-agent-codex-binary-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, name);
  await writeFile(
    filePath,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)});\nprocess.exit(${String(exitCode)});\n`,
  );
  await chmod(filePath, 0o755);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("locateCodexBinary", () => {
  it("prefers an explicit binary over environment, bundled, and PATH candidates", async () => {
    const explicitPath = await createExecutable("explicit");
    const environmentPath = await createExecutable("environment");
    const bundledPath = await createExecutable("bundled");

    await expect(
      locateCodexBinary({
        bundledBinaryPath: bundledPath,
        env: { CODE_AGENT_CODEX_BIN: environmentPath, PATH: "" },
        explicitPath,
      }),
    ).resolves.toEqual({ path: explicitPath, source: "explicit" });
  });

  it("uses CODE_AGENT_CODEX_BIN when no explicit path is provided", async () => {
    const environmentPath = await createExecutable("environment");

    await expect(
      locateCodexBinary({
        bundledBinaryPath: null,
        env: { CODE_AGENT_CODEX_BIN: environmentPath, PATH: "" },
      }),
    ).resolves.toEqual({ path: environmentPath, source: "environment" });
  });

  it("prefers the bundled binary before a PATH binary", async () => {
    const bundledPath = await createExecutable("bundled");
    const pathBinary = await createExecutable("path");

    await expect(
      locateCodexBinary({ bundledBinaryPath: bundledPath, env: { PATH: join(pathBinary, "..") } }),
    ).resolves.toEqual({ path: bundledPath, source: "bundled" });
  });

  it("resolves the bundled package to the platform-native Codex executable", async () => {
    const binary = await locateCodexBinary({ env: { PATH: "" } });

    expect(binary.source).toBe("bundled");
    expect(binary.path).not.toMatch(/codex\.js$/);
    expect(binary.path).toMatch(process.platform === "win32" ? /codex\.exe$/i : /\/codex$/);
  });

  it("falls back to a PATH binary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "code-agent-codex-path-"));
    temporaryDirectories.push(directory);
    const pathBinary = join(directory, "codex");
    await writeFile(pathBinary, "#!/usr/bin/env node\n");
    await chmod(pathBinary, 0o755);

    await expect(
      locateCodexBinary({ bundledBinaryPath: null, env: { PATH: directory } }),
    ).resolves.toEqual({ path: pathBinary, source: "path" });
  });

  it("rejects a configured path that is not executable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "code-agent-codex-invalid-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "codex");
    await writeFile(filePath, "not executable");

    await expect(locateCodexBinary({ explicitPath: filePath })).rejects.toThrow(
      "Codex binary is not executable",
    );
  });
});

describe("checkCodexVersion", () => {
  it("accepts the pinned supported Codex version", async () => {
    const binaryPath = await createExecutable(`codex-cli ${SUPPORTED_CODEX_VERSION}\n`);

    await expect(checkCodexVersion(binaryPath)).resolves.toEqual({
      raw: `codex-cli ${SUPPORTED_CODEX_VERSION}`,
      version: SUPPORTED_CODEX_VERSION,
    });
  });

  it("rejects an unsupported Codex version", async () => {
    const binaryPath = await createExecutable("codex-cli 0.144.0\n");

    await expect(checkCodexVersion(binaryPath)).rejects.toThrow(
      `Unsupported Codex version 0.144.0; expected ${SUPPORTED_CODEX_VERSION}`,
    );
  });

  it("rejects malformed version output and non-zero exits", async () => {
    const malformedBinary = await createExecutable("unknown\n");
    const failingBinary = await createExecutable("failed\n", 2);

    await expect(checkCodexVersion(malformedBinary)).rejects.toThrow(
      "Invalid Codex version output",
    );
    await expect(checkCodexVersion(failingBinary)).rejects.toThrow("Codex version check failed");
  });
});
