import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyUpdaterRelease } from "./verify-updater-release.mjs";

const platformAssets = {
  "darwin-aarch64": { id: 101, name: "CodeAgent.app.tar.gz" },
  "linux-x86_64": { id: 102, name: "CodeAgent.AppImage.tar.gz" },
  "windows-x86_64": { id: 103, name: "CodeAgent.nsis.zip" },
} as const;

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "code-agent-updater-test-"));
  const publicKeyPath = join(directory, "updater.pub");
  writeFileSync(publicKeyPath, "public-key");
  const platforms = Object.fromEntries(
    Object.entries(platformAssets).map(([platform, asset]) => {
      writeFileSync(join(directory, asset.name), `signed-${platform}`);
      return [
        platform,
        {
          signature: `signature-${platform}`,
          url: `https://api.github.com/repos/BryanHoo/CodeAgent/releases/assets/${String(asset.id)}`,
        },
      ];
    }),
  );
  return {
    artifactDirectory: directory,
    manifest: { version: "2.0.0-beta.1", platforms },
    publicKeyPath,
    release: {
      draft: true,
      tag_name: "v2.0.0-beta.1",
      assets: Object.values(platformAssets),
    },
  };
}

describe("verifyUpdaterRelease", () => {
  it("accepts all platforms and rejects artifact and signature tampering", async () => {
    const fixture = createFixture();
    const calls: { artifact: string; signature: string }[] = [];

    const report = await verifyUpdaterRelease({
      ...fixture,
      expectedTag: "v2.0.0-beta.1",
      expectedVersion: "2.0.0-beta.1",
      verifySignature: ({ artifactPath, signaturePath }) => {
        const artifact = readFileSync(artifactPath, "utf8");
        const signature = readFileSync(signaturePath, "utf8");
        calls.push({ artifact, signature });
        return artifact.startsWith("signed-") && signature.startsWith("signature-");
      },
    });

    expect(report).toEqual({ mode: "bootstrap", platformCount: 3 });
    expect(calls).toHaveLength(9);
    for (let index = 0; index < calls.length; index += 3) {
      expect(calls[index]?.artifact).toMatch(/^signed-/u);
      expect(calls[index + 1]?.artifact).not.toMatch(/^signed-/u);
      expect(calls[index + 2]?.signature).not.toMatch(/^signature-/u);
    }
  });

  it("fails when the current draft does not contain every supported platform", async () => {
    const fixture = createFixture();
    delete fixture.manifest.platforms["linux-x86_64"];

    await expect(
      verifyUpdaterRelease({
        ...fixture,
        expectedTag: "v2.0.0-beta.1",
        expectedVersion: "2.0.0-beta.1",
        verifySignature: () => true,
      }),
    ).rejects.toThrow(/linux-x86_64/u);
  });

  it("decodes base64 updater signatures from latest.json", async () => {
    const fixture = createFixture();
    const validSigLine = "RUQZkUTQ9L5cxiRFypDyr0zMYw359y4Pt4D+AS2SBG";
    const encoded = Buffer.from(`untrusted comment: test\n${validSigLine}\n`).toString("base64");
    for (const platform of Object.keys(fixture.manifest.platforms)) {
      fixture.manifest.platforms[platform].signature = encoded;
    }

    const calls: string[] = [];
    await verifyUpdaterRelease({
      ...fixture,
      expectedTag: "v2.0.0-beta.1",
      expectedVersion: "2.0.0-beta.1",
      verifySignature: ({ artifactPath, signaturePath }) => {
        const signature = readFileSync(signaturePath, "utf8");
        calls.push(signature);
        const sigLine = signature
          .split(/\r?\n/u)
          .find((line) => /^[A-Za-z0-9+/=]{40,}$/u.test(line));
        return readFileSync(artifactPath, "utf8").startsWith("signed-") && sigLine === validSigLine;
      },
    });

    expect(calls[0]).toContain("untrusted comment: test");
  });
});
