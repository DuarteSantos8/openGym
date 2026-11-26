# EP-03 independent review

Reviewed 2026-11-14, read-only in `/code/openGym-fork/.worktrees/review-ep03`, HEAD verified as `97fca350d6f35fdc3f3758422578962e2a508877`. Runtime files are unchanged from `f28c91eafa1848a831493a96a82bc818738ad7bb`; later changes are fixtures and evidence. Reviewed the supplied complete task diff, requirements, inherited common rules, product/data contracts, plan, real helpers, UI, tests, history and committed evidence. Parent orchestration commits are excluded from task-scope findings.

**Spec compliance: FAIL — one Important defect violates the assisted-exercise exclusion.** Other bounded deliverables are substantially implemented. Full acceptance also remains conditional on the separate combined-candidate frontend gate.

**Task quality: CHANGES REQUIRED — one Important data-meaning defect.** The implementation is otherwise small, readable, appropriately derived, and supported by useful tests and candid evidence. No Critical or Minor defects confirmed.

## Defects

### Important I1 — Saved assistance overrides are plotted as lifted volume

**Locations:** `frontend/src/lib/exercise-volume.js:20`, `frontend/src/lib/exercise-volume.js:35`, and `frontend/src/views/Stats.jsx:802`.

**Trigger:** An otherwise ordinary exercise has a saved entry such as:

```js
{ id: '0025', target: { mode: 'reps', assisted: true },
  sets: [{ w: 30, r: 5, done: true }] }
```

This is a supported data shape, not an invented malformed record. `frontend/src/lib/exercises.js:268` documents routine/custom assistance overrides; `isAssisted` reads `target.assisted` at `frontend/src/lib/exercises.js:295`. Existing `frontend/src/views/Stats.bodyweight.test.jsx:90` and `frontend/src/lib/onerm.test.js:209` explicitly cover target-declared assistance.

The new helper and UI check only `isAssisted(exId)` / `isAssisted(curEx)`. They never inspect assistance on the saved entry or target. The helper therefore feeds assistance weight into `workoutVolume`, and the positive result enables the Volume option. A user can see increased machine assistance presented as increased exercise volume, contrary to the brief's explicit rule that assistance is not lifted load and the option must be hidden for assisted exercises.

**Independent confirmation:** One inline, single-process offline probe using Node **v22.23.5**, importing the frozen real helper, `isAssisted`, and `metricEntriesForExercise`, exited 0 and returned:

```json
{
  "assistedByEntry": true,
  "assistedById": false,
  "metricMode": "reps",
  "volume": {
    "unit": "kg",
    "points": [{ "t": 1794657600000, "d": "2026-11-14", "y": 150, "sets": 1 }],
    "included": 1,
    "excluded": 0,
    "reasons": { "timedOrCardio": 0, "noVolume": 0, "missingDetails": 0 }
  }
}
```

The probe used one workout on 2026-11-14 at local noon and `now` at 16:00 that day. UI eligibility follows directly from `curMode === 'reps'`, the false ID-only assistance check, and `allVolume.included > 0` at `Stats.jsx:802`. No browser was run for this review.

**Required correction:** Honor saved entry/target assistance as well as catalogue/custom-exercise identity before computing volume and deciding option visibility. Hide Volume for an exercise declared assisted through its routine/entry, and ensure assisted occurrences never contaminate any retained non-assisted history. Add helper and Stats regressions for `target.assisted: true` on a non-assisted catalogue ID, entry-level assistance, and mixed assistance history. Current visibility coverage at `frontend/src/views/Stats.ex-volume.test.jsx:48` only exercises the catalogue-assisted ID, so it misses this path. Keep correction within the authorized helper/UI/test paths.

## Independently checked strengths

