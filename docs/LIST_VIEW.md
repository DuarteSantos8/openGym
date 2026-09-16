# Workout view — cards / list / compact / focus

The active workout screen (`frontend/src/views/Workout.jsx`) has four layouts, chosen by
`S.workoutView` (`'cards' | 'list' | 'compact' | 'focus'`, default `'cards'`). All four use the
same active session and completion pipeline.

| Value | What you see |
|---|---|
| `cards` | One unit at a time, `Prev` / `Next` + swipe. The original flow. |
| `list` | Every unit stacked and scrollable. Each non-current unit has a **Set current** chip in its header; completion still auto-advances the current marker, starts rest and can open the top-weight sheet. Blocks render with the `compact` `ExerciseBlock` prop (smaller). |
| `compact` | `list`, with each `ExerciseBlock` also rendered `dense`: no media, no tag chips (Cardio / per-side / target / equipment / **Best:**), no note lines, no "Last time …" recap, no bar-and-plates chip, no progression-guidance line, no "Make superset with previous/next". Just the name, the ⋯ menu and the set rows. |
| `focus` | One set at a time with large load/reps controls, nullable RPE, Complete/Skip actions, and a set pager. Supersets show one member at a time in round order. Existing Prev/Next and horizontal swipe still move between exercise units. |

Focus keeps its visible-set pointer in component state only. It starts at the first incomplete
set, falls back to the final set when the exercise is complete, and is not persisted. Completing
a set still routes through `ActiveWorkout.toggle`, so sound, haptics, rest, timed work,
high-water protection, and superset progression remain shared with every other layout.

Everything `compact` hides is still on the ⋯ menu (note, details, history, bar weight,
progression settings) or is display-only.

Unknown / absent values read as `cards`, so a profile written before the setting existed is
unchanged.

Orthogonal to all four: **Settings → During a workout → Workout controls** (`S.wc`) decides
whether Move / Swap / Remove, the pair buttons, the drop/burst shortcuts and the `+/-`
steppers show inline. The lean default keeps them in each exercise's ⋯ menu; turning
`exerciseButtons` on adds a footer Move / Swap / Remove row that acts on the current unit
(and, in `list` / `compact`, the "…act on the exercise marked Current" hint).

## Where it is set

- **Saved default:** Settings → During a workout → **Workout view** (a 4-way `Segmented`).
- **Per session:** the workout header's **⋮** button opens a `menuSheet` with the four
  layouts; picking one writes `s.active.workoutView`.

`beginWorkout` / `beginBackfill` (`frontend/src/sheets.jsx`) snapshot `S.workoutView` onto
`s.active.workoutView` when the session is created, and the render prefers
`A.workoutView || S.workoutView`. So the ⋮ menu re-lays-out the running session only, and
changing the saved default never disturbs a workout already in progress.

## Tests

Component-level, no new `lib/` helper:

- `frontend/src/views/FocusView.jsx` and `frontend/src/views/FocusView.css` — Focus layout.
- `frontend/src/views/Workout.test.jsx` — `workout list view`, `workout compact view`,
  `workout focus view`, and `workout view header menu` describe blocks.
- `frontend/src/views/Settings.workoutview.test.jsx` — the 4-way Segmented and Focus cases.
- `frontend/src/sheets.workoutview.test.jsx` — `beginWorkout` / backfill snapshot behaviour and
  Focus cases.
