# Feature Implementation Plan

**Goal:** Support macOS 14+ on Apple Silicon only, with Developer ID signing, Hardened Runtime, notarization, and Gatekeeper verification for Desktop release artifacts.

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — defines Desktop release and verification gates.
- `.superwork/spec/shared/quality-guidelines.md` — defines signed updater and protected CI secret requirements.
- `docs/tauri-migration-plan.md` — defines the Phase 9 macOS signing acceptance criteria.

**Architecture:** Keep Apple credentials outside the repository, configure the Tauri macOS bundle for Hardened Runtime with a least-privilege entitlements file, let the macOS release runner sign and notarize the app through Tauri using a Developer ID certificate and App Store Connect API key, then reject artifacts that fail native signature, app notarization ticket, or Gatekeeper checks.

**Tech Stack:** Tauri 2, GitHub Actions, macOS `codesign`, `spctl`, `stapler`, TypeScript, Vitest, pnpm.

## Global Constraints

- Never commit, print, archive, or upload the Developer ID certificate, certificate password, or App Store Connect private key.
- Apply Apple signing and notarization only on macOS release runners; keep non-macOS release jobs unchanged.
- Remove all product-owned Intel macOS build, package, runtime resolution, and release paths.
- Keep Hardened Runtime enabled and grant no entitlement that is not required by current Desktop behavior.
- Keep every production source file below 500 lines and do not start a development server.

### Task 1: Define the macOS bundle security contract

**Files:**

- Create: `apps/desktop/src-tauri/Entitlements.plist`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: Tauri `bundle.macOS` configuration
- Produces: explicit macOS 14 minimum version, Hardened Runtime, and least-privilege signing entitlements

**Behavior:**

- Configure Tauri to require macOS `14.0`, enable Hardened Runtime, and apply a checked-in empty entitlement dictionary so the direct-distribution app receives no App Sandbox, JIT, unsigned-memory, library-validation, or debugging exceptions.

**Stop Conditions:**

- Stop if current Desktop runtime behavior requires a security-sensitive entitlement; document and test the narrow entitlement before enabling it.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts`

Expected: the Phase 9 contract proves the macOS 14 minimum, Hardened Runtime, and empty entitlement allowlist.

### Task 2: Remove Intel macOS product support

**Files:**

- Delete: `packages/node-binding-darwin-x64/package.json`
- Modify: `apps/node-cli/package.json`
- Modify: `apps/desktop/scripts/prepare-codex-binary.mjs`
- Modify: `packages/engine-node/src/codex-binary.ts`
- Modify: `packages/engine-node/src/native-binding.ts`
- Modify: `packages/engine-node/src/native-binding.test.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `.gitattributes`
- Modify: `tools/build-native-addon.mjs`
- Modify: `tools/clean.mjs`
- Modify: `tools/verify-package.mjs`
- Modify: `tools/verify-release-versions.mjs`
- Modify: `tests/tauri-phase-8.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `process.platform`, `process.arch`, release target names, and native optional dependencies
- Produces: an Apple Silicon-only macOS product support matrix

**Behavior:**

- Remove the `darwin-x64` native package, binary resolvers, build targets, version checks, and tests so Intel macOS is rejected as unsupported and cannot be published by the main CLI package.

**Stop Conditions:**

- Stop if removing Intel requires dropping a non-macOS platform or altering public protocol behavior.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-8.test.ts packages/engine-node/src/native-binding.test.ts && pnpm run release:version:check`

Expected: supported native packages contain only Darwin arm64, Linux x64, and Windows x64, with Intel resolution and publication absent.

### Task 3: Sign, notarize, and verify macOS release artifacts

**Files:**

- Modify: `.github/workflows/release.yml`
- Test: `tests/tauri-phase-8.test.ts`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: GitHub Secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, and `APPLE_API_PRIVATE_KEY`
- Produces: a Developer ID signed, Apple-notarized, stapled, and Gatekeeper-approved `.app` inside a signed Gatekeeper-approved `.dmg`

**Behavior:**

- Build only `darwin-arm64`; on its macOS runner, validate required secrets without printing values, materialize the App Store Connect `.p8` key with owner-only permissions under `RUNNER_TEMP`, pass all Apple variables to `tauri-action`, and fail the build job unless `codesign`, `stapler`, and `spctl` accept the app and `codesign` plus `spctl` accept the DMG. A failure may leave assets in the draft Release but must prevent the publish job and public promotion.

**Stop Conditions:**

- Stop if Tauri cannot notarize using `APPLE_API_KEY_PATH`, or if the release output layout cannot identify exactly one `.app` and one `.dmg` for the Apple Silicon target.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-8.test.ts tests/tauri-phase-9.test.ts`

Expected: workflow contracts require protected Apple credentials and native post-build verification before artifact upload.

### Task 4: Document credential provisioning and release recovery

**Files:**

- Modify: `docs/releasing.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `.superwork/spec/guides/index.md`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: Apple Developer Developer ID certificate and App Store Connect integration key
- Produces: reproducible maintainer setup, local verification, and failed-notarization recovery guidance

**Behavior:**

- Document macOS 14+ Apple Silicon support, exact secret formats, one-time certificate/key preparation commands, CI-only notarization flow, native verification commands, and the rule that failed or unstapled artifacts remain in the draft Release.

**Stop Conditions:**

- Stop if documentation would require embedding a real local credential path, account identifier, or secret value.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts && pnpm exec prettier --check .github/workflows/release.yml apps/desktop/src-tauri/tauri.conf.json docs/releasing.md docs/tauri-migration-plan.md .superwork/spec/guides/index.md .superwork/plans/2026-08-14-macos-signing-notarization.md tests/tauri-phase-9.test.ts`

Expected: targeted contracts and formatting checks pass with no credential material in tracked files.

### Task 5: Keep the macOS app sandbox disabled

**Files:**

- Modify: `apps/desktop/src-tauri/Entitlements.plist`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/releasing.md`
- Modify: `.superwork/spec/guides/index.md`
- Test: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: `SignedMacOSEntitlements` and `CodexSandboxPolicy`
- Produces: `ExplicitAppSandboxDisabledContract`

**Behavior:**

- Set `com.apple.security.app-sandbox` to `false`, preserve Hardened Runtime, and reject a signed release when its effective application entitlement enables App Sandbox. Document that this system entitlement is independent from Codex task sandbox selection.

**Stop Conditions:**

- Stop if disabling App Sandbox requires weakening Hardened Runtime or changing Codex task sandbox behavior.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-9.test.ts && pnpm exec prettier --check .github/workflows/release.yml docs/releasing.md .superwork/spec/guides/index.md .superwork/plans/2026-08-14-macos-signing-notarization.md tests/tauri-phase-9.test.ts`

Expected: the entitlement and release contract explicitly keep App Sandbox disabled while leaving Codex sandbox ownership unchanged.
