# EP-03 read-only discovery

Source: OpenCode reviewer thr_j2azi2kppd, 2026-11-14. This is a proposal, not an approved implementation scope. No code or dependencies were changed. EP-01/EP-02 must pass their integration gates first. The recommendation to defer ECharts is a tradeoff to resolve against the epic before dispatch, not a decision to remove a roadmap requirement.

EP-03 read-only discovery is complete. No code or repo files changed.

## Source-to-metric map

| Metric | Calculation | Provenance / unknown |
|---|---|---|
| Work sets, session/lifetime volume | `sessionVolume` → `workoutVolume`; warm-ups excluded by default; per-side, drops, dumbbells; optional bodyweight; `lifetimeVolume` sums | `S.workouts[].entries[].sets[].done/w/r/drops/sides`; exercise unit through `exView`; legacy `vol` only when entries are absent; timed/cardio contribute 0; tick times not required |
| e1RM | `e1rmSeries` / `best1RM`; formula setting; rep caps; assisted excluded | Completed reps rows only; no timed/cardio |
| Consistency / streak | `workoutDay` / `workoutAt`; `Heatmap`; `streakInfo`; report calendar | `w.d`, `w.start`; invalid dates excluded; no provenance |
| Muscle sets | `loadOfWorkouts` / effective-set logic | Entry id plus muscle snapshot; unknown exercise fallback |
| Effort | `effortSummary` / `avgRir` / `effortWeeks` | `rir` / `rpe`; only rated sets; unrated is unknown, not 0; denominators are shown |
| Exercise time | `entryTimes` / `exerciseTimeRows` | Tick times only; imported/pre-tick workouts explicitly have none |
| Bodyweight / relative strength | `weighInAt`; `bodyweightFor`; `relativeSeries` | `S.bodyweight`, `w.bw`; 30-day gap yields null; unit conversion through `exView` |
| PRs | `w.prs`; report `prsOf` | Recorded at finish only; imported workouts have `prs: []` and cannot be reconstructed |
| Report | `report.js` → `report-print.js` | Same sources; print/PDF only; covers volume buckets, consistency, muscle sets, top-lift e1RM, bodyweight, PRs and all workouts |
| Workout source | None | Parser `source` at `import-csv.js:931` is not persisted on the workout at `:919`; weigh-ins and HR do have `src`; no source filter is possible without a schema change |

## Already covered, do not duplicate

`report.js`/`report-print.js` already cover volume per week, consistency/calendar, muscle sets, top-lift e1RM, bodyweight, PRs and the all-workouts list. `report-print.js:292` has per-entry volume only for print detail cards and does not include bodyweight. Adding any of these to Stats would duplicate an existing feature.

## Recommended increment: per-exercise volume trend

This is the main missing trend: Stats has top set, per-set, e1RM, effort, max reps, bodyweight and relative strength, but no volume per lift; the report has total volume only, not a per-exercise trend.

**Shape**
- Add `Volume` to `exOpts` in `Stats.jsx` only when `curMode === 'reps'`, the exercise is not assisted, and at least one session has positive volume.
- Add `frontend/src/lib/exercise-volume.js` plus `exercise-volume.test.js`.
- `exerciseVolumeSeries(S, exId, { days = 0, now = Date.now() })` should:
  - use `exView(S, exId)`;
  - filter to `entriesForExercise(w, exId)`;
  - call `workoutVolume({ ...w, entries }, { warmups: countsWarmups(S), bodyweight: countsBodyweight(S) ? bodyweightFor(w, XS) : 0 })`;
  - emit `{ t: workoutAt(w), d: workoutDay(w), y: volume }`;
  - return included/excluded counts.
- Render with existing `LineChart`, `unit={XS.unit}`, plus a real `<table>` with Date, Sets and Volume. Do not rely on hover alone.
- Add one explicit note: `Included N sessions; excluded M timed/cardio, no completed reps, or old records without set details.`

**Unknowns and units**
- Timed and cardio work has no tonnage and must be excluded, not zero-plotted.
- Assisted machines are not meaningful here because the logged load is assistance; hide the option or exclude with a note.
- Bodyweight work counts only when the profile's bodyweight-volume setting is on.
- Imported sessions with completed reps count; missing tick times do not exclude them.
- Old records with only a whole-session `vol` and no entries cannot be attributed to one exercise.
- Use the exercise's pinned unit via `exView`; never mix kg/lb.

**7/30/90**
- The helper should accept 7, 30, 90 and All.
- Recommended UI: add `1W` to the shared `rangeOptions` at `Stats.jsx:54`, then test Body weight, Exercise progress and Exercise time. If you want zero changes to existing cards, keep the existing `1M/3M/1Y/All` and treat 7-day as helper-only.

**Tests**
- `frontend/src/lib/exercise-volume.test.js`: local-midnight 7-day boundary, two sessions on one day, `d`-only/no `start`, kg/lb pin, warm-ups on/off, bodyweight on/off, per-side/drops/dumbbells, timed/cardio, zero completed work, legacy entries absent, two entries for the same exercise.
- `frontend/src/views/Stats.ex-volume.test.jsx`: option visibility, chart points/unit, empty state, exclusion note, accessible table.
- Extend `Stats.ex-range.test.jsx` if `1W` is added.

**Not recommended now**
- A separate source-completeness card: no workout source is persisted, so it can only show field coverage, not source. If source completeness is a hard acceptance criterion, add one inclusion/exclusion line to the volume card instead.
- Adherence history: `S.weekTarget` is not versioned, so past weeks would use today's target.
- PR frequency: imported workouts have no `prs`.
- Training density: volume/min is noisy and not yet worth the UI.
- ECharts: one line does not justify it; existing `LineChart` is enough. Defer EP-03 Task 3 until multi-series/zoom is actually needed.

**Blockers**
EP-01/EP-02 are unmerged and EP-02 still needs corrected evidence. Implementation cannot start under the current constraints. Next step after approval is a focused RED/GREEN pure helper and tests, not a build.
