
# EP-05 — Open Food Facts Barcode Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended for behavior, data, security and hardware work) or `superpowers:executing-plans` to implement each reviewed task. Use `superpowers:test-driven-development` for each behavior change. This document is an outline until its feature-specific design has been approved and exact source paths confirmed. Steps use `- [ ]` for progress tracking.

**Goal:** Support user-initiated product lookup with transparent provenance and safe diary conversion.

**Architecture:** Add narrowly scoped behavior to the existing React/Zustand/Node/Capacitor system; each milestone can be tested and reviewed independently.

**Tech stack:** Existing React 19 / JavaScript / Vite / Node 22, repository-native unit and integration tests, optional explicitly named libraries.

**Spec:** `docs/product/PRODUCT_SPEC.md` and `docs/product/ARCHITECTURE_DECISIONS.md`.

**Dependencies:** EP-04 (numbers or notes as written).

## Global constraints

- Preserve baseline workouts, offline operation, current profile sync, auth and backups.
- New services and permissions default off. No production changes, merges or publication without separate approval.
- Check exact upstream licenses, service APIs and model terms at implementation time.
- Feature code must use test-first RED/GREEN/REFACTOR and a meaningful reviewer gate.

## Proposed file map

`api/integrations/` or `api/addons/food.js` (choose after inspection), `api/server.js`, `api/openapi.yaml`, `frontend/src/lib/nutrition/food-source.js` and Nutrition UI.

> Proposed paths are not guaranteed to exist. Confirm actual code layout and integration seams before writing; document changes to the file map.

## Review focus

Missing/incorrect upstream nutrients, third-party data/image licenses, accidental passive third-party calls, account data leakage and SSRF.

## Cross-module interfaces

- **Inputs:** current authenticated profile and existing domain records; optional external data only through bounded validated adapters.
- **Outputs:** normalized and versioned records or read-only derived UI values, not hidden global side effects.
- **Failures:** explicit opt-out/unavailable/retry behavior; no negative impact on core workout logging.
- **Handoff:** versioned API/record contract and suite log linked in the PR, reviewed before dependent epic starts.

## Task checklist

### Task 1 — Define a fixed-domain lookup contract

- [ ] **Inspect:** Check Open Food Facts current API terms, attribution and rate policies; decide exact fields and user-visible source limitations. Do not treat image URLs as freely licensed.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Document request/response schema, input limits, User-Agent, caching and error states.

### Task 2 — RED test product normalization and security

- [ ] **Inspect:** Cover EAN/GTIN length/leading zeros, null nutrients, negative or out-of-range values, response truncation, unrecognized product, upstream timeout and untrusted URL.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Focused tests demonstrate safe failures before implementation.

### Task 3 — Implement authenticated lookup adapter

- [ ] **Inspect:** Create fixed-domain outbound request, short bounded cache, timeout/rate control, user-trigger condition and per-user authorization; document OpenAPI and avoid secret in response.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Integration test proves no request without lookup click and no profile data in outbound call.

### Task 4 — Wire verified product to diary

- [ ] **Inspect:** Preview brand/quantity/nutrients/allergen limitations and snapshot selected food only after explicit confirmation. Keep custom food/manual path always available.
- [ ] **RED:** Add a focused failing outcome test for the described user behavior or contract; capture the assertion and failure reason.
- [ ] **GREEN:** Implement the smallest feature to satisfy that test, with schema/permissions and UI as needed.
- [ ] **REFACTOR:** Remove unnecessary duplication and isolate responsibilities; rerun focused tests.
- [ ] **VERIFY:** Confirm the expected result below, relevant regression tests, and actual browser/device checks where applicable.
- [ ] **COMMIT/REVIEW:** Commit with a scoped message and request spec-compliance plus code-quality review before moving on.

**Expected outcome:** Reopen diary offline and see the saved snapshot; delete/edit retains provenance; E2E green.

## Verification and acceptance

**Minimum evidence:** Barcode validation, parsing and malicious payload tests; 401/403/429/502 route tests; consent and no-request-on-load browser check.

- [ ] Relevant pure unit tests, negative cases, integration/E2E checks and complete impacted regressions pass.
- [ ] All new routes are reflected in the OpenAPI spec; generated docs match.
- [ ] Accessibility, localization, reduced motion, performance and privacy impacts are reviewed.
- [ ] Feature is correctly disabled without breaking baseline app, and README/docs explain setup and rollback.
- [ ] Draft PR is linked to this plan; every claimed test has a specific run or artifact.
- [ ] No direct merge/deploy and no unrelated changes.

## Execution handoff

Before code: inspect latest repository baseline and confirm the feature design as a separate small spec. After implementation: report files, commits, RED/GREEN evidence, complete regression status, actual screenshots where relevant, licensing, blockers and next dependency. No feature is complete on a plan-only or UI-only basis.



