# EP-03 implementation plan

Approved scope: `briefs/EP-03.md` and `briefs/WAVE-2-common.md`, including the
owner's cloud/Codex exception. Sole implementer; parent arranges independent Codex
review. No persisted fields, dependencies, module switch, deployment, protected
branch writes or progress-ledger edits.

## Confirmed files and interfaces

- `frontend/src/lib/exercise-volume.js` and adjacent test: pure
  `exerciseVolumeSeries(S, exId, { days = 0, now = Date.now() } = {})` returns
  `{ unit, points, included, excluded, reasons }`. Points are
  `{ t, d, y, sets }`, one per session, sorted chronologically. `reasons` counts
  `timedOrCardio`, `noVolume`, `missingDetails`; their sum is `excluded`.
- Use `exView` to convert the selected exercise and bodyweight into its pinned
  unit; `entriesForExercise` to include every occurrence; `workoutAt` and
  `workoutDay` for time/date; `workoutVolume`, `countsWarmups`, `countsBodyweight`
  and `bodyweightFor` for the established volume semantics. Explicitly filter
  rows with `modeForSet`: inspection confirmed `completedVolumeOf` does not
  reject a timed row carrying stale reps. Sets count completed reps limbs/rows,
  with drops part of their parent set and warm-ups following the same setting.
- A session with entries for another exercise is irrelevant. A dated legacy
  session without entries cannot be attributed: count it as missing details,
  never use its whole-session `vol`. All exclusions are inside the selected
  window. Undated/invalid-day records cannot be placed in a time window and
  are ignored. No positive volume means no plotted zero. Mixed sessions use
  only the selected exercise's reps rows. Assisted exercises return no points
  and never get the option.
- Windows include today and the previous `days - 1` local calendar days;
  compare canonical workout days to local midnight boundaries using calendar
  arithmetic (DST safe). All includes every valid dated session. Preserve
  timestamps for separate sessions on the same day and local-noon `d` fallback.
- `frontend/src/views/Stats.jsx`: opt-in Volume selector, pinned-unit chart,
  honest exclusion sentence, no-volume empty state, full semantic table with
  Date/Sets/Volume, caption and column headers. A single valid session is a
  valid chart dot plus table row. Existing charts and defaults are unchanged.
  Guard entry iteration for legacy sessions without details. Add 1W to shared
  range options without changing existing range calculations.
- `Stats.ex-volume.test.jsx`: real helper integration, picker visibility,
  chart points/unit, table, single-session and empty range, exclusions,
  duplicate entries and legacy record. Append shared 1W tests to
  `Stats.ex-range.test.jsx` and `Stats.exercise-time.test.jsx`; keep all
  pre-existing assertions untouched.
- `frontend/src/locales/*.js`: new strings beside Stats keys in all 19 packs,
  explicit pt-BR overrides so inherited-key fingerprint stays unchanged.
- `docs/superpowers/evidence/EP-03/`: committed logs, synthetic fixture/browser
  script, captures, bundle comparison and final evidence report.

## Hand reconciliation fixture

For the same exercise appearing twice in a workout: first entry has a completed
50 kg × 5 row with a 40 kg × 3 drop (250 + 120 = 370 kg); second entry has a
completed 30 kg × 4 row (120 kg). Total is **490 kg, 2 sets, 1 session**.
An unrelated exercise, unfinished rows and excluded warm-ups add nothing.
Separate sessions on the same day remain separate points and table rows.

## Commit milestones and validation

1. Commit this inspected plan before source changes.
2. RED pure tests (actual failure in commit body); GREEN helper. Cover all
   required cases: 7-day midnight, 30/90/365/All, same-day sessions, d-only,
   kg/lb pins, warm-ups/bodyweight toggles, sides, drops, dumbbells, modes,
   no completed work, legacy details, duplicate occurrences, nonmutation.
3. RED UI/range tests; GREEN Stats and locales. Run every Stats regression.
4. Browser via browser-harness skill: isolated synthetic profile, blocked
   `/exercise-media/`, keyboard only, reduced motion, 320/390/1280 dark/light.
   Inspect captures, overflow, focus, single-point/empty range and requests.
   If shared five-segment range fails at 320 px, scope 1W to Exercise progress.
5. Node **22.23.5**, sequential suites, two workers: frontend full tests and
   production build; locale and strict source-string checks; API full tests
   with test concurrency 2; MCP full tests with two workers; three generator
   checks. Report exact counts, commands, exit codes, evidence and gaps.
   Compare entry/Stats chunks to BASELINE_REPORT.md (raw and gzip).
6. Inspect diff, commit evidence, pull --rebase origin next/integration, push
   assigned branch only, draft PR against next/integration using its template.
   Report exact head and request parent-managed independent review.

## Preparation evidence

Required brief, common rules, architecture, contribution, notices, product,
decisions, gates, baseline and data-contract documents read. Discovery verified
against actual helper definitions; discovery's old dependency blockers are
superseded by the merged baseline and bounded brief. The outline's named
superpowers execution/TDD skills are not in either local skill directory and
the connected skill catalog returned no match; the explicit RED/GREEN workflow
above applies. Windows prerequisites are expressly waived, not silently skipped.
Official Node tarball checksum verified; root/frontend/api/mcp lockfile installs
required before tests. Shared VPS load/disk checked; suites remain sequential.

## Delivery decisions and verification limits

- Runtime stable at `f28c91eafa1848a831493a96a82bc818738ad7bb`, rebased onto
  `next/integration` `2efd92da` and pushed for parent-managed review. Draft PR #9.
  Post-runtime fixture refinement uses actual dumbbell exercise ids 0289/0292
  and checks both recorded `each` and `total` meanings; no runtime code changed.
- Shared 1W is retained: browser measurements show approximately 47.4 px per
  segment at 320 px, with no clipped text or horizontal overflow.
- Six dark/light width combinations and a seventh normal-motion 390 px run
  exercised the real Stats picker, chart and table with keyboard input. The
  latter also checks pinned lb, empty range and offline single-session display.
  See `../evidence/EP-03/browser-qa.py`, JSON results and 17 captures.
- The existing shared picker does not move/trap focus on open. Shift+Tab works
  but has unnecessary focus stops; fixing the shared sheet is outside EP-03.
- Full frontend emitted 7,952 passed / 1 timed out in 663 files. The unchanged
  media-sync file passed 31/31 in isolation at its normal timeout. The outer
  verification session returned 143 after the full summary; individual final
  checks were resumed in TTY sessions. Neither fact is a full frontend pass.
- Parent explicitly directed no second full frontend run on this branch.
  Acceptance remains **conditional** on its one-worker full frontend run on
  the combined reviewed candidate and independent Codex review. Preserve both
  original failure and isolated success. No merge or deployment is performed.
