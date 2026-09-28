# PROJECT_CONTEXT.md

Notes for whoever picks this up next. Not a spec — a map of what changed and why, kept next to
the code it describes. See `CLAUDE.md` for the general architecture; this file only covers the
drop-set / rest-pause work.

## What this adds

Two new set "shapes" on top of the existing straight/warm-up model:

- **Drop-set**: a main set followed by one or more weight drops, logged with no real rest.
- **Rest-pause / myo-reps**: an activation set (a normal set near failure) followed by short
  bursts of extra reps, each preceded by a brief rest.

Both are **planned on the exercise**, in the same config sheet used by the routine editor and by
"add exercise" mid-workout (`ExConfig` in `sheets.jsx`) — not decided live during the workout.
Planning it stamps every set of that exercise and pre-fills the actual drop/burst rows with
real, already-editable numbers the moment the session starts. A straight (unplanned) set can
still grow a drop/burst live via "+ Drop"/"+ Burst" — that path never went away, it just isn't
the primary one anymore.

## The set row (`frontend/src/lib/workout-model.js`)

There was never a `type` enum on a set row before this — only `phase` (`'work'` / `'warmup'`,
with a legacy `warmup: true` boolean as fallback). This adds a **second, orthogonal**
discriminator, `type`:

```js
phase: 'work' | 'warmup'                     // existing axis — prep or the real session?
type: 'straight' | 'dropset' | 'restpause'   // new axis — what shape is this row? (default 'straight')
```

A drop-set or rest-pause row is still exactly one entry in `entry.sets` — the extra work rides
*inside* that row, the same trick `phase` already uses for warm-ups:

```js
// dropset — main set + extra drops ON TOP of it (extraVolumeOf adds the drops back in for totals)
{ type: 'dropset', w: 100, r: 5, done: true, drops: [{ w: 80, r: 5 }, { w: 64, r: 5 }] }

// restpause — the row's own r IS the total across every burst; clusters are a BREAKDOWN of that
// same total, not extra on top of it (12 → [6, 3, 2, 1], and 6+3+2+1 == 12, always)
{ type: 'restpause', w: 60, r: 12, done: true, clusters: [{ r: 6, restSec: 15 }, { r: 3, restSec: 15 }, { r: 2, restSec: 15 }, { r: 1, restSec: 15 }] }
```

Those two extras genuinely mean different things, which trips people up (it tripped this
implementation up first): a drop-set's `drops` are *additional* work beyond the main set — the
main set stays a real, separate effort. A rest-pause row's `clusters` are the *decomposition* of
its own `r` — there is no separate "first burst is the real one" distinction, `r` already speaks
for the whole thing. Getting this backwards is exactly the bug this file's earlier revision had:
`r` held only the split's biggest chunk, so the row displayed a random-looking fraction of what
was configured instead of the number that was actually typed in.

Pure helpers in `workout-model.js`, mirroring the existing `phaseForSet`/`isWarmupRow` style:

- `setType(set)`, `isDropSet(set)`, `isRestPauseSet(set)` — read the discriminator.
- `dropsOf(set)` / `clustersOf(set)` — the extras array, or `[]` for anything else.
- `extraVolumeOf(set)` — weight×reps across a drop-set's `drops`, on top of the row's own w×r.
  **Zero for rest-pause** — see above, its `clusters` never add to this or they'd double-count.
- `addDrop(set, drop)` / `addCluster(set, cluster)` — pure append, stamps `type`.
- `removeDropAt(set, i)` / `removeClusterAt(set, i)` — pure remove by index; clearing the last
  one reverts the row to `'straight'`.
- `setDropAt(set, i, patch)` / `setClusterAt(set, i, patch)` — pure in-place edit (the weight/reps
  steppers on an already-added drop/burst).
- `nextDropWeight(prevWeight, pct)` — pct% lighter than `prevWeight`, rounded to the nearest .5.
- `nextBurstReps(prevReps)` — roughly half of `prevReps`, floored at 1.
- `splitBurstReps(total)` — splits a rest-pause **total** rep count into a descending,
  roughly-halving sequence of bursts that sums back to it (`12 → [6, 3, 2, 1]`). This is what a
  planned rest-pause exercise configures directly: you say how many total reps you want out of
  the whole rest-pause portion, not how many separate rests.

In `Workout.jsx`, `addBurstRow`/`removeCluster`/`setClusterField` all adjust the row's own `r` by
the same delta as whatever they just did to `clusters`, so the invariant (`r` == sum of every
`clustersOf` entry) survives live edits too, not just the initial plan — including the case of
tapping "+ Burst" cold on a plain straight set, where the set's original reps become the seed a
running total grows from rather than a separately-standing "main" effort. `addDrop`/`removeDrop`
on a drop-set row do **not** do this — a drop-set's main set stays independent on purpose.

## Planning (`ExConfig` in `sheets.jsx`) → `cfg.intensifier`

The exercise config sheet (routine editor and mid-workout "add exercise" both use it) has an
"Intensifier" picker: None / Drop-set / Rest-pause. Selecting one adds `intensifier` to the saved
config:

```js
// drop-set: every configured set becomes a drop-set — N drops, each pct% lighter than the one before
{ intensifier: { type: 'dropset', count: 2, pct: 20 } }

// rest-pause: NOT applied per set. It replaces the exercise's whole set list with exactly two
// rows regardless of the configured "Sets" (which the UI hides once this is selected, since it
// no longer means anything) — a warm-up at the exercise's own "Reps" field, then one rest-pause
// work set. Doing the full activation+bursts protocol several times over isn't how rest-pause is
// actually trained, so this is a structural replacement, not a per-row stamp like drop-set.
{ intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }
```

