# Final MVP fix — scoped re-review

Date: 2026-11-14. Frozen checkout: `/code/openGym-fork/.worktrees/review-mvp`.

- **Exact reviewed HEAD:** `766a99a297710f40a65f1a5743f4046cc50a9076`.
- **Runtime:** `0a56181bb259a6ff90eb6c699ad55c9e052a8456`.
- **Scope:** `3864f39e3a33eaf491d9094300a3b93f15e89351..766a99a297710f40a65f1a5743f4046cc50a9076`; original I1, M1 and possible breakage introduced by this correction only. This is not another whole-branch review.
- **Disposition:** **2 addressed, 0 open. No new Critical, Important or Minor finding.**

Read the supplied fix package, actual changed source/tests/guide, final-fix plan/evidence summary, exact focused logs, browser scripts/results, verification record and cleanup record. The prior whole-branch verdict supplies the unchanged context and release limits.

## I1 — Addressed

[frontend/src/lib/nutrition/entry.js:6](/code/openGym-fork/.worktrees/review-mvp/frontend/src/lib/nutrition/entry.js:6) introduces a private UUID helper. It calls native `crypto.randomUUID()` when available, preserving its receiver and existing behavior. Otherwise it obtains exactly 16 bytes from `crypto.getRandomValues`, sets byte6's high nibble to version4, sets byte8's top bits to the RFC4122 variant, and emits lowercase hex in canonical 8-4-4-4-12 groups. The remaining 122 bits retain cryptographic entropy. There is no insecure random source, timestamp identity, fingerprint substitution or dependency.

`createEntry` now calls that helper at [entry.js:56](/code/openGym-fork/.worktrees/review-mvp/frontend/src/lib/nutrition/entry.js:56). All validation, snapshot copying, fingerprint checking, filing and nutrient handling are unchanged. No existing ID is rewritten. No UI/store/API/sync runtime changed. The existing push fallback is a hyphenless device identifier, so using a small local conforming helper is reasonable.

The new `entry-uuid.test.js` exercises the real creation path for manual and confirmed-lookup events with genuine Web Crypto entropy. It checks native dispatch without fallback use, valid/distinct v4 IDs when `randomUUID` is absent, support by `normalizeEntry`, equality of every non-ID field between native and fallback paths, and deep source-copy preservation. The added `FoodLookup.test.jsx` cases exercise actual manual and lookup Save handlers through the real store, duplicate-submit protection, local persistence and repeated distinct meals retaining the same source fingerprint. Existing test assertions are retained.

## M1 — Addressed

[docs/MODULES.md:27](/code/openGym-fork/.worktrees/review-mvp/docs/MODULES.md:27) now documents optional authenticated/operator-enabled lookup after the Nutrition choice syncs, distinguishes preview from Save, retains offline manual logging and links the existing integration guide. The stale no-lookup claim is removed while the unchanged Coach/MCP scope remains clear.

[docs/MODULES.md:84](/code/openGym-fork/.worktrees/review-mvp/docs/MODULES.md:84) qualifies the missing-key default with the opt-in exception. [docs/MODULES.md:92](/code/openGym-fork/.worktrees/review-mvp/docs/MODULES.md:92) adds the food-lookup server readers and the strict stored `modules.nutrition === true` authorization requirement. These changes implement the requested correction without runtime scope expansion.

## Evidence inspected

These are author-run results, not reviewer reruns. Node **v22.23.5** is recorded in the evidence.

| Evidence | Observed result |
| --- | --- |
| `uuid-red.log` | 4 failed / 33 passed, 2 files; reported exit1. Actual failures include missing `crypto.randomUUID` and both UI Saves failing to create a row. |
| `uuid-green.log` | 37 passed, 2 files; reported exit0. Same focused command as RED. |
| `covering.log` | 171 passed, 14 files, 8.40s; reported exit0. Log includes the full selected command. |
| `build-before.log` / `build-after.log` | Successful production builds, 1.66s / 2.51s; existing chunk/import warnings retained. |
| `static.log` | 19 locales ×3,684 keys; 3,030 strict source strings; all three generators in sync. |

History confirms plan `12995194`, test RED `d3172713`, natural-origin browser RED `82a13000`, then runtime GREEN `0a56181b`. The later `766a99a2` changes only documentation/evidence. Independently checked the post-runtime changed paths and the runtime source hash; `entry.js` matches the recorded SHA256 `6d3bf2e5bcc79c3b98c12e1f0b6d4e3593e481168b3d0157cd45bd868d344081`. The synthetic preload hash also matches its record. No API/MCP source or dependency change appears in this correction.

The browser scripts and exact result logs establish a natural non-loopback origin, `http://172.17.0.4:5180`, with `isSecureContext: false`, `randomUUID: undefined`, and `getRandomValues: function` before and after the fix. The seed script changes synthetic profile/session storage, not crypto capabilities. The RED script asserts both Saves fail and zero rows persist; its exit0 means the defect was reproduced. Two earlier startup/coordinate failures remain recorded and are not treated as feature passes.

The GREEN script asserts manual Save, explicit lookup Save, repeated distinct events, duplicate-click protection, three valid/distinct UUIDs, matching real server IDs and reload retention of source snapshot/fingerprint. Its arithmetic is consistent: 250mL at40kcal/100mL produces100kcal, known protein zero and omitted carbohydrate. Error/unhandled-rejection capture remains empty across the corrected flow/reload. Browser results and saved synthetic rows agree. One synthetic transport request is recorded; subsequent previews use the server cache. No live provider or enrollment claim is made. Cleanup records successful command completion and tab closure before owned-process/data cleanup.

Reviewer `git diff --check 3864f39e HEAD` passed with no output. The frozen checkout was clean. No unresolved source question required an independent runtime probe: the small implementation and relevant tests/browser evidence settle I1 directly.

## Declined to judge

- **Corrected full frontend acceptance:** explicitly parent-owned and still pending. The prior full frontend run predates this runtime correction; focused success is not a replacement or a claim that the corrected full suite passed.
- **Unchanged whole-branch behavior:** outside this scoped re-review. Earlier API/MCP evidence remains applicable under the parent's source-unchanged ruling; these suites were not rerun.
- **Release/platform gates:** CI dispatch/CLA, Docker build/boot, isolated HTTPS/passkey staging and rollback, physical/native devices, Safari, full assistive-technology coverage, cold-start offline, all19 human translations and unchanged dependency advisories retain their earlier limits. A synthetically seeded authenticated HTTP session does not test password/passkey enrollment. No new live provider validation was authorized.

## Verdict

**Spec compliance: PASS for this scoped correction.** I1 and M1 are addressed.

**Code quality/correctness: PASS for this scoped correction.** No new Critical, Important or Minor defect confirmed; no residual finding requires parent adjudication and no further correction is requested.

**Draft-integration readiness:** the reviewed correction is accepted for the parent's corrected full frontend gate and draft integration review. Final combined acceptance remains conditional on that pending one-worker frontend run passing on the corrected source. This scoped PASS closes the original I1/M1 findings; it does not certify the pending gate.

**Production release: NOT APPROVED.** The previously documented external release gates remain outstanding. No protected merge, deployment, publication or GitHub review submission is authorized here.

Only `/tmp/opengym-review/mvp-final-fix-verdict.md` was written. No source/index/Git mutation, agents, installs, suite/build reruns, browser/server use or provider calls were performed by this reviewer.
