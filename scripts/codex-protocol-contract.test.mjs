import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  REQUIRED_CODEX_VERSION,
  assertCodexVersion,
  compareSchemaBundles,
} from "./codex-protocol-contract.mjs";

const BUNDLES = [
  "codex_app_server_protocol.schemas.json",
  "codex_app_server_protocol.v2.schemas.json",
];
const qualityWorkflow = await readFile(
  new URL("../.github/workflows/quality.yml", import.meta.url),
  "utf8",
);

void test("requires the exact verified Codex version", () => {
  assert.equal(assertCodexVersion("codex-cli 0.152.1\n"), REQUIRED_CODEX_VERSION);
  assert.throws(
    () => assertCodexVersion("codex-cli 0.152.3\n"),
    /expected codex-cli 0\.152\.1/u,
  );
});

void test("runs the pinned protocol contract check in CI", () => {
  assert.match(qualityWorkflow, /npm install --global @openai\/codex@0\.152\.1/u);
  assert.match(qualityWorkflow, /pnpm codex:protocol:check/u);
});

void test("reports generated schema bundle differences", async () => {
  const root = await mkdtemp(join(tmpdir(), "codeagent-protocol-test-"));
  const expected = join(root, "expected");
  const generated = join(root, "generated");

  try {
    await Promise.all([mkdir(expected), mkdir(generated)]);
    await Promise.all(
      BUNDLES.flatMap((name) => [
        writeFile(join(expected, name), `${name}:verified\n`),
        writeFile(join(generated, name), `${name}:verified\n`),
      ]),
    );

    assert.deepEqual(await compareSchemaBundles(expected, generated), []);
    await writeFile(join(generated, BUNDLES[1]), "changed\n");
    assert.deepEqual(await compareSchemaBundles(expected, generated), [BUNDLES[1]]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