`applyIntensifierPlan(sets, cfg)` (`history.js`) applies that. It must run **after**
`applyPrescription`: a drop-set's chain of drops is a percentage of each row's own `w`, so it has
to use the final prescribed weight, not the pre-progression one `buildSets` started from — same
reasoning for where the two rest-pause rows get their weight from. Both call sites chain it last:

```js
applyIntensifierPlan(applyPrescription(buildSets(st, cfg), plan), cfg)   // beginWorkout, sheets.jsx
applyIntensifierPlan(freestyle ? sets : applyPrescription(sets, plan), full)  // add-exercise, Workout.jsx
```

`buildSets` itself knows nothing about intensifiers — it only builds the plain rows (for
rest-pause, `applyIntensifierPlan` discards all of them but the weight).

**Known open questions, deliberately left alone for now:**
- The progression engine (`readSession`/`nextPrescription`) judges a rest-pause exercise's one
  non-warm-up row against `target.reps` — the exercise's plain "Reps" field (what the *warm-up*
  row uses), compared against the work row's `r`, which is now the rest-pause *total* and so is
  usually well above that goal. In practice this means a rest-pause exercise will almost always
  read as "hit the goal" and progress — not obviously wrong, but not a deliberately designed
  comparison either.
- `onerm.js`'s `estimate1RM` refuses anything past `REP_CAP` (12 reps) as "work capacity, not
  strength" — a rest-pause row's `r` being the total means any rest-pause exercise with a total
  over 12 (most of them) never contributes a 1RM estimate or PR. Also not fixed — it falls out
  naturally from an existing, deliberate rule, not a new one, but worth knowing it applies here.

## Guided workout UI (`Workout.jsx`)

Every non-warm-up reps-mode row renders its drops/clusters as **editable sub-rows** right under
it (`.subrow`, reusing the same stepper look as the main row, just smaller) — not read-only chips
behind a sheet. A planned exercise arrives with these already filled in; nothing needs pressing
for them to show up. `"+ Drop"`/`"+ Burst"` (hidden on whichever type doesn't apply to that row)
just appends one more entry with the same suggested-next-value math
(`nextDropWeight`/`nextBurstReps`), for a drop/burst beyond what was planned, or for turning an
unplanned straight set into one on the spot.

There is deliberately **no countdown timer** for rest-pause bursts anymore (an earlier version of
this had one, using the work-timer bar) — with the burst rows already pre-filled and editable,
forcing a real-time countdown added friction without adding value; the short rest between bursts
is self-timed.

**Testing gotcha, not a code bug:** `S.active` (the in-progress workout) and each routine's saved
`intensifier` config both live in `localStorage` and are untouched by redeploying the container.
Iterating on this feature while an old workout is still active, or without re-saving an
already-configured exercise, replays stale pre-`totalReps` data. Discard the active workout and
re-save the exercise's config after a schema change like this one.

## Settings (`useStore.js` DEF, `Settings.jsx`)

`S.restPauseSec` (default 15) is the fallback rest used when "+ Burst" is tapped on a set with no
planned rest-pause of its own. It's a real user-editable default now — **Settings → During a
workout → Rest-pause rest** — the same pattern as the existing `S.restSec` (long) rest timer.
A planned exercise's own `intensifier.restSec` always overrides this.

## Why most of the app didn't need to change

1RM estimation (`onerm.js`) and the progression engine (`progression.js`) read a set row's own
`w`/`r`/`sec` directly, never anything nested — so a drop-set's main set, or a rest-pause row's
own total, is automatically the only thing they see; `drops`/`clusters` never had to be taught to
either of them. What *did* need a one-line hook, because they sum across a session rather than
reading one row:

- `workoutVolume` (`history.js`) — adds `extraVolumeOf(s)` on top of `w×r` per row. Drop-set
  drops count; rest-pause clusters don't (see above — they're already inside the row's own `r`).
- `setTonnage` (`recovery.js`) — same split: `extraTonnage(...)` prices a drop-set's drops with
  the same intensity-weighted formula (`load × reps × min(1, load/1RM)^1.5`) as the main set, and
  is a no-op for rest-pause for the same double-counting reason.
- `applyPrescription` (`progression.js`) — when a policy grows the set count (bodyweight double
  progression, issue #33), the newly appended row keeps the seed's `type` (that's the exercise's
  plan) but never its already-logged `drops`/`clusters` (that's specific work the new row never
  actually did).

`muscles.js`'s `loadOf` ("effective sets" for the muscle-balance map) is untouched on purpose: a
drop-set/rest-pause row still counts as one set there, same as today — that model was never
weight-based to begin with.

## Persistence

No backend or schema change was needed. `api/server.js` writes `state-<uid>.json` verbatim with
no set-shape validation beyond "is an object". The MCP server (`mcp/src`) re-imports the same
`workoutVolume`/`onerm.js`/`muscles.js` helpers from `frontend/src/lib` rather than duplicating
them, so its reported volume/1RM figures pick up the fix automatically too.

## i18n

All new strings are translated in `locales/es.js` (the other ten locales fall back to English via
`t()`, which is safe but not localized — nobody's asked for those yet).

## Out of scope for this pass

- Import from other apps (FitNotes/Strong/Hevy) — no equivalent concept there yet.
- Planning which *specific* sets of an exercise get the intensifier — it's all-or-nothing per
  exercise (every set), which is what was asked for; a "last set only" option would need a
  per-row opt-out on top of this.