- **Scope and persistence:** No new dependency, lockfile, store field, analytics persistence, API, module switch, provider call or media change. The task-only changed paths are authorized. Top set remains the default; Volume is opt-in component state.
- **Math:** Reuses `exView`, `entriesForExercise`, `workoutVolume`, `bodyweightFor` and volume settings. Pinned units convert stored profile weights and bodyweight consistently. Recorded dumbbell each/total meaning is preserved, rather than replaced by today's setting. Completed limbs, drops and warm-ups follow existing arithmetic. The fixture reconciles to `50×5 + 40×3 + 30×4 = 490 kg`, two sets, one session. The later real dumbbell fixtures are legitimate refinements.
- **Exclusions and dates:** Timed/cardio rows are filtered before volume, including stale weight/reps fields. Zero/unfinished work and missing details yield counted exclusions, not plotted zeroes. Duplicate entries aggregate once per workout; same-day workouts remain separate. Local calendar windows include today plus the preceding N−1 days; canonical workout days govern selection, real timestamps govern ordering, and d-only records use local noon. Tests cover 7/30/90/365/All and the stored New York run covers DST. Unplaceable invalid-date records are intentionally ignored, as documented in the plan.
- **Stats preservation:** Existing series calculations and default ranges remain unchanged. The three legacy guards are neutral for normal entry arrays and prevent missing-entry crashes. Existing Stats assertions were retained; the prior range-test mock only gains `weighInsSheet` to support the added case. Shared 1W coverage includes exercise, bodyweight and exercise-time cards.
- **Presentation:** The chart and semantic table consume the same points; caption, column headers and row headers expose date/sets/volume without hover. Single-session and empty-range behavior are explicit. All three new translated strings are adjacent to Stats keys in all 19 packs, including explicit pt-BR overrides; placeholders are preserved. Existing Volume/Date/Sets strings are reused.
- **History:** Plan `d1b7d32e` precedes helper RED `572e6c97` (21 failed/2 passed), helper GREEN `877ae66b` (63 focused passed; 23 in New York), UI RED `1245fae7` (8 failed/11 passed), and UI GREEN `f28c91ea` (19 focused/87 Stats passed). Commit bodies quote real RED failures and logs agree. Drop fixture corrections add the actual persisted dropset marker; no old assertion was weakened. Final fixture `2a5baa8b` has a 23/23 log.
- **Whitespace and revision:** `git diff --check 7a7663cb HEAD` exited 0. Runtime comparison from `f28c91ea` to HEAD is empty for the helper, Stats and locales. The review checkout was clean before and after inspection.

## Evidence gaps and practical limits — not additional defects

1. **Full frontend acceptance is pending.** `docs/superpowers/evidence/EP-03/README.md:72` accurately preserves 7,952 passed/1 media-sync timeout, outer exit 143 and missing child exit. The isolated 31/31 pass does not make that full run green. The parent's combined-candidate gate remains required (`README.md:81`). I did not rerun completed suites. Stored logs substantiate API 854, MCP 140, focused Stats/helper counts, build, locales, source-string and generator results; these are author runs inspected, not reviewer reruns.
2. **Browser evidence has bounded coverage.** Inspected all seven final JSON records and the synthetic script; they cover six width/theme reduced-motion cells plus normal-motion 390 dark, table roles, lb values, empty range and already-loaded offline All. The 17 screenshot paths exist; I visually sampled `volume-dark-320.png` and `volume-light-1280.png`. Samples match the table and chart data. All final records report no overflow/clipped ranges and no media elements; smallest range segment is about 47.4 px. Each records two guest `/api/me` 401 responses and corresponding console errors, rather than claiming a clean network console. Interrupted captures are separately identified. No live service or browser was used by this reviewer.
3. **Localized/RTL rendering and full assistive-technology behavior are not certified.** The browser fixture fixes `lang: 'en'` at `docs/superpowers/evidence/EP-03/browser-qa.py:62`. Pack completeness does not prove long translations/RTL fit or native-language wording quality. AX table evidence and keyboard reachability do not establish full screen-reader usability. The existing picker has excessive focus traversal, acknowledged at `docs/superpowers/evidence/EP-03/README.md:126`; it is outside this task's modifications. No new picker defect is attributed here.
4. **Bundle comparison is report-only and not isolated to EP-03.** Entry +700 raw/+240 gzip bytes; Stats +2,959 raw/+975 gzip against the published baseline. Checked `bundle.json`, its level-9 calculation script, build chunk names and baseline numbers. The baseline predates earlier wave work and uses a different environment; no separate integration-baseline rebuild is claimed. No build was repeated.

Only this report was written. No source, Git state, parent files, services, dependencies, or provider state were changed; no subagents or exercise media were used. Resolve I1, obtain focused correction evidence and independent re-review, then retain the parent's separate combined frontend acceptance gate.
