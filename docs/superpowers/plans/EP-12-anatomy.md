
# EP-12 — Interactive 3D Body Explorer With Licensed Anatomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for behavior, data, security and hardware work) or `superpowers:executing-plans` to implement each reviewed task. Use `superpowers:test-driven-development` for each behavior change. This document is an outline until its feature-specific design has been approved and exact source paths confirmed. Steps use `- [ ]` for progress tracking.

**Goal:** Offer a beautiful optional body/muscle explorer that degrades gracefully on mobile or unsupported GPUs.

**Architecture:** Add narrowly scoped behavior to the existing React/Zustand/Node/Capacitor system; each milestone can be tested and reviewed independently.

**Tech stack:** Existing React 19 / JavaScript / Vite / Node 22, repository-native unit and integration tests, optional explicitly named libraries.

**Spec:** `docs/product/PRODUCT_SPEC.md` and `docs/product/ARCHITECTURE_DECISIONS.md`.

**Dependencies:** EP-02, 03 (numbers or notes as written).

## Global constraints

- Preserve baseline workouts, offline operation, current profile sync, auth and backups.
- New services and permissions default off. No production changes, merges or publication without separate approval.
- Check exact upstream licenses, service APIs and model terms at implementation time.
- Feature code must use test-first RED/GREEN/REFACTOR and a meaningful reviewer gate.

## Proposed file map

`frontend/src/components/body3d/{BodyScene,BodyControls,BodyFallback}.jsx`, `frontend/src/lib/anatomy/{muscle-map,assets}.js` (proposed), `frontend/src/views/BodyExplorer.jsx`.

> Proposed paths are not guaranteed to exist. Confirm actual code layout and integration seams before writing; document changes to the file map.

## Review focus

BodyParts3D share-alike asset terms, Gym visual media misuse, heavy texture downloads, WebGL crashes, inaccessible interactions.

## Cross-module interfaces

- **Inputs:** current authenticated profile and existing domain records; optional external data only through bounded validated adapters.
- **Outputs:** normalized and versioned records or read-only derived UI values, not hidden global side effects.
- **Failures:** explicit opt-out/unavailable/retry behavior; no negative impact on core workout logging.
- **Handoff:** versioned API/record contract and suite log linked in the PR, reviewed before dependent epic starts.

## Task checklist

### Task 1 — Clear anatomy asset source and controls

- [ ] **Inspect:** Check each mesh’s license and attribution; map selected muscle IDs to current openGym exercise groups. No bulk import of BodyParts3D until license acceptance.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Asset manifest, derivation and display attribution review.

### Task 2 — TDD muscle mapping and selection

- [ ] **Inspect:** RED tests for exercise-to-muscle mapping, missed IDs, selected muscle focus and chart-linked state. Implement framework-free adapters.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Works with real user exercise categories without mutating workout records.

### Task 3 — Build optional lazy WebGL scene

- [ ] **Inspect:** Test version-compatible R3F/Drei/Three.js, lighting and LOD, a keyboard-accessible 2D alternative and WebGL failure handling.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Only the Body Explorer route loads 3D modules; screen works without WebGL.

### Task 4 — Visual and performance sign-off

- [ ] **Inspect:** Review mobile/desktop screenshots, touch gestures, reduced-motion, contrast, frame budget and memory leaks.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** No measurable startup/workout regression and asset attribution present.

## Verification and acceptance

**Minimum evidence:** Asset manifest/license check; React 19/R3F v9 tests; keyboard/2D fallback; mobile GPU and memory profiling.

- [ ] Relevant pure unit tests, negative cases, integration/E2E checks and complete impacted regressions pass.
- [ ] All new routes are reflected in the OpenAPI spec; generated docs match.
- [ ] Accessibility, localization, reduced motion, performance and privacy impacts are reviewed.
- [ ] Feature is correctly disabled without breaking baseline app, and README/docs explain setup and rollback.
- [ ] Draft PR is linked to this plan; every claimed test has a specific run or artifact.
- [ ] No direct merge/deploy and no unrelated changes.

## Execution handoff

Before code: inspect latest repository baseline and confirm the feature design as a separate small spec. After implementation: report files, commits, RED/GREEN evidence, complete regression status, actual screenshots where relevant, licensing, blockers and next dependency. No feature is complete on a plan-only or UI-only basis.



