
# EP-02 — Premium UI Foundation and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for behavior, data, security and hardware work) or `superpowers:executing-plans` to implement each reviewed task. Use `superpowers:test-driven-development` for each behavior change. This document is an outline until its feature-specific design has been approved and exact source paths confirmed. Steps use `- [ ]` for progress tracking.

**Goal:** Make existing workout/Home flows more polished without increasing interaction cost or core bundle weight.

**Architecture:** Add narrowly scoped behavior to the existing React/Zustand/Node/Capacitor system; each milestone can be tested and reviewed independently.

**Tech stack:** Existing React 19 / JavaScript / Vite / Node 22, repository-native unit and integration tests, optional explicitly named libraries.

**Spec:** `docs/product/PRODUCT_SPEC.md` and `docs/product/ARCHITECTURE_DECISIONS.md`.

**Dependencies:** EP-00; 01 contracts as needed (numbers or notes as written).

## Global constraints

- Preserve baseline workouts, offline operation, current profile sync, auth and backups.
- New services and permissions default off. No production changes, merges or publication without separate approval.
- Check exact upstream licenses, service APIs and model terms at implementation time.
- Feature code must use test-first RED/GREEN/REFACTOR and a meaningful reviewer gate.

## Proposed file map

`frontend/src/index.css`, `frontend/src/components/` (proposed design tokens/shared pieces), `frontend/src/views/Home.jsx`, `frontend/src/views/Workout.jsx`, `frontend/src/App.jsx`, `frontend/src/locales/`.

> Proposed paths are not guaranteed to exist. Confirm actual code layout and integration seams before writing; document changes to the file map.

## Review focus

Touch affordances, mobile layouts, low contrast, animation trapping navigation, excessive first-load JS, reduced-motion regressions.

## Cross-module interfaces

- **Inputs:** current authenticated profile and existing domain records; optional external data only through bounded validated adapters.
- **Outputs:** normalized and versioned records or read-only derived UI values, not hidden global side effects.
- **Failures:** explicit opt-out/unavailable/retry behavior; no negative impact on core workout logging.
- **Handoff:** versioned API/record contract and suite log linked in the PR, reviewed before dependent epic starts.

## Task checklist

### Task 1 — Capture baseline UI and spec

- [ ] **Inspect:** Inspect Home, Workout, Stats and Settings screens and existing CSS/theme tokens. Collect actual before screenshots and focus/interaction counts; decide a constrained token refresh.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Approved surface-by-surface design review with original functionality preserved.

### Task 2 — Introduce accessible design primitives

- [ ] **Inspect:** Test metric cards, settings rows, loading states, error/empty states, typography and touch targets before extracting shared components. Avoid global rewrite.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Small reusable primitives used in one real screen; snapshot/ARIA tests green.

### Task 3 — Integrate targeted Motion transitions

- [ ] **Inspect:** Add only specific shared-layout or spring sheet interactions with a reduced-motion branch. Lazy-import where possible and never delay set taps, timers, or saved input.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Interaction tests and perf traces show no regression in workout controls.

### Task 4 — Visual QA and locale parity

- [ ] **Inspect:** Render dark/light/accessibility/RTL cases on phone and desktop; add new localization keys through existing generation/check process; fix measurable issues.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Screenshot evidence and acceptance checklist, full affected tests and build green.

## Verification and acceptance

**Minimum evidence:** Playwright/DevTools screenshot comparison, Vitest components, keyboard/ARIA, viewport 320→desktop, reduced-motion, bundle delta.

- [ ] Relevant pure unit tests, negative cases, integration/E2E checks and complete impacted regressions pass.
- [ ] All new routes are reflected in the OpenAPI spec; generated docs match.
- [ ] Accessibility, localization, reduced motion, performance and privacy impacts are reviewed.
- [ ] Feature is correctly disabled without breaking baseline app, and README/docs explain setup and rollback.
- [ ] Draft PR is linked to this plan; every claimed test has a specific run or artifact.
- [ ] No direct merge/deploy and no unrelated changes.

## Execution handoff

Before code: inspect latest repository baseline and confirm the feature design as a separate small spec. After implementation: report files, commits, RED/GREEN evidence, complete regression status, actual screenshots where relevant, licensing, blockers and next dependency. No feature is complete on a plan-only or UI-only basis.



