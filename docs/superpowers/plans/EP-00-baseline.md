
# EP-00 — Baseline, Recovery and CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for behavior, data, security and hardware work) or `superpowers:executing-plans` to implement each reviewed task. Use `superpowers:test-driven-development` for each behavior change. This document is an outline until its feature-specific design has been approved and exact source paths confirmed. Steps use `- [ ]` for progress tracking.

**Goal:** Prove a clean, reproducible upstream baseline before any feature code.

**Architecture:** Add narrowly scoped behavior to the existing React/Zustand/Node/Capacitor system; each milestone can be tested and reviewed independently.

**Tech stack:** Existing React 19 / JavaScript / Vite / Node 22, repository-native unit and integration tests, optional explicitly named libraries.

**Spec:** `docs/product/PRODUCT_SPEC.md` and `docs/product/ARCHITECTURE_DECISIONS.md`.

**Dependencies:** EP-None (numbers or notes as written).

## Global constraints

- Preserve baseline workouts, offline operation, current profile sync, auth and backups.
- New services and permissions default off. No production changes, merges or publication without separate approval.
- Check exact upstream licenses, service APIs and model terms at implementation time.
- Feature code must use test-first RED/GREEN/REFACTOR and a meaningful reviewer gate.

## Proposed file map

`CLAUDE.md`, `.github/workflows/test.yml`, `docs/ARCHITECTURE.md`, `docs/product/BASELINE_REPORT.md` (proposed), no production source files unless baseline defects demand a separate PR.

> Proposed paths are not guaranteed to exist. Confirm actual code layout and integration seams before writing; document changes to the file map.

## Review focus

Misidentifying upstream failures, assuming stale branch identity, passing test runs with no binding rights, using upstream prebuilt Docker image for fork changes.

## Cross-module interfaces

- **Inputs:** current authenticated profile and existing domain records; optional external data only through bounded validated adapters.
- **Outputs:** normalized and versioned records or read-only derived UI values, not hidden global side effects.
- **Failures:** explicit opt-out/unavailable/retry behavior; no negative impact on core workout logging.
- **Handoff:** versioned API/record contract and suite log linked in the PR, reviewed before dependent epic starts.

## Task checklist

### Task 1 — Confirm repository and worktree

- [ ] **Inspect:** Use GitHub read API and local git to establish `main`/upstream SHAs, existing remotes, closed PRs, and current clean worktree. Create a new isolated branch from verified current `main`; do not resurrect closed-PR branches.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** A machine-readable record of SHA, Node version, npm version, CI configuration, git status and remote URLs (omit credentials).

### Task 2 — Reproduce baseline tests

- [ ] **Inspect:** Use checked-in commands for frontend, API and MCP, plus build/source generation checks. For each nonpassing suite: repeat focused check and compare upstream before labeling as a new defect.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** A table of check/command/result/log excerpt and each failure classified baseline, environment, or new regression.

### Task 3 — Smoke core user paths

- [ ] **Inspect:** On a disposable local/staging instance with synthetic users, test first-run registration, login, opening workout, set logging, export, offline save and reconnect. Inspect screenshots, console and network.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Actual browser/device evidence and documented limitations; no production access or data changes.

### Task 4 — Enforce PR guardrails

- [ ] **Inspect:** Write PR template/checklist for test evidence, license/media warnings and feature flags, preserving upstream CI expectations. Keep changes docs-only if possible.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Reviewable baseline report and a CI gate that is visible on the draft PR.

## Verification and acceptance

**Minimum evidence:** `git status`; Node 22 frontend/API/MCP full suites; production build; source/docs checks; Docker smoke on a disposable instance; confirm CI workflow behavior.

- [ ] Relevant pure unit tests, negative cases, integration/E2E checks and complete impacted regressions pass.
- [ ] All new routes are reflected in the OpenAPI spec; generated docs match.
- [ ] Accessibility, localization, reduced motion, performance and privacy impacts are reviewed.
- [ ] Feature is correctly disabled without breaking baseline app, and README/docs explain setup and rollback.
- [ ] Draft PR is linked to this plan; every claimed test has a specific run or artifact.
- [ ] No direct merge/deploy and no unrelated changes.

## Execution handoff

Before code: inspect latest repository baseline and confirm the feature design as a separate small spec. After implementation: report files, commits, RED/GREEN evidence, complete regression status, actual screenshots where relevant, licensing, blockers and next dependency. No feature is complete on a plan-only or UI-only basis.



