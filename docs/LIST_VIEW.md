# Workout view — cards / list / compact

The active workout screen (`frontend/src/views/Workout.jsx`) has three layouts, chosen by
`S.workoutView` (`'cards' | 'list' | 'compact'`, default `'cards'`). It is purely
presentational — the same `s.active` session, entries and finish path in every layout, and
every set handler is already entry-index parameterised, so the layouts only change what is
rendered.

| Value | What you see |
|---|---|
| `cards` | One unit at a time, `Prev` / `Next` + swipe. The original flow. |
| `list` | Every unit stacked and scrollable. Each non-current unit has a **Set current** chip in its header; completion still auto-advances the current marker, starts rest and can open the top-weight sheet. Blocks render with the `compact` `ExerciseBlock` prop (smaller). |
| `compact` | `list`, with each `ExerciseBlock` also rendered `dense`: no media, no tag chips (Cardio / per-side / target / equipment / **Best:**), no note lines, no "Last time …" recap, no bar-and-plates chip, no progression-guidance line, no "Make superset with previous/next". Just the name, the ⋯ menu and the set rows. |

Everything `compact` hides is still on the ⋯ menu (note, details, history, bar weight,
progression settings) or is display-only.

Unknown / absent values read as `cards`, so a profile written before the setting existed is
unchanged.

Orthogonal to all three: **Settings → During a workout → Workout controls** (`S.wc`) decides
whether Move / Swap / Remove, the pair buttons, the drop/burst shortcuts and the `+/-`
steppers show inline. The lean default keeps them in each exercise's ⋯ menu; turning
`exerciseButtons` on adds a footer Move / Swap / Remove row that acts on the current unit
(and, in `list` / `compact`, the "…act on the exercise marked Current" hint).

## Where it is set

- **Saved default:** Settings → During a workout → **Workout view** (a 3-way `Segmented`).
- **Per session:** the workout header's **⋮** button opens a `menuSheet` with the three
  layouts; picking one writes `s.active.workoutView`.

`beginWorkout` / `beginBackfill` (`frontend/src/sheets.jsx`) snapshot `S.workoutView` onto
`s.active.workoutView` when the session is created, and the render prefers
`A.workoutView || S.workoutView`. So the ⋮ menu re-lays-out the running session only, and
changing the saved default never disturbs a workout already in progress.

## Tests

Component-level, no new `lib/` helper:

- `frontend/src/views/Workout.test.jsx` — `workout list view`, `workout compact view`,
  `workout view header menu` describe blocks.
- `frontend/src/views/Settings.workoutview.test.jsx` — the 3-way Segmented.
- `frontend/src/sheets.workoutview.test.jsx` — `beginWorkout` / backfill snapshot behaviour.
