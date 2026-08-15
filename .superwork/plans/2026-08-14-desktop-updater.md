# Feature Implementation Plan

**Goal:** Enable signed Desktop updates from GitHub Releases, including update checks, verified download and installation, and automatic restart.

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — defines Desktop security, release, and verification rules.
- `.superwork/spec/shared/directory-structure.md` — assigns Tauri IPC mapping to `packages/transport-tauri`.
- `.superwork/spec/shared/quality-guidelines.md` — defines the shared app update contract, mutation, and error requirements.
- `.superwork/spec/frontend/quality-guidelines.md` — defines host Transport build and verification requirements.
- `docs/tauri-migration-plan.md` — defines Phase 9 updater, signing, and GitHub Release acceptance criteria.

**Architecture:** Keep the existing Protocol and Web update UI. Implement update checks and installation in Rust through `tauri-plugin-updater`, expose the existing operations through typed Tauri commands, and let `tauri-action` publish signed updater artifacts plus `latest.json` to GitHub Releases.

**Tech Stack:** Rust 2024, Tauri 2, `tauri-plugin-updater`, TypeScript, Vitest, pnpm, GitHub Actions.

## Global Constraints

- Keep every production source file below 500 lines and prioritize bounded, non-blocking operations.
- Use only the HTTPS GitHub Release endpoint and never commit the updater private key.
- Preserve the existing `AppInfoResponse` and `InstallAppUpdateResponse` Protocol schemas.
- Preserve original upstream updater error messages at the Tauri boundary.
- Do not start a development server.

### Task 1: Implement the Desktop updater commands

**Files:**

- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/command_error.rs`
- Modify: `apps/desktop/src-tauri/src/commands/app.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/main.json`
- Modify: `tests/tauri-phase-1.test.ts`
- Create: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: configured GitHub Release `latest.json` and `tauri_plugin_updater::UpdaterExt`
- Produces: `app_info` update metadata and `app_update_install` signed install/restart behavior

**Behavior:**

- Check the configured HTTPS endpoint on every `app_info`, map available/current/check-failed states to the existing response, validate the requested version before download, let Tauri verify the artifact signature during installation, and schedule an automatic restart only after installation succeeds.

**Stop Conditions:**

- Stop if a production updater public key cannot be generated without storing its private key in the repository.
- Stop if the installed Tauri version cannot expose Rust updater checks and signature-verified installation.

- [x] **Task Status:** completed

Run: `cargo test -p code-agent-desktop commands::app::tests`

Expected: Desktop updater mapping, validation, truncation, and error tests pass.

### Task 2: Map the shared update mutation through Tauri Transport

**Files:**

- Modify: `packages/transport-tauri/src/tauri-transport.ts`
- Modify: `packages/transport-tauri/src/tauri-transport.test.ts`

**Interfaces:**

- Consumes: `CodeAgentOperation` named `app.update_install`
- Produces: `app_update_install` IPC payload with `version`, `requestId`, and `idempotencyKey`

**Behavior:**

- Replace the intentionally unsupported Desktop update branch with the same typed mutation and structured error behavior used by other Tauri operations.

**Stop Conditions:**

- Stop if the existing Client operation does not carry a SemVer version or mutation request context.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/transport-tauri/src/tauri-transport.test.ts`

Expected: The update operation maps to `app_update_install` with stable mutation identity and no unsupported-operation assertion remains.

### Task 3: Publish signed updater artifacts on GitHub Releases

**Files:**

- Modify: `.github/workflows/release.yml`
- Modify: `docs/releasing.md`
- Modify: `tests/tauri-phase-9.test.ts`

**Interfaces:**

- Consumes: GitHub Secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Produces: signed platform updater artifacts, signatures, and GitHub Release `latest.json`

**Behavior:**

- Build each supported Desktop target once through `tauri-action`, publish updater assets to the draft GitHub Release, retain existing npm publication order, and document secret provisioning plus promotion and smoke verification.

**Stop Conditions:**

- Stop if the release action cannot merge all four target entries into one updater manifest.
- Stop if updater assets would be published before signature generation succeeds.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/tauri-phase-1.test.ts tests/tauri-phase-8.test.ts tests/tauri-phase-9.test.ts`

Expected: Repository contracts prove the HTTPS endpoint, public key, capability, signed workflow inputs, target matrix, and npm publication order.
