# EP-03 round 1 scoped re-review

Frozen HEAD: `44b24eedae8759157fe3e2170e44dff56eeed2d4`. Reviewed only the fix range `470defb7..44b24eed` for draft PR #12, against original I1 in `/tmp/opengym-review/ep03-verdict.md`. Read the supplied fix diff, appended author evidence and rebase mapping, changed source/tests, and relevant existing assistance/bodyweight helpers. The externally merged original PR #9 and API PR #11 were not reopened.

**I1: ADDRESSED.** Saved target-level and entry-level assistance is now filtered before arithmetic. The latest saved occurrence controls option visibility, and ordinary history survives mixed/return-to-ordinary scenarios. The original I1 probe now returns no points, zero included, one excluded (`noVolume`).

**Spec compliance: FAIL for this revision — one new Important defect in the newly enabled explicit-false override path.**

**Task quality: CHANGES REQUIRED.** The correction is otherwise narrow and test-first. No Critical or Minor findings.

## Important I2 — Explicit non-assisted overrides regain assistance arithmetic when bodyweight volume is enabled

**Locations:** `frontend/src/lib/exercise-volume.js:36` (new admission of saved false overrides), `frontend/src/lib/exercise-volume.js:44` (calculation), and `frontend/src/views/Stats.jsx:807` (new eligibility).

**Trigger:** The fix explicitly supports an assisted catalogue ID saved with `target.assisted: false`. Take ID `0017` (assisted pull-up), saved bodyweight 80 kg, five completed reps, and a logged load of 30 kg. With `volumeBodyweight: true`, the series produces **250 kg**, calculated as `(80−30)×5`. Increasing the ordinary logged load to 40 kg reduces volume to **200 kg**; at 80 kg the positive completed set disappears as a `noVolume` exclusion.

This is newly reachable through this fix: the original implementation rejected assisted catalogue IDs entirely. The filter and UI now correctly resolve this entry as non-assisted, but `workoutVolume` still calls `bodyLoadOf(e.id)` at `frontend/src/lib/history.js:781`. That ID-only lookup returns `assisted: true` and selects subtraction at `history.js:787`. Thus the newly admitted record has contradictory meanings between eligibility and arithmetic, inverting the volume trend for a logged load declared ordinary.

**Independent evidence:** Two tiny inline Node **v22.23.5** processes, no test workers or files, imported the frozen real helpers. Results:

| Saved shape | Bodyweight volume | Logged load × reps | Observed result |
|---|---|---|---|
| Original I1: ID 0025, target assisted true | off | 30 × 5 | No point; one exclusion — corrected |
| ID 0017, target assisted false, bw 80 | off | 30 × 5 | 150 |
| Same false override | on | 30 × 5 | 250 |
| Same false override | on | 40 × 5 | 200 |
| Same false override | on | 80 × 5 | No point; one exclusion |

The same probe confirmed `isAssisted(entry) === false` while `bodyLoadOf('0017')` returns `{ share: 1, assisted: true }`. Resolving the catalogue object with its explicit false flag through `bodyLoadOf` returns null under the existing equipment rules, so this is not a justified subtraction of ordinary load.

**Required correction:** Carry the saved assistance meaning consistently through bodyweight-volume calculation for the newly supported false override. Never subtract a load already classified as non-assisted. Preserve the existing rules for whether an exercise receives a bodyweight contribution, and avoid changing unrelated Stats totals. Add helper and Stats regressions combining explicit false overrides with `volumeBodyweight: true`, including a rising load and the load-equals-bodyweight case. The new false-override test at `frontend/src/lib/exercise-volume.test.js:176` uses the default bodyweight-off setting and therefore misses this interaction. Keep this correction scoped; it does not require reopening unrelated helpers' consumers.

## Evidence checked

- Published RED `e7ef4935` precedes GREEN `b352d3cc`. RED log records 11 failed/34 passed, GREEN 45/45; the focused regression log records 215/215 across 17 files. Source/tests add the required target/entry overrides, earlier ordinary history, mixed duplicates, window exclusions and return-to-ordinary behavior without weakening previous assertions.
- Build log reports success in 4.43 s with existing warnings. Locale/source-string logs report 19 packs × 3,618 keys and 2,964 strings. These are inspected author runs, not reviewer reruns.
- All six browser JSON scenarios agree with their script: four assistance eligibility cases hide Volume; mixed return and Arabic RTL retain 250/200 with two included and one excluded. Both table scenarios contain AX table/columnheader/rowheader roles. Each scenario records two guest `/api/me` 401 responses and matching console errors, no media elements and no overflow/clipped range labels.
- Independently inspected `round1-volume-ar-rtl-320.png`: translated table/caption/note and both rows fit the 320 px RTL layout. This closes the earlier missing localized/RTL sample, not all-locale or screen-reader certification. No browser was launched for this review.
- `git diff --check 470defb7..44b24eed` passed. Checkout status remained clean. The fix changes only the two runtime files, their tests and EP-03 evidence; no dependency, persistence, locale or unrelated Stats-series change.

## Evidence limits retained

- **Combined frontend acceptance remains pending.** Original 7,952 passed/1 timeout, outer exit 143/missing child exit and isolated 31/31 remain historical evidence. No full suites, build or browser jobs were rerun here. Platform/device, full assistive-technology, existing picker-focus, cold-start offline, staging/deployment and baseline-comparison limits from the original report remain.
- **Pre/post-rebase equality could not be independently verified here.** README maps tested GREEN `3d996466fcd4f4e8dea34ba90d60bbc36351f994` to published `b352d3ccfa00cba040b85246b027f317641e4a14`; the old object is unavailable in this checkout. Published RED/GREEN history and source were inspected, but the claimed byte equality remains author evidence. A read-only `git cat-file` unexpectedly triggered the partial clone's automatic remote lookup and failed with `not our ref`; subsequent Git reads disabled lazy fetching. No explicit fetch, source edit or Git-state mutation was performed. This exception is disclosed rather than claiming every command was network-free.

Only `/tmp/opengym-review/ep03-fix1-verdict.md` was written. No subagents, services, installs, exercise-media access, implementation edits or heavy jobs. Resolve I2 with focused evidence and re-review; retain the parent's separate combined-candidate acceptance gate.
