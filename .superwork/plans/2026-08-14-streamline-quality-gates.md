# Quality Gate Streamlining Implementation Plan

**Goal:** Remove redundant completion-time checks while preserving full CI, release, and change-specific verification coverage.

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — defines repository verification commands and trigger scope.
- `.superwork/spec/backend/quality-guidelines.md` — defines Rust, Tauri, protocol, and release verification requirements.
- `.superwork/spec/frontend/quality-guidelines.md` — defines browser and host transport verification triggers.
- `.superwork/spec/shared/quality-guidelines.md` — defines coverage and cross-package verification requirements.

**Architecture:** Keep `pnpm check` as the fast completion baseline, add `pnpm check:ci` as the full CI and prepublish pipeline, let the unified Vitest run execute repository contract tests once, and retain expensive Rust, E2E, Desktop, and release checks only at their relevant boundaries.

**Tech Stack:** pnpm scripts, GitHub Actions YAML, Vitest, Markdown engineering specifications.

## Global Constraints

- Preserve every existing assertion and production safety boundary; remove duplicate execution paths rather than weakening tests.
- Keep release and CI verification self-contained and fail-fast.
- Do not start a development server.

### Task 1: Define non-overlapping quality gate scripts

**Files:**

- Modify: `package.json`
- Test: `tests/ci-quality-gates.test.ts`
- Modify: `tests/tauri-phase-3.test.ts`
- Modify: `tests/tauri-phase-7.test.ts`
- Modify: `tests/tauri-phase-8.test.ts`

**Interfaces:**

- Consumes: existing root scripts, Vitest repository contract discovery, CI and prepublish callers
- Produces: fast `check`, full `check:ci`, non-duplicated protocol drift check, and no phase-specific cumulative gate scripts

**Behavior:**

- Make `pnpm check` run only formatting, lint, architecture, type checking, and the unified unit/contract test suite. Make `pnpm check:ci` add audit, Codex Schema drift, Rust protocol generation drift, performance, production build, bundle budget, and package verification. Remove `tauri:phase4:check` through `tauri:phase8:check`; their test files remain covered by `pnpm test`. Point `prepublishOnly` at `check:ci`.

**Stop Conditions:**

- Stop if any Phase contract test is excluded from the unified Vitest configuration or a removed command has a current non-document consumer that cannot use `pnpm test`.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/ci-quality-gates.test.ts tests/tauri-phase-7.test.ts tests/tauri-phase-8.test.ts`

Expected: script contract tests pass and prove each repository contract suite is triggered once by the unified test command.

### Task 2: Trigger full checks only in CI and publication

**Files:**

- Modify: `.github/workflows/ci.yml`
- Test: `tests/ci-quality-gates.test.ts`

**Interfaces:**

- Consumes: root `check:ci`, `check:rust`, and `test:coverage` scripts
- Produces: explicit CI-only full quality trigger without a second baseline invocation

**Behavior:**

- Replace the CI quality step with `pnpm check:ci`, keep Rust checks on the platform matrix and coverage only on Linux, and retain the report-only bundle display step.

**Stop Conditions:**

- Stop if the workflow would omit either Windows contract coverage, Rust checks, or Linux coverage thresholds.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/ci-quality-gates.test.ts`

Expected: the CI contract proves full checks run once per quality job and coverage still runs only on Linux.

### Task 3: Replace phase-era gate descriptions with change-based triggers

**Files:**

- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Modify: `docs/tauri-migration-plan.md`
- Modify: `docs/releasing.md`

**Interfaces:**

- Consumes: the streamlined root scripts and retained targeted commands
- Produces: concise current guidance for baseline, CI, Rust, browser, Desktop, host bundle, and release verification

**Behavior:**

- Remove current instructions that require cumulative Phase 4–8 commands. Describe phase contract tests as part of `pnpm test`, define `pnpm check` as the default completion baseline, reserve `check:ci` for CI/prepublish, and list expensive checks only under the changes that require them.

**Stop Conditions:**

- Stop if documentation would make security, protocol drift, package, or Desktop artifact verification unreachable from a relevant workflow.

- [x] **Task Status:** completed

Run: `rg -n 'tauri:phase[4-8]:check|pnpm check|check:ci' package.json .github/workflows/ci.yml .superwork/spec/guides/index.md .superwork/spec/backend/quality-guidelines.md docs/tauri-migration-plan.md docs/releasing.md tests`

Expected: no current phase-specific command remains, while baseline and full trigger descriptions match the implemented scripts.

### Task 4: Verify the streamlined gate graph

**Files:**

- Modify: `.superwork/plans/2026-08-14-streamline-quality-gates.md`
- Test: `package.json`
- Test: `.github/workflows/ci.yml`
- Test: `.superwork/spec/guides/index.md`

**Interfaces:**

- Consumes: completed script, workflow, test, and documentation changes
- Produces: focused verification evidence and a completed implementation plan

**Behavior:**

- Run the focused contract tests, the fast baseline once, and static searches that prove removed phase commands and obsolete current descriptions are absent.

**Stop Conditions:**

- Stop if focused tests or the baseline fail because of this change; fix the regression before completion.

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: the streamlined default completion gate exits with status `0` without running production build, performance, audit, package, or cumulative phase scripts.
