
# EP-03 — Advanced Performance Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for behavior, data, security and hardware work) or `superpowers:executing-plans` to implement each reviewed task. Use `superpowers:test-driven-development` for each behavior change. This document is an outline until its feature-specific design has been approved and exact source paths confirmed. Steps use `- [ ]` for progress tracking.

**Goal:** Extend existing real workout progress with understandable interactive insights, not synthetic metrics.

**Architecture:** Add narrowly scoped behavior to the existing React/Zustand/Node/Capacitor system; each milestone can be tested and reviewed independently.

**Tech stack:** Existing React 19 / JavaScript / Vite / Node 22, repository-native unit and integration tests, optional explicitly named libraries.

**Spec:** `docs/product/PRODUCT_SPEC.md` and `docs/product/ARCHITECTURE_DECISIONS.md`.

**Dependencies:** EP-01, 02 (numbers or notes as written).

## Global constraints

- Preserve baseline workouts, offline operation, current profile sync, auth and backups.
- New services and permissions default off. No production changes, merges or publication without separate approval.
- Check exact upstream licenses, service APIs and model terms at implementation time.
- Feature code must use test-first RED/GREEN/REFACTOR and a meaningful reviewer gate.

## Proposed file map

`frontend/src/views/Stats.jsx`, `frontend/src/lib/history.js`, `frontend/src/lib/analytics/{series,filters}.js` (proposed), `frontend/src/components/analytics/TrendChart.jsx` (proposed).

> Proposed paths are not guaranteed to exist. Confirm actual code layout and integration seams before writing; document changes to the file map.

## Review focus

Date/timezone shifts, lbs/kg mismatch, false zeros for unknown, expensive re-renders, loss of current Stats features.

## Cross-module interfaces

- **Inputs:** current authenticated profile and existing domain records; optional external data only through bounded validated adapters.
- **Outputs:** normalized and versioned records or read-only derived UI values, not hidden global side effects.
- **Failures:** explicit opt-out/unavailable/retry behavior; no negative impact on core workout logging.
- **Handoff:** versioned API/record contract and suite log linked in the PR, reviewed before dependent epic starts.

## Task checklist

### Task 1 — Inventory existing metrics

- [ ] **Inspect:** List current one-rep max, volume, sets, effort, muscle exposure and bodyweight Stats; choose incremental missing analyses only.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Source-to-metric map that identifies each calculation and provenance.

### Task 2 — Implement pure range calculations

- [ ] **Inspect:** Write RED tests for 7/30/90-day grouping, timezone/day boundary, two sessions same day, missing data and unit normalization. Add small helpers using existing `history.js` models.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Green deterministic pure tests and no stored duplicate summary.

### Task 3 — Progressive ECharts integration

- [ ] **Inspect:** Add ECharts only on selected Insights view with dynamic import, disposal, ResizeObserver cleanup, reduced-motion behavior, focusable controls and data table.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Chart screenshot, empty/offline case, no ECharts in initial Workout bundle.

### Task 4 — Verify current Stats parity

- [ ] **Inspect:** Compare existing analytics on fixtures before/after; check charts and mobile touch behavior across screen widths.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Zero changes to baseline outputs when feature is off; full Stats tests and build green.

## Verification and acceptance

**Minimum evidence:** Pure timeseries fixtures, window/units tests, chart fallback table, browser chart QA, perf budget, full Stats regression.

- [ ] Relevant pure unit tests, negative cases, integration/E2E checks and complete impacted regressions pass.
- [ ] All new routes are reflected in the OpenAPI spec; generated docs match.
- [ ] Accessibility, localization, reduced motion, performance and privacy impacts are reviewed.
- [ ] Feature is correctly disabled without breaking baseline app, and README/docs explain setup and rollback.
- [ ] Draft PR is linked to this plan; every claimed test has a specific run or artifact.
- [ ] No direct merge/deploy and no unrelated changes.

## Execution handoff

Before code: inspect latest repository baseline and confirm the feature design as a separate small spec. After implementation: report files, commits, RED/GREEN evidence, complete regression status, actual screenshots where relevant, licensing, blockers and next dependency. No feature is complete on a plan-only or UI-only basis.



