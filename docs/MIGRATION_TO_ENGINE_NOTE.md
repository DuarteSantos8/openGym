# Migration to the v2 training engine — data model and migration note

This note describes, field by field:

1. the **v1 profile** (what openGym stored before the generic training engine),
2. the **v2 profile** (`engineSchemaVersion: 2`, the engine's canonical form),
3. how **historical data** (saved workouts, routines, 1RM) and **live data** (the workout in
   progress) are converted, in one pass, on the first launch of the updated app.

Every case where information can be lost, changed or left in an unexpected state is marked
**ATTENTION** and collected, with a stable id (A1…A55), in [section 8](#8-attention-index).

Source of truth (read these when the note and the code disagree — the code wins):

| Piece | File |
|---|---|
| The conversion (pure, deterministic) | `api/migration/profile-migration.js` |
| Version discriminator | `api/migration/profile-version.js` |
| Server route + gate | `api/server.js` (`engineGate`, `POST /api/data/migrate-engine-v2`) |
| Client transaction | `frontend/src/store/useStore.js` (`openMigration`, `confirmMigration`, `finishImport`) |
| The blocking screen | `frontend/src/views/MigrationGate.jsx` |
| Engine (rules, prescriptions, progression, 1RM, warm-up, deload) | `api/engine/*.js` |
| Migration tests | `api/test/profile-migration.test.js` |

Conventions used below: `kg`/`lb` per the profile `unit`; times in seconds unless a field says
minutes; speeds in km/h; `?` marks an optional field; `→` reads "is converted to".

---

## 1. Overview

| | v1 | v2 |
|---|---|---|
| Discriminator | `engineSchemaVersion` absent (or `1`) | `engineSchemaVersion: 2` |
| What decides the next load | **Derived from history on every read** (`progression.js`): nothing stored | **Stored state**: a `PlanRule` per routine slot, frozen `Prescription`s, a `ProgressionState` per track |
| A routine slot | `routine.ex[j]`: a flat config (`sets`, `reps`, `weight`, `prog`, `inc`…) | `routine.ex[j]`: an *occurrence* `{ occurrenceId, exerciseId, rule, … }` |
| A logged exercise | `workout.entries[j]`: `{ id, sets[], target, planned, … }` | `workout.exposures[j]`: `{ exposureId, prescriptionId, performance.sets[], actual, audit, … }` |
| What was asked of the lifter | `target` (the progressed numbers) and `planned` (what the routine said) stamped on the entry | A **frozen, content-hashed Prescription** in `prescriptions{}` |
| 1RM | Computed on the fly from logged sets | Append-only dictionary `oneRepMaxes{}` |
| Workout in progress | `S.active` inside the synced document | Its own key (`gym_active_v1`, phone file `gym_active_v1.json`); never synced |
| Progression policies | `linear`, `greyskull`, `double`, `time`, `off` (+ routine-level default) | 13 presets (`autoregulated`, `linear`, `greyskull`, `double`, `triple`, `hold_seconds`, `bodyweight_ladder`, `pyramid_reps`, `pyramid`, `five_three_one`, `top_set_backoff`, `accumulation_intensification`, `density`) |

The migration is **one-way and additive**: it never edits the v1 bytes. Before anything is
converted, the untouched v1 copy is written to an immutable backup (section 4.3). The conversion
itself is a pure function — `migrateProfileV1ToV2(state, catalogue)` — shared by the API, the
browser and the Capacitor shells, so the same v1 document always yields the same v2 document
(ids come from existing ids and array positions, timestamps from the workout they describe;
nothing reads the clock or a random source).

**ATTENTION** (A1) — the conversion needs the built-in exercise catalogue (`LIB_BY_ID` from
`api/coach/core/library.js`), because a v1 profile stores only an `exerciseId`: cardio,
bodyweight and assisted machines are read off the catalogue entry. Both callers must pass the
same catalogue. Without it the function throws `migration-needs-catalogue` rather than silently
converting every exercise as plain reps/external-load.

---

## 2. The v1 data model

### 2.1 Where v1 data lives

| Location | Content | Who writes it |
|---|---|---|
| `data/state-<uid>.json` (server) | The whole synced profile as one JSON document, plus server bookkeeping `_rev` | `PUT /api/data` (atomic write-temp-then-rename) |
| `localStorage["gym_state_v1"]` | Browser copy (guest mode, offline copy of a signed-in profile) | the Zustand store (`persist`) |
| `<app data>/gym_state_v1.json` | Capacitor phone mirror (`nativeSave`) | `lib/mobile.js` |
| `localStorage["gym_stash"]` / `opengym-stash.json` | Changes a forced sign-out or disconnect kept on the device (pre-upgrade stash) | store (`applyStash`) |
| Backup JSON files (Settings → Export) | A copy of the profile | user |
| Plan files (`PLAN_FMT` 1) | Shareable routines bundle | Plan → Export |
| `S.active` (inside the document) | The workout in progress (never uploaded in practice: the API deletes `active` on every write) | store |

### 2.2 The v1 profile root

Defaults come from `DEF` in `frontend/src/store/useStore.js`; a stored profile is overlaid on it,
so any key may be absent.

| Field | Type | Meaning |
|---|---|---|
| `unit` | `'kg'`\|`'lb'` | Weight unit; every stored weight is in this unit |
| `restSec` | number | Global default rest between sets (s) |
| `restPauseSec` | number | Default rest-pause micro-rest (s) |
| `sound`, `soundOnSilent`, `timerFlash`, `timedSetOvertime`, `keepAwake`, `vibrate?` | boolean | Timer/feedback settings |
| `lang`, `langAuto?` | string / boolean | UI language |
| `theme`, `accent`, `body` (`'male'`…), `gifSize`, `heatmapMetric`, `workoutView`, `weekStart`, `wdec`, `speedUnit` | string/number | Display preferences |
| `wc` | `{ steppers, setShortcuts, pairButtons, exerciseButtons }` | Which workout-screen controls are shown (`WC_DEFAULT`) |
| `effort` (`'none'`\|`'rir'`\|`'rpe'`\|`null`), `showRir?` | | Which per-set effort scale is logged (`showRir` is the legacy boolean it replaced) |
| `reminder` | `{ on, time, tz }` | Day-reminder settings |
| `autoBackup` | boolean | Phone auto-backup |
| `targetW` | number\|null | Target body weight |
| `bodyweight` | `[{ d, w, … }]` | Weigh-ins |
| `routines` | `Routine[]` | The plan (section 2.3) |
| `week` | `{ [getDay]: routineId \| routineId[] }` | Weekly schedule |
| `dayPlan` | object | Per-date plan overrides |
| `exWeights` | `{ [exerciseId]: number }` | Confirmed working weight per exercise |
| `workouts` | `Workout[]` | History (section 2.5) |
| `active` | `Active \| null` | Workout in progress (section 2.7) |
| `customEx` | `[{ id, n, bp, eq, … , _ts }]` | User-defined exercises |
| `equipProfiles`, `activeEquipId`, `equipFilterOn` | | Equipment profiles/filter |
| `exNotes` | `{ [exerciseId]: string }` | Standing per-exercise notes |
| `favEx` | `string[]` | Favourite exercises |
| `barWeights`, `plates`, `loadKind` | maps (`_ts`-stamped) | Bar weights, plate inventory per unit, plate-loading kind |
| `gymCards`, `lastGymCardId`, `checkIn` | | Gym check-in cards |
| `showWeightCard`, `weighIn` | boolean | Home widgets |
| `startFrom` (`'plan'`\|`'last'`) | | Where planned sessions open sets/reps |
| `enParens`, `enOnly` | maps | Exercise-name language display |
| `logRef` (`'last'`…) | | What the log column shows as reference |
| `balanceTemplate`, `balanceOverrides` | | Structural-balance settings |
| `coach` | `{ consent, profile, cadence, lastReview, log[], snapshots[], chat[], timings[] }` | AI-Coach namespace |
| `_ts`, `_rev`, `resetAt`, `resetIds` | numbers/object | Sync bookkeeping (last-edit stamp; server write counter; reset markers) |

The migration keeps **every one of these root fields verbatim** (`...clone(rest)`), except
`active` (moved out, section 4.6) and the fields it rewrites: `routines`, `workouts`, and legacy
`coach.snapshots[].routines`. It adds the
v2 root fields of section 3.2.

### 2.3 v1 routine

```
{ id, name, emoji?, prog?, excludeFromProgression?, ex: ExerciseConfig[], _ts? }
```

| Field | Meaning |
|---|---|
| `id` | Routine id (string; may be missing on very old data) |
| `name`, `emoji` | Display |
| `prog` | **Routine-level default progression policy** (`linear`\|`greyskull`\|`double`\|`time`\|`off`): applies to every exercise that does not set its own |
| `excludeFromProgression` | `true`: a deload/rehab routine — its sessions never count for progression |
| `ex` | The exercises (section 2.4) |
| `_ts` | Last-edit stamp used by the sync merge (`stampRoutines`) |

### 2.4 v1 exercise config (`routine.ex[j]`, "cfg")

| Field | Applies to | Meaning |
|---|---|---|
| `id` | all | **Exercise id** (catalogue id or a `customEx` id) |
| `mode` | all | `'reps'`\|`'time'`\|`'cardio'`; absent → cardio if the catalogue body part is `cardio`, else reps |
| `sets` | all | Number of sets (cardio: number of intervals) |
| `reps` | reps | Target reps; **for `double` it is the top of the window** |
| `repsMin` | reps | Bottom of the double-progression window |
| `repsMax` | reps | Ceiling of a bodyweight climb (reps climb to it, then a set is added, up to 6) |
| `weight` | reps, time | Starting/working load |
| `sec` | time | Hold seconds per set |
| `min`, `speed` | cardio | Interval minutes and target speed (km/h) |
| `prog` | reps, time | This exercise's policy (`linear`\|`greyskull`\|`double`\|`time`\|`off`), else the routine's, else `linear` on reps / `off` otherwise |
| `inc` | reps, time | Own increment: load step for reps; **seconds** on a timed hold |
| `deloadFactor` | linear, double | Custom deload fraction (default 0.9; `false`/`null` = default) |
| `restSec` | all | Rest between work sets (s); absent → the global `restSec` |
| `warmupSets` | reps | Number of planned warm-up rows (0–5) |
| `warmupRestSec` | reps | Rest after a warm-up row (s) |
| `intensifier` | reps | `{ type:'dropset', count, pct }` or `{ type:'restpause', totalReps, restSec }` |
| `side` | reps | Unilateral: each row is logged per limb (L/R) |
| `bodyweight` | reps | Override of "is this a bodyweight exercise" (catalogue default from equipment) |
| `assisted` | reps | Override of "this is an assistance machine" (load = help given) |
| `sg` | all | Superset group tag |
| `note` | all | Note on this exercise in this plan |
| `excludeFromProgression` | all | This exercise never counts |

**v1 progression semantics** (`frontend/src/lib/progression.js`), which the migration must
reproduce because v1 stored no progression state:

* **Policy resolution** (`policyFor`): `cfg.prog` → `routine.prog` → `linear` (reps) or `off`.
* **linear**: after a session where every set hit the prescribed reps at the prescribed load, add
  `inc` (default 2.5 kg / 5 lb; **5 kg / 10 lb for upper legs, lower legs, back, hips, glutes**).
* **greyskull**: like linear, last set AMRAP, backs off on the first miss.
* **double**: climb reps from `repsMin` to `reps`, then add load and restart at the bottom.
* **time** ("Add time"): a clean timed session adds `inc` seconds (default 5).
* **Bodyweight climb**: an unloaded bodyweight exercise on `linear` adds reps to `repsMax`, then sets, up to 6.
* **Assistance machines** (issue #232): the load is the *help given*; every step runs the other way (less help = progress).
* **Deload**: after N misses in a row at one load (linear 3, greyskull 1, double 3, time 3) the load backs off — Epley selection for linear/double, `deloadFactor` (default 0.9) for the rest.
* **Plan change** (`plannedOf`/`samePlan`, issue #275): only `sets`, `reps`, `repsMin`, `sec` decide "the plan changed"; on a change the climb restarts from what was last lifted.
* **Own history first** (issue #216): the routine's own newest session of the exercise, else the exercise's newest anywhere.

### 2.5 v1 workout (`S.workouts[i]`)

| Field | Meaning |
|---|---|
| `id` | Workout id (may be missing on old data) |
| `d` | Local date `YYYY-MM-DD` |
| `start`, `end` | Epoch ms |
| `routineIds` | Routines this session was built from (list; several when routines were combined) |
| `routineId` | Legacy scalar mirror of `routineIds[0]` |
| `name` | Session name |
| `bw` | Body weight at the time |
| `entries` | The exercises (section 2.6) |
| `prs` | Exercise ids that set a weight PR in this session |
| `excludeFromProgression` | Legacy whole-session flag (all entries `noProg`) |
| `note` | Session note |
| `vol` | Cached total volume |
| `media` | `[{ hash, … }]` photos/videos |
| `_ts` | Last-edit stamp (edited after logging) |

### 2.6 v1 entry (`workout.entries[j]`) and set row

| Field | Meaning |
|---|---|
| `id` | Exercise id |
| `sets` | The logged rows (below) |
| `topW` | Best weight of the entry (cache); **the only trace of a session logged before sets were kept** |
| `target` | What the prescription asked for **after** progression: `{ mode, sets, reps, repsMin, repsMax, weight, sec, min, speed, … }` (a copy of the cfg with the engine's numbers over it) |
| `planned` | What the routine said when the session was built: `{ sets, reps?, repsMin?, sec? }` |
| `rid` | The routine this entry came from |
| `noProg` | `true`: this entry does not count for progression |
| `sg` | Superset group |
| `muscleSnapshot` | Muscle map frozen at logging time |
| `note`, `notePin` | Note typed about this exercise today; whether to show it next time |

Set row (`entry.sets[k]`):

| Field | Meaning |
|---|---|
| `w` | Load (in the profile unit; 0/absent = bodyweight/none) |
| `r` | Reps |
| `sec` | Seconds (timed hold) |
| `min`, `speed` | Cardio minutes and km/h |
| `done` | Completed (`true`) or skipped/unfinished |
| `phase` (`'warmup'`\|`'work'`), `warmup` (legacy boolean) | Warm-up row marker (`phase` wins when present) |
| `rir`, `rpe` | Effort (RIR, or RPE as typed) |
| `type` | `'dropset'` \| `'restpause'` |
| `drops` | `[{ w, r }]` for a drop set |
| `clusters` | `[{ r, restSec }]` for rest-pause bursts |
| `sides` | `{ L: row, R: row }` for a unilateral row |
| `planSec`, `weightOrigin`, `autoWarmup`, `setId` | Live-session bookkeeping (stripped at finish in v1) |

### 2.7 v1 active workout (`S.active`)

```
{ id, d, start, routineId?, routineIds?, name, bw?, cur, entries[], note?, noProg?,
  workoutView?, groupMeta?, backfill?, editingWorkoutId?, editBase? }
```

Its entries have the same shape as saved entries (`id`, `sets`, `target`, `planned`, `rid`,
`noProg`, `sg`, `note`, `notePin`, `carried?`, `plan?`). `editingWorkoutId`/`editBase` mark an
**open history edit draft** (the workout screen re-opened on a saved workout).

---

## 3. The v2 data model

### 3.1 Principles

* **Plan configuration is strict, execution is permissive.** A `PlanRule` that fails
  `validatePlanRule` cannot be saved or generated from; what the athlete actually logs is never
  rejected (`audit.js` only *explains* how a log differs from its prescription).
* **A prescription is a fact, not a view.** It is generated once, deep-frozen and content-hashed
  (`contentHash` = FNV-1a-64 over canonical JSON, 16 hex chars). Every input a later reader needs
  (the 1RM snapshot, the rule parameters, the increment, the rounding) is copied into it, so
  nothing is ever re-derived from a live rule or a live 1RM.
* **Progression is stored per track.** A *track* is one routine slot (`trackId` = `occurrenceId`).
  The state is what its logs leave it, advanced one session at a time (`advanceProgression`).
* **1RM snapshots are immutable.** New estimates add records; history edits/deletions and merges
  reconcile source-linked derived records without changing typed 1RMs or frozen snapshots (**A54**).
* **The workout in progress is not part of the synced profile.**

### 3.2 The v2 profile root

Everything in section 2.2 stays (same names, same meaning) **except**:

| Field | v2 |
|---|---|
| `engineSchemaVersion` | **added**: `2` |
| `prescriptions` | **added**: `{ [prescriptionId]: Prescription }` (section 3.6) |
| `progression` | **added**: `{ [trackId]: ProgressionState }` (section 3.7) |
| `oneRepMaxes` | **added**: `{ [id]: OneRepMax }` (section 3.9) |
| `migrationAudit` | **added by the migration**: `{ fromSchema: 1, unsupported: [{ routineId, occurrenceId, exerciseId, field, value }], discarded?: [{ path, value }] }` (section 3.11) |
| `active` | **removed** from the document (section 3.10) |
| `routines[].ex[]` | now **occurrences** (section 3.3) |
| `workouts[]` | now carry `exposures[]` instead of `entries[]` (section 3.8) |
| `exWeights` | kept verbatim; **no v2 reader consults it** |

`validateCanonicalProfile` (run on every migration output and canonical `PUT /api/data` before
it is stored) enforces:
`engineSchemaVersion === 2`; no `active` key; `prescriptions`/`oneRepMaxes`/`progression` are
objects; `routines`/`workouts` are lists; every routine has a string `id` and a list `ex`; every
occurrence has string `occurrenceId` and `exerciseId`, unique across the profile, no leftover
`warmupSets`, a valid `rule` and a valid `warmup`; every workout has an `id`, no leftover
`entries`, a list `exposures`; every exposure has a string `exerciseId`, a unique `exposureId`, a
`prescriptionId` that resolves to the same exercise, and `performance.sets` rows of shape `{ role: 'work'|'warmup',
observations[], resistance{} }`.
Malformed list members are rejected, not silently filtered. Prescription dictionary keys must
match their ids, and each prescription must contain rows and a reconstructible valid rule.

### 3.3 v2 routine and occurrence

Routine: `{ id, name, emoji?, prog?, excludeFromProgression?, ex: Occurrence[], _ts? }` — the
v1 routine fields are all kept. **`routine.prog` is kept for display but is no longer read**: the
inherited default was written into every occurrence's rule (section 5.2).

Occurrence (`routine.ex[j]`):

| Field | Meaning |
|---|---|
| `occurrenceId` | Stable id of the slot; also the `trackId` (`${routineId}:o${j}` when migrated) |
| `exerciseId` | Exercise |
| `mode` | `'reps'`\|`'time'`\|`'cardio'` |
| `rule` | The `PlanRule` (section 3.4) |
| `warmup?` | `{ mode:'off' }` \| `{ mode:'smart', count:1–5 }` \| `{ mode:'template', steps:[{ percent, reps }] (1–5) }` |
| `sg?`, `note?` | Superset group; plan note |
| `restSec?` | The v1 rest override, kept beside the rule's `parameters.restSeconds` |
| `restFromProfile?` | Migrated slot without its own rest override; new prescriptions inherit current global rest |
| `warmupRestSec?` | Rest after a warm-up row |
| `excludeFromProgression?` | `true`: never counts |
| `assisted?` | Explicit override of the catalogue's "assistance machine" flag |
| `side?` | Unilateral (reps mode only) |
| `bodyweight?` | Override of the catalogue's bodyweight flag (stored only where it differs) |
| `intensifier?` | `{ type:'dropset', count 1–5, pct }` \| `{ type:'restpause', totalReps 1–100, restSec 5–120 }`; only where `supports(rule)` allows |
| `cardio?` | `{ sets, min, speed }` — what the cardio sheet edits; the rule holds the same numbers |

### 3.4 `PlanRule` and its program

```
{ id, revision, routineId, exerciseId, preset, rounding,
  program: { phases[], end: 'complete'|'repeat', completion[], trainingMax?, cycleIncrement? } }
```

`preset` names the template the rule was built from (section 3.5); the engine never reads it. What
the engine runs is `program`. The editor changes a rule by its template numbers
(`planOptions(rule)` → edit → `defaultPlanRule(preset, numbers)`, i.e. `editPlan`); a program those
numbers do not rebuild exactly (`isTemplateRule` false) is shown, not edited.

| Field | Meaning / constraints |
|---|---|
| `id`, `revision` | Rule id (`rule:${occurrenceId}`); positive integer, bumped on edit (an edit reopens a completed track) |
| `routineId`, `exerciseId` | Owner |
| `rounding` | `{ mode:'nearest'\|'up'\|'down', step > 0 }` or `{ mode:'allowed_values', allowedValues[] }` |
| `program.phases[]` | 1–32 phases, ids unique; a phase before the last must have an `exit` |
| `program.end` | After the last phase exits: `'complete'` (the track completes) or `'repeat'` (a new cycle at the first phase) |
| `program.completion[]` | AND-list of `{ metric, target }`: `target_load`, `max_sets`, `max_reps`, `max_duration`, `cycle_count`, `training_max`, `difficulty_rung`, `rest_floor`. `cycle_count` / `training_max` read the values as they stand once a closing cycle is counted |
| `program.trainingMax?` | `{ mode:'direct', value, unit }` \| `{ mode:'ninety_percent_1rm' }` — what `training_max` groups are a percentage of |
| `program.cycleIncrement?` | `{ value ≥ 0, unit }` added to the training max at every cycle boundary |

A **phase**:

| Field | Meaning / constraints |
|---|---|
| `id` | Unique in the program |
| `parameters` | `{ sets{min,max}, reps{min,max}, durationSeconds?, speed?, rir?, load, loadTo?, restSeconds }` — as before: `load` is `absolute` \| `percent_1rm` \| `empty`; `speed` (km/h) needs `durationSeconds`; `loadTo` is never allowed with a load step |
| `target` | Terminal load / cap: `absolute` \| `percent_1rm` \| `{ mode:'none' }` |
| `groups[]` | 1–50 groups resolving to 1–50 rows, in order: `{ id, count: {min,max} \| 'parameters', reps: {min,max} \| 'parameters', load: { basis:'anchor'\|'training_max', percent } \| { basis:'empty' }, restSeconds?, amrap?, max? }`. `'parameters'` reads the phase's own sets / reps aim, so a plain 3 × 5 is one group. A group with reps of its own asks for at least one rep, and only in reps work |
| `success` | `{ scope:'all'\|'groups', groupIds?, load:'ignore'\|'prescribed', effort:'ignore'\|'rir_floor' }` — which rows decide, whether the load lifted must reach the prescription (new templates; v1-shaped ones ignore it, as v1 did), whether a RIR floor applies |
| `progression[]` | Up to 8 operators (below) |
| `stall?` | `{ after 1–10, count:'misses'\|'misses_without_improvement', recovery: { method:'factor'\|'epley'\|'epley_reps', factor 0.5–0.95 } }` — only on a phase that steps load or seconds |
| `exit` | `null` (last phase only) \| `{ type:'exposures'\|'successes', count }` \| `{ type:'goal', metric:'reps'\|'sets'\|'durationSeconds', target }` \| `{ type:'load_present'\|'load_absent' }`, each with an optional `to` (a phase id; default: the next) |
| `entry?` | `{ load:'declared'\|'previous', reps:'declared'\|'last_actual' }` — how a phase entered by a load exit starts |
| `prefill?` | `'plan'` (default) \| `'last'` — where sets and reps open when nothing moved |

An **operator** `{ id, metric, when, step, basis?, direction?, min?, max?, resetOnCarry?, amrapDoubleAt?, rungs? }`:
`metric` is `load` (its `step` is an increment `{ type, value, unit? }`; types `absolute`,
`current_load_percent`, `snapshot_1rm_percent`, `target_load_percent`, `percentage_points` — the last
only, and always, with a `percent_1rm` load), or `reps`, `sets`, `durationSeconds`, `restSeconds`,
`difficulty` (a number). `when`: `success` (every deciding row at least its target, effort allowed),
`maximum` (success and the top of the range reached), `worked`. `basis: 'last_actual'` steps from what
was logged (v1: the heaviest load lifted; the weakest set's reps), `current` from what was prescribed.
`restSeconds` and `difficulty` need `min` and `max`; `rungs` names a difficulty operator's variations.
The chain: operators run in order; one at its bound carries to the next; the first that moves ends
it, and the operators it carried past restart (`resetOnCarry`) at the bottom of the range the next
session's plan gives. Greyskull's load step doubles when the AMRAP reaches `amrapDoubleAt` × the
minimum.

### 3.5 Templates

| Template | Program | v1 counterpart |
|---|---|---|
| `autoregulated` | one phase, no operators; reps, load or seconds (timed) are entered by hand | `off`, an unknown policy; timed "no progression" migrates as `autoregulated` |
| `linear` | load +step on success (from what was lifted); stall 3 → Epley | `linear` |
| `greyskull` | sets−1 plain + 1 AMRAP group; load +step (×2 at 2× the minimum); effort ignored; stall 1 → factor | `greyskull` |
| `double` | reps +1 (2 per side) after any worked session from the last result, then load at the top; stall 3 counted without improvement → Epley with reps | `double` |
| `triple` | reps +1, then a set, then load, after clean sessions | — |
| `hold_seconds` | the seconds window +step at its top; stall 3 → window back | `time` ("Add time") |
| `bodyweight_ladder` | reps (from the last result), then sets, after clean sessions; named rungs then move to the next variation and start over. With `loadedPreset`, a second phase runs that policy while weight is logged (`load_present` / `load_absent`) | `linear` on an unloaded bodyweight exercise |
| `linear`/`greyskull`/`double` + `unloadedLadder` | the policy, and a rep ladder while nothing is loaded | a loaded policy on unloaded equipment |
| `pyramid_reps` | a group per set (`max` sets open at what that set managed), own rests | v1.3.10 pyramid sets |
| `pyramid` | a group per set at a % of the anchor, lightest first (ascending) or heaviest first (descending, e.g. RPT); the 100 % sets decide | — |
| `five_three_one` | a phase per week of `training_max` groups, each exits after 1 session; repeats; TM + increment per cycle | — |
| `top_set_backoff` | top 1 × reps at 100 % + back-off sets at a %, each with its own rest; the top set (or every set) decides; load +step from what was prescribed | — |
| `accumulation_intensification` | phase A: reps +1 at a % of the TM until the top; phase B: fewer reps at a higher %, exits after N clean sessions; repeats (TM + increment) or completes | — |
| `density` | rest −step after each clean session down to a floor; optional `rest_floor` completion | — |

Deload defaults (`DELOAD_AFTER`): `linear` 3, `greyskull` 1, `double` 3, `hold_seconds` 3 — v1's — with `factor: 0.9`.

### 3.6 `Prescription` (frozen)

```
{ id, generatedAt, planRuleId, planRuleRevision, planFingerprint, exerciseId, trackId, preset,
  assisted?, perSide?, restPause?, statusAtGeneration, snapshot1RM,
  ruleSnapshot, phaseId, values{ sets, reps, durationSeconds?, restSeconds?, difficulty?, trainingMax? },
  parameters: { sets, reps, durationSeconds?, speed?, load{expression,resolved}, loadTo?, rir?, restSeconds },
  target{expression,resolved}, trainingMax, rows[], warmupRows?[], prefill{sets,reps,durationSeconds?,speed?,rir?,load,carried?},
  provenance{ derivedFromOutOfPlan, sourceLogId, deload? }, contentHash }
```

| Field | Meaning |
|---|---|
| `planFingerprint` | The shape of the work: each phase's id, sets, reps and declared seconds, its groups' counts and reps, its exit — never a load, a percentage, a step, a back-off or a rest. A changed one restarts the track (`plan_changed`) |
| `assisted`, `perSide`, `restPause` | Frozen with the session so finishing reads it the same way (step direction, rep stride, back-off method) |
| `ruleSnapshot`, `phaseId` | The rule exactly as generated from, and the phase; `ruleOfPrescription` returns the snapshot |
| `values` | The aims the session was built from; the load is `parameters.load.expression` |
| `rows[]` | `{ groupId?, reps{min,max}, load, loadTo?, restSeconds?, amrap?, max? }` — `groupId` only when the phase has several groups, `restSeconds` only when it differs from the exercise's |
| `provenance.deload` | `{ stalls, from, to, method: 'epley'\|'factor'\|'assist'\|'seconds', reps? }` when the values carried a back-off |

The pack form (`profile-pack.js`) keeps `ruleSnapshot` in the shared template block.

### 3.7 `ProgressionState` (`progression[trackId]`)

| Field | Meaning |
|---|---|
| `status`, `cyclesCompleted`, `terminalTarget`, `completedAt` | As before |
| `lastPrescriptionId`, `lastCompletedLogId`, `lastActual`, `planRuleRevision`, `planFingerprint` | The newest counted session; a session of another fingerprint restarts the track inside `advanceProgression`, so a live finish and a replay restart at the same log. The same log twice is a no-op |
| `phaseId`, `phaseExposures`, `phaseSuccesses` | Where the track is and the counters its exit reads |
| `values` | What the next session targets: `{ load, sets, reps, durationSeconds, restSeconds, difficulty, trainingMax }`; `null` sets/reps = the bottom of the range the next plan gives |
| `stalls`, `stallAt`, `stallBest` | The run of sessions short of the minimum at one load (or window); `stallBest` for a double counted without improvement |
| `deload` | The back-off the values carry, shown on the next prescription |

Advancing is a fixed order: judge the session (`verdictOf`), its phase exit and the program's cycle,
completion, then a stall back-off or the operators, then the next phase. A completing session moves
everything but the load. Generating only reads the state: twice from the same state is the same
prescription.

### 3.8 Workout and exposure

Workout: `{ id, d, start, end, status:'completed', routineIds[], name, bw?, exposures[], vol, note?, prs?, media?, _ts?, … }`
— every v1 workout field except `entries`, `routineId` and `excludeFromProgression` is kept
verbatim (`d`, `start`, `end`, `name`, `bw`, `prs`, `note`, `media`, `_ts`, any unknown field).

Exposure (`workout.exposures[j]`):

| Field | Meaning |
|---|---|
| `exposureId` | `${workoutId}:x${j}` when migrated |
| `exerciseId`, `exerciseNameSnapshot?` | Exercise (the snapshot is written on live sessions and migrated active sessions) |
| `mode` | `'reps'`\|`'time'`\|`'cardio'` |
| `routineId`, `occurrenceId`, `trackId` | Where it came from; `trackId` is `null` on legacy exposures |
| `prescriptionId` | The frozen prescription it was logged against; `null` on legacy exposures |
| `excludedFromProgression` | `true` on legacy and `noProg` exposures, and on a linked/live exposure with no completed work row: visible to every reader, never an engine success or failure |
| `kind` | `'legacy'` on a migrated entry that could not be linked to an occurrence |
| `legacyTarget?`, `legacyPlanned?` | The v1 `target`/`planned`, verbatim, on legacy exposures |
| `sg?`, `side?`, `warmupRestSec?`, `bodyweight?`, `intensifier?`, `muscleSnapshot?` | Carried from the entry/occurrence |
| `performance` | `{ sets: SetPerformance[], note?, notePin? }` |
| `actual?` | Engine summary of the completed work rows: `{ sets, reps, load?, durationSeconds?, speed?, rir?, rpeEntered? }` (weakest deciding set; **for an assistance machine the weakest is the one with the most help**) |
| `audit?` | `[{ code, field, expected, actual, severity:'warning', row? }]` findings (`below_range`, `above_range`, `above_cap`, `missing_reference`, `completed_track`) |
| `sourceAudit?` | Copy of `prescription.provenance`, written on live sessions |
| `completedAt` | ISO timestamp (`end`, else the workout's date) |

`SetPerformance` (a row):

| Field | Meaning |
|---|---|
| `prescribed` | Was made from a prescribed row (migrated rows: `false`) |
| `setId?` | `r{k}` — the prescribed-row index a live row was made from |
| `role` | `'work'`\|`'warmup'` |
| `status` | `'completed'`\|`'skipped'` |
| `observations[]` | `{ metric:'repetitions'\|'duration'\|'speed', unit:'reps'\|'s'\|'kmh', value }` |
| `resistance` | `{ kind:'external-load', value, unit }` \| `{ kind:'bodyweight' }` \| `{ kind:'none' }` (cardio, migrated) |
| `rir?`, `rpeEntered?` | Effort (RPE is derived to RIR = 10 − RPE) |
| `segments[]` | Drop chain: one nested row per drop |
| `clusters?[]` | Rest-pause bursts `{ r, restSec }` (how `r` breaks down; not extra volume) |
| `side?` | `'L'`\|`'R'` (migrated and live unilateral rows are saved per limb, with independent completion) |

### 3.9 `OneRepMax` (`oneRepMaxes[id]`)

`{ id, exerciseId, value, unit, source:'estimated'|'manual', capturedAt, sourceRecordId }`. Append-only;
the current 1RM of an exercise is the record with the newest `capturedAt`. Source-linked
estimates are reconciled after history changes; typed records and frozen snapshots survive. The estimate is Epley
(`w·(1+r/30)`), rounded to 0.1, not computed above 12 reps, and never for an assistance machine.

### 3.10 Active session (v2)

Stored separately (`gym_active_v1` in `localStorage`; `gym_active_v1.json` on the phone), never
synced. `{ id, d, start, routineId(s), name, bw?, cur, entries[], exposures[], note?, … }`:
`entries[]` are the rows the workout screen edits (each carrying `exposureId`, `target`, `planned`,
`sets[]` with `setId: 'r{k}'`), and `exposures[]` are the matching exposure stubs with their
`prescriptionId` (`performance.sets` empty until finish, when `buildCompletedSession` fills
`performance`, `actual`, `audit`, `sourceAudit`, `completedAt`).

### 3.11 `migrationAudit`

`{ fromSchema: 1, unsupported: [{ routineId, occurrenceId, exerciseId, field, value }],
discarded?: [{ path, value }] }`. A repaired date is an `unsupported` entry of another shape: `{ field: 'date', path, value }`. Unsupported settings are recorded as follows:

| `field` | When | What to do |
|---|---|---|
| `prog` | An incompatible own policy or an unknown own/inherited policy | Rule migrated as `autoregulated`; choose a preset in the exercise sheet |
| `deloadFactor` | The factor was set on an exercise whose rule cannot deload (no progression, a ladder) | Nothing to act on; kept for reference |
| `intensifier` | The intensifier is one the rule cannot run (a preset that shapes its own rows, a timed or unloaded rule) | Dropped from the live plan; re-add if you switch preset |

The count is shown once as a toast ("Training data upgraded — {0} settings need review").
Settings → Data → **Training data upgrade review** shows the list and malformed records retained
in `discarded`, with their original paths and values (**ATTENTION** (A12)).

### 3.12 Engine semantics that changed the *meaning* of a stored number

* **Verdict** — a session is judged by sets and reps (or seconds) only, never by the load lifted; a
  per-side set by its total. The session's weight is v1's `readSession.weight`: the heaviest
  prescribed set done (the least help on a machine). A session is held at that weight, steps and
  backs off from it, and a missing weight reads as 0. Skipped sessions (no completed work row)
  are not judged at all. A rest-pause block opens at its burst total and is judged against the
  plan's reps (v1, docs/dev/SET_TYPES.md).
* **Deload** — stalls are counted from the stored state with v1's `stallCount`: `stallAt` is the
  weight of the last session and only a new weight (or a clean session) ends a run, so a timed
  hold's run goes on past a back-off of its seconds; `stallBest` is the best a session at that
  weight managed, clean ones included, and beating it (a double) starts the run over. The phase
  names its recovery (`epley` for linear, `epley_reps` for a double, `factor` otherwise; bodyweight
  work and rest-pause rows always `factor`, v1 `isBw`), on the increment's grid, from the weight
  lifted toward the 1RM of the weight prescribed; a rep trade is the next session's target. Holds
  slide the window back (`deloadedPosition`), assistance machines add one step of help.
* **Steps are earned at the finish** — the next load, reps aim, window, rung and phase are written to
  `progression[track].values` by `advanceProgression`; a step edited later applies from the next
  earned step on.
* **Extra sets never move the plan** (v1 #233) — a triple progression prescribes the set it adds;
  a named-rung ladder climbs reps and sets before the next rung.
* **Bodyweight ↔ loaded** — a ladder with a loaded policy stays loaded while weight is logged and
  returns to the rep climb when it is not (v1); the climb goes one rep over the target asked for,
  never over what was done, and resumes at the reps the loaded session asked for; the loaded
  regime opens at the plan's reps and backs off like its policy. With no ceiling (`repsMax` unset)
  the reps just climb. An unclean ladder session holds its target (v1 "same target again until
  every set is clean").
* **The plan's numbers** — a double opens at its top when nothing is logged and while the weight is
  missing (v1 `cfg.reps`); a loaded lift logged with no weight asks for the plan's weight; a rule
  that progresses nothing (v1 `off`, pyramid sets, cardio) opens at its own weight, or at what was
  lifted when it has none, and a timed hold at what was lifted last time. With "start from your
  last session" each row reopens at what that row did, unless the policy names the reps.
* **Not followed** — rest-pause planned for more than one set: v1 never progressed it (its one
  collapsed row never counted as enough sets), an accident v2 does not copy.
* **Assistance machines** — the increment runs the other way and clamps at 0, the target is a
  floor, the weakest set is the one with the most help (the next help starts from the lightest set),
  and warm-up ramps are off.
* **Cardio** — the rule stores `durationSeconds` (interval) and `speed` (km/h); UI rows are
  `{ min, speed }`; `actualOfRow` converts minutes to seconds.
* **Rounding** — every absolute load is snapped to `rounding.step`. The migration chooses the
  step so every logged load stays exactly on the grid (section 5.2); for a rule that steps the load,
  the smallest common plate that divides the increment (1.25 kg, 2.5 lb). Increments follow v1
  `addStep`: from a load on the increment's grid onto it, from one off it the step is just added.
  The workout stepper and the warm-up ramp move by the increment, as v1's did.
  A load within 0.1 of the grid counts as on it (v1's one-decimal storage), and the step must divide
  the increment. Every lifted load, not only logged targets, is considered.
* **Dates** — an unparseable `d`/`start`/`end` is dropped, repaired from its sibling field and listed
  in `migrationAudit.unsupported` (`field: 'date'`, `path`); it never blocks the upgrade.
* **Storage form** — a canonical profile is held in memory as described here, but written to the
  server's state file, `localStorage`, the native mirror and the sync body in the compact form of
  `api/migration/profile-pack.js` (`packed: 1`): short keys, derivable row fields omitted, the invariant
  part of each track's prescriptions in `templates`. `unpackProfile` restores it exactly (and is the
  identity on an unpacked document); backups exported from Settings remain plain.
* **Accepted differences** — M9 (a typed `rir` is kept beside `rpe`), M11 (a combined session
  without `rid` is not linked), M12 (the back-off run of a timed hold).

---

## 4. How the migration works

### 4.1 Trigger and gate

* **When**: the first launch of an updated app that finds *any* copy still in v1 — the server's
  (`GET /api/data/migration-status`, asked, never assumed), the browser's (`gym_state_v1`), or the
  phone's file mirror. The app then shows the blocking screen **"Your training data needs an
  upgrade"** (`MigrationGate.jsx`) and runs the upgrade by itself, with nobody asked: every v1
  copy is backed up before anything is converted (4.2). Nothing is pulled, pushed or overwritten
  while it runs, and there is no startup scan on the server: the app asks it to convert.
* **Discriminator**: `migrationStatus(state)` → `engineSchemaVersion` absent/`1` = v1 (`required:
  true`); `2` = canonical; anything larger throws `unsupported-schema` (a build older than the
  data never touches it); a v1 profile whose `routines`/`workouts` are not lists throws
  `invalid-v1-routines` / `invalid-v1-workouts`; a non-object throws `profile-not-an-object`.
  The summary shown on the screen is `{ routines, workouts, bytes }`.
* **Version gate on the server** (`engineGate`, on `GET /api/data`, `GET /api/data/rev`,
  `PUT /api/data`): engine-aware clients send `X-OpenGym-Engine-Schema: 2`.

  | Server file | Client | Result |
  |---|---|---|
  | v1 | old (no header) | works as before |
  | v1 | aware | `409 { error: 'migration-required' }` → the screen |
  | v2 | aware | works |
  | v2 | old | `409 { error: 'upgrade-required', minEngineSchema: 2 }` — an old client would read v2 records as empty and push the result over real data |
  | unreadable / newer schema | any | `409 { error: 'profile-unreadable' \| 'unsupported-schema' }` |

  Reminder ticks, the admin dashboard, the Coach and the MCP server deliberately keep their own
  access and are outside the gate (section 7).

### 4.2 The one transaction (client)

`openMigration()` in `useStore.js` starts it once boot has settled (`confirmMigration()`, which
**Try again** calls too; a call while it runs waits for that run):

1. **backup** — `localStorage["gym_state_v1.pre-engine-v1"]` is written once if absent (never
   replaced); on a phone `nativeBackupOnce` writes `gym_state_v1.pre-engine-v1.json`.
2. **convert** — this browser's copy and the phone's copy are each converted in memory with
   `migrateProfileV1ToV2(state, LIB_BY_ID)`.
3. **check** — `validateCanonicalProfile` plus active/dictionary validation and the sync-body size check (measured on the compact form); errors abort before primary replacement.
4. **write** — `gym_state_v1` and its converted `gym_active_v1` / strict `nativeSave` +
   `nativeActiveSave`; exact read-back verifies durability. A pending journal retains the original
   source strings until both writes and references validate, so retry/restart resumes partial writes (**A28**).
5. **server** — if the server holds v1: `POST /api/data/migrate-engine-v2 { confirmed: true,
   baseRev }`. `baseRev` is the revision the status gave; if the file changed meanwhile the
   server answers `409 migration-state-changed` and the upgrade starts over from a fresh status,
   twice at most before the error state.
6. **load** — `releaseMigration()` reloads the canonical copy and runs the normal `boot()`/sync;
   a toast reports "Training data upgraded — {0} settings need review" when `migrationAudit` is
   non-empty.

A failure at any step leaves the screen in its error state ("The upgrade did not finish. No
original server file was overwritten…", **Try again**). Nothing already backed up or converted is
undone, and nothing is pushed.

### 4.3 The one transaction (server)

`POST /api/data/migrate-engine-v2` — synchronous from the read to the rename, like `PUT /api/data`:

1. Body must be exactly `{ baseRev, confirmed: true }` (else `400 invalid-migration-request`).
2. Read the file; `baseRev` must equal `_rev` (else `409 migration-state-changed`); already v2 →
   `200 { migrated: false }`.
3. Write `data/state-<uid>.pre-engine-v1.json` **once** (atomic). If it exists it must itself be
   v1 (`backup-not-v1` otherwise) and byte-identical to the current source
   (`backup-source-mismatch` otherwise). Earlier copies are never replaced (**A30**).
4. `migrateProfileV1ToV2(source.state, LIB_BY_ID)` then `validateCanonicalProfile`
   (`invalid-output: …` aborts).
5. `_rev = old _rev + 1`, atomic write, cache drop, audit-log `data.migrate.ok`
   (`v1->v2 <bytes>B <n> routines <m> workouts`). A failure logs `data.migrate.fail` /
   "Training data upgrade failed" and returns `500 migration-failed` (or the 409 reason); the
   original file is untouched.

**Rollback** (operator): stop the API, copy `data/state-<uid>.pre-engine-v1.json` over
`data/state-<uid>.json`, delete the `.pre-engine-v1` file only if you want a later attempt to
re-take the backup (do so if v1 data may change before the next attempt: an existing backup is
never replaced). **ATTENTION** (A2) — a rollback restores the v1 bytes: whatever the server
received in v2 since the conversion is gone from the server. Aware clients are sent back to the
migration screen (`migration-required`); a device that still holds its own v2 copy keeps that
data locally, and how it merges back is the ordinary sync merge — check before relying on it.

### 4.4 Local copies, guests, phone

* Guest / offline browser: `gym_state_v1` converted in place, backup at
  `gym_state_v1.pre-engine-v1`.
* Capacitor: `nativeLegacy()` reads the file mirror; backup `gym_state_v1.pre-engine-v1.json`;
  converted through `nativeSave`.
* A device whose server copy and local copy are both v1 converts both with the **same pure
  function**: when they are the same v1 document they produce identical documents (same ids, same
  prescriptions), so the normal merge sees the same records, not two divergent histories. Copies
  that had already diverged in v1 stay divergent and merge as any two profiles do.
* **ATTENTION** (A10) — a signed-in device that is **offline at its first launch after the
  upgrade** cannot ask `migration-status`; the gate shows its error state ("Try again") until the
  server is reachable. The error explicitly asks the user to reconnect; nothing is converted or
  lost meanwhile. A `404` instead explains that API and web must be updated together (**A13**).

### 4.5 A v1 backup file (Settings → Import)

`importLegacyBackup` opens the same screen (`phase: 'confirm'`, `importData`) and, the one case
that asks, waits for **OK** or **Cancel**: the person picked that file. The file is
converted in memory (**the file itself is the backup**), validated, and passed to the ordinary
backup import preserving the user's merge or replace choice; a v1 in-progress workout inside
the file becomes the active session if none is running. Retry keeps the file and
merge/replace choice; Cancel closes only a pending file import (**A29**). **ATTENTION** (A14) — replacement
intentionally overwrites the current profile; merging keeps the destination's records.

### 4.6 Determinism, ids and idempotence

The function is pure (no clock, no random). Ids:

| Object | Id |
|---|---|
| Routine | its own `id`, else `m1-r{i}`; a repeated id becomes `id~2`, `id~3`… |
| Occurrence / track | `${routineId}:o${j}` (`j` = position in `routine.ex`, counting skipped entries) |
| Rule | `rule:${occurrenceId}` |
| Workout | its own `id`, else `m1-w{i}`; repeats `~2`… |
| Exposure | `${workoutId}:x${j}` (`j` = position in `entries`) |
| Prescription of a linked exposure | `${workoutId}:p${j}` |
| Migrated 1RM | `one-rep-max:migrated:${exerciseId}` |
| Active session | its own `id`, else `m1-active`; prescriptions `${id}:active:p${j}` (collision suffixes if needed), exposures `${id}:active:x${j}`, unlinked tracks `${id}:t${j}` |

Calling it on a profile that is already v2 returns it unchanged (`{ profile: state, activeSession: null }`).
Server replacement uses a single rename; local/native profile and active writes use a resumable
pending journal. Existing emitted ids are reserved before suffix allocation; collision suffixes
also protect saved/active namespaces (**A32**). Divergent-copy merges remap conflicting frozen
record ids with their references and reconcile derived data (**A25**, **A46**).

**ATTENTION** (A21) — malformed records are **dropped, not repaired**: a non-object in `routines`/
`workouts`, a routine exercise or a workout entry with no `id`. (They cannot be produced by the
app; they can be produced by hand-edited files. Their paths and original values remain in
`migrationAudit.discarded` and the `.pre-engine-v1` backup.)

**Hardening rules** (`api/test/migration-robustness.test.js`) — the migration never throws on a document
that passes `migrationStatus`; whatever it cannot use is repaired the same way, or audited, never fatal:

| v1 value | v2 |
|---|---|
| An id that is not a non-empty string or a finite number (`[]`, `{}`, `true`, `''`) | not an id: the entry is dropped (audited), a routine/workout gets its generated id |
| A number past ±1e15, `NaN`, or text that is not a number | absent (the field falls back to its default) — products such as reps × load or min × 60 can never overflow |
| A negative logged reps, load, time or speed | absent from the row (the row itself is kept) |
| A fractional logged rep count (5.5) | kept in the log as typed; the plan counts the 5 completed (`generatePrescription`) |
| `sets` above 50 | 50, and a `migrationAudit.unsupported` entry with field `sets` |
| A rest-pause cluster that is a bare number / has a non-numeric `r` | `{ r }` / the number dropped; a non-object, non-number cluster is dropped |
| A rest-pause total on a logged target that is not a whole number | the prescription uses its default total |
| `oneRepMaxes` already on the document | kept record by record when it is a valid 1RM with no source link; others go to `migrationAudit.discarded` |
| `prescriptions`, `progression`, `packed`, `templates` already on a v1 document | not v1 data: `migrationAudit.discarded` (the wire form's markers must never reach a profile) |
| A Coach snapshot whose `routines` is not a list | left untouched |
| A loaded lift whose logs carry no weight | held, as v1 did ("No weight logged last time"): no increment, no stall, no deload, no rep climb; the plan's weight, if any, stays |

---

## 5. Field-by-field mapping

### 5.1 Profile root

| v1 | v2 |
|---|---|
| Every root field of section 2.2 | **kept verbatim** (deep clone; `unit` is normalised to `'kg'`/`'lb'`): settings, `bodyweight`, `week`, `dayPlan`, `customEx`, `exNotes`, `favEx`, `barWeights`, `plates`, `loadKind`, `gymCards`, `equipProfiles`…, `resetAt`/`resetIds`/`_ts`/`_rev`; Coach metadata stays, but legacy snapshot routines are converted |
| `routines` | rewritten (5.2) |
| `workouts` | rewritten (5.4–5.6) |
| `active` | removed; converted apart (5.8) |
| `oneRepMaxes` (absent) | seeded (5.7); an existing dictionary is kept |
| `prescriptions` (absent) | one per linked exposure and per active exposure (5.3) |
| `progression` (absent) | seeded by replay (5.6) |
| — | `engineSchemaVersion: 2`, `migrationAudit` |
| `exWeights` | verbatim; not read by v2 (**A15**) |

### 5.2 Routine → routine + occurrences

`routine.ex[j]` becomes `routine.ex[j]` (same order; `id`-less entries dropped, **A21**).

**Policy → preset** (`policyOf` then `presetForPolicy`)

1. Policy = `cfg.prog` → `routine.prog` → `linear` if mode is reps, else `off`.
2. Preset:

| Mode | Policy | Preset |
|---|---|---|
| reps | eligible **unloaded** bodyweight/assisted/non-loaded equipment with `linear`, `double` or `greyskull` | `bodyweight_ladder`; remembers the load policy for a later added-load transition (**A38**) |
| reps | bodyweight work with **added load**, or assisted work with remaining assistance | its declared load policy; assistance progresses downward until zero (**A38**) |
| reps | `linear` | `linear` |
| reps | `greyskull` / `double` | `greyskull` / `double` |
| time | `time` ("Add time") | **`hold_seconds`** (**A18**) |
| any | `off`, cardio, a policy the mode does not accept, an unknown string | `autoregulated` — an incompatible own policy or unknown own/inherited policy is also written to `migrationAudit` as field `prog` |

**Rule numbers** (`ruleFrom`): the v1 fields become the template's numbers (`planOptions` keys),
and the template builds the program from them. Per field:

| v1 | v2 template number | Notes |
|---|---|---|
| `sets` | `sets = {n,n}` | **ATTENTION** (A22) missing `sets` becomes **1**, preserving the v1 default; capped at 50 |
| `reps` | `reps = {n,n}` | preset default when missing |
| `repsMin` / `reps` (double) | `reps = { min: repsMin, max: reps }`; on a bodyweight double also `loadedReps` (the window it climbs once weight is added) | top = `reps`, else `repsMax`, else 10; bottom = `repsMin`, else top−2; stride 2 for `side`; a bottom ≥ top widens to `top+stride` |
| `repsMax` (bodyweight ladder) | `reps.max = repsMax`, `sets.max = max(sets, 6)` | v1's ceiling: reps climb to it, then a set is added, up to 6 |
| `sec` (time) | `durationSeconds = {sec,sec}`, `reps = {1,1}` | v1 default **45** seconds (**A53**) |
| `min` (cardio) | `durationSeconds = {min·60}`, `reps = {1,1}` | default 20 min |
| `speed` (cardio) | `speed` | default **8** km/h (what a v1 cardio row opened at) |
| `weight` | `load = { absolute, value, unit }` | a loaded preset with no weight starts at `0`; an unloaded one is `{ mode:'empty' }`; the newest linked session's weight replaces it (5.6) |
| `restSec` | `restSeconds` (and `occurrence.restSec`) | else the profile's global `restSec` (**A8**), else preset default; `restFromProfile` keeps new prescriptions linked to the global setting until explicitly edited |
| `inc` | `step = { absolute, inc, unit }` — for `hold_seconds` `{ seconds, inc }` | v1 default when unset: 2.5 kg / 5 lb, **5 kg / 10 lb** for upper legs, lower legs, back, hips, glutes; 5 s for a hold; none for cardio. Kept only where the rule steps by itself or the value was typed |
| `deloadFactor` | `deload.factor` (the phase's `stall.recovery.factor`) | linear/double only, if within 0.5–0.95 (v1 fell back to 0.9 outside it too). A factor on a rule that cannot deload → `migrationAudit` `deloadFactor` |
| (rule default) | `deload = { after: 3\|1\|3\|3, factor: 0.9 }` | linear/greyskull/double/hold_seconds; the same thresholds v1 used |
| — | `target = { mode:'none' }`, `completion = []` | v1 had no terminal target: a migrated track keeps progressing, it never "completes" |
| — | `rule.rounding = { nearest, step }` | `step` = the exercise's increment (its own `inc`, else v1's body-part default) if every load lifted or targeted is on that grid (within 0.1, as v1 treated its one-decimal storage) and the step divides the increment, else the coarsest of 2.5/1.25/1/0.5/0.25/0.1/0.05/0.01/0.001 kg (5/2.5/1/… lb) that leaves every recorded load exactly as it was |
| `warmupSets` | `occurrence.warmup = { mode:'smart', count: min(5,n) }` | `0` → off (omitted); `warmupSets` no longer exists on the occurrence |
| `warmupRestSec` | `occurrence.warmupRestSec` | |
| `intensifier` | `occurrence.intensifier` | numbers held to the engine bounds (drop-set `count` 1–5, `pct` in (0,100) else 20; rest-pause `totalReps` 1–100, `restSec` 5–120); one the rule cannot run → `migrationAudit` `intensifier` |
| `side` | `occurrence.side` | reps mode only |
| `bodyweight` | `occurrence.bodyweight` | explicit true and false overrides are retained |
| `assisted` | `occurrence.assisted` and the rule/prescription direction | else the catalogue's flag (`leverage machine` + "assist" in the name, or an explicit flag) |
| `sg`, `note` | `occurrence.sg`, `occurrence.note` | |
| `excludeFromProgression` (cfg or routine) | `occurrence.excludeFromProgression` | its history is never linked (5.4) |
| `mode` | `occurrence.mode` | else cardio for a cardio catalogue body part, else reps |
| cardio `{sets,min,speed}` | `occurrence.cardio = { sets, min, speed }` and the rule's `sets`/`durationSeconds`/`speed` | |
| `routine.prog` | written into each occurrence's rule; the routine field is kept but unread | |
| `id` | `exerciseId` | |

Every rule is checked with `validatePlanRule`; an invalid one aborts the whole migration
(`invalid-rule …`) rather than storing a rule the engine cannot generate from.

### 5.3 What a prescription of a migrated exposure is

For a **linked** entry (5.4) the migration generates a real, frozen, content-hashed prescription
(`${workoutId}:p${j}`) with the engine — the same function the live app uses — from:

* the rule built from the entry's `target` numbers (`sets`, `reps`, `weight`, `sec`, `min`, `speed`);
  for double progression the day's window is `target.reps … plan top`, so the "top of the range on
  every set" gate reads as v1 did;
* `planFingerprint` from the entry's `planned` stamp (v1's `plannedOf`): if it equals today's
  routine plan, today's cfg-derived fingerprint stands in for it; only a genuine edit rebuilds the
  fingerprint from the stamp; **no `planned` stamp → fingerprint `null`** ("no recorded plan"),
  which reads exactly as v1.3.9 did — an own log with no recorded plan never resets; an unedited
  stamp takes the fingerprint the live rule will have (the ladder one once the last load is 0);
* `assisted` from the occurrence.

If the engine cannot express a target (an invalid number combination) the link is **dropped** and
the entry stays as readable legacy history (5.4).

### 5.4 Workout entry → exposure

**Linking rule** (`linkOf`) — an entry is tied to a routine occurrence only when it is certain:

* it has an object `target`; `noProg` is not `true`; the workout is not `excludeFromProgression`;
* its routine id is `entry.rid`, else the workout's *single* `routineIds` entry (an empty `routineIds` falls back to the scalar `routineId`);
* that routine has **exactly one** slot for the exercise, not excluded, with the same mode as the
  entry's `target.mode`.

Workouts are walked **oldest first** (`start`, else `d`, ties by position).

A linked entry with no completed work row (warm-ups don't count) is converted but **excluded from progression** (`excludedFromProgression: true`), as v1 ignored it: it never advances the track and is never the base of the next prescription. The live engine marks a skipped exercise the same way.

| | Linked | Legacy (everything else) |
|---|---|---|
| `exposureId` | `${workoutId}:x${j}` | same |
| `exerciseId` | `entry.id` | same |
| `mode` | the occurrence's | `target.mode`, else cardio if rows carry `min`, timed if rows carry `sec`, else the catalogue's |
| `routineId` | the occurrence's routine | `entry.rid` (else `null`) |
| `occurrenceId`, `trackId` | the occurrence | absent / `null` |
| `prescriptionId` | the frozen prescription | `null` |
| `excludedFromProgression` | `false` | `true` |
| `kind` | — | `'legacy'` |
| `legacyTarget`, `legacyPlanned` | — | the v1 `target` / `planned`, **verbatim** (readers of the v1 shape take them from here) |
| `actual`, `audit` | `summarizeActual` of the completed work rows; `audit: []` | absent |
| `sg`, `muscleSnapshot` | `entry.sg`, `entry.muscleSnapshot` | same |
| `performance.note`, `performance.notePin` | `entry.note` (trimmed), `entry.notePin` | same |
| `completedAt` | ISO of `workout.end`, else the workout's date | same |
| `entry.topW` | used **only** when `entry.sets` is empty: one done work row at that load, no reps (a linked entry like this has no completed work in `entry.sets`, so it is excluded from progression) | same |
| `entry.noProg` | not linked → legacy | legacy |

**ATTENTION** (A3) — **legacy exposures never feed the engine**: no prescription, no track, no
`actual`. They are fully visible everywhere else (history, charts, stats, PRs, 1RM, volume, the
"last session" reference), but a session that was logged as (a) a duplicated exercise in the same
routine (the same exercise twice in one routine is unlinked by design), (b) an entry with no
`target`, (c) a routine that no longer exists, (d) a combined session whose entry has no `rid`, (e)
an excluded (deload/rehab) routine or `noProg` entry, or (f) a mode change since — carries no
progression signal. The next session on that slot starts from the plan, or from the last *linked*
session; a legacy log never advances or resets a track. One exception, for the *load* only: when a
slot has **no** linked history of its own, the exercise's newest log anywhere — legacy included —
is the baseline, and the weight last lifted is held (`first_in_routine` reset in `context.js`;
sets and reps come from the plan).

Workout-level fields: `id`, `d`, `start`, `end`, `name`, `bw`, `prs`, `note`, `media`, `_ts` and any
unknown field are kept; `routineId` (scalar) is folded into `routineIds`; `entries` →
`exposures`; `excludeFromProgression` is folded into the per-entry link decision (**a whole-session
flag is not kept as a field**); `status: 'completed'` is added; `vol` is the v1 value, else
recomputed from the rows (external-load reps × load, work rows only, drops included).

### 5.5 Set row → `SetPerformance`

| v1 row | v2 row |
|---|---|
| — | Linked required work receives stable `setId`/`prescribed` identity; extra and warm-up rows remain outside progression (**A41**) |
| `phase` (else legacy `warmup: true`) | `role: 'warmup'` \| `'work'` (`phase` wins when present) |
| `done` | `status: 'completed'` \| `'skipped'` |
| `r` | observation `{ repetitions, reps }` (not for cardio) |
| `sec` | observation `{ duration, s }` |
| `min` (cardio) | observation `{ duration, s }` = `min·60` |
| `speed` (cardio) | observation `{ speed, kmh }` |
| `w` > 0 | `resistance: { external-load, value, unit }` |
| `w` absent/0 | `resistance: { bodyweight }` (cardio: `{ none }`) |
| `rir` / `rpe` | `rir` / `rpeEntered` (an RPE derives RIR = 10 − RPE) |
| `type:'dropset'`, `drops[{w,r}]` | `segments[]`: one nested row per drop, same `done`/`phase` |
| `type:'restpause'`, `clusters[{r,restSec}]` | `clusters[]` (kept beside the row; not extra volume) |
| `sides: { L, R }` | Separate rows tagged `side: 'L'` and `side: 'R'`, preserving each limb's completion |
| `planSec`, `weightOrigin`, `autoWarmup`, `setId` | not present in saved history (stripped by v1 at finish) |

Nothing is rounded or clamped: values are copied exactly as logged.

### 5.6 Progression state (seeded by replay)

v1 had no stored state, so the migration reconstructs it:

1. Each occurrence's **live rule** starts from where its newest *worked* linked log left off: the load of
   that target (`weight`). For holds, the declared duration retains the original
   plan identity, while the frozen last prescription carries the earned duration window (**A40**).
2. For every occurrence, its linked logs (skipped ones excluded) are replayed **oldest → newest** through
   `replayProgression` — the same replay an edited history uses, one advance per track and
   workout — with the prescription each was logged against and its performance. The newest log
   decides the values the first v2 session targets (one earned step); the run of misses at one load
   that v1 recomputed from history on every read (`stallCount`) becomes `stalls`/`stallAt`, so a
   deload comes when v1's would have (`deload` on the state).
3. An edit of the plan between two sessions (a changed `planFingerprint`) **ends the run**, as it
   did in v1.
4. The result is `progression[occurrenceId]`. An occurrence with no linked history has no state
   and starts from its rule.

### 5.7 1RM seeding

For each exercise, the best Epley estimate over all completed, non-warm-up, external-load rows in
reps mode (assistance machines skipped; more than 12 reps gives no estimate) becomes
`oneRepMaxes["one-rep-max:migrated:<exerciseId>"] = { value, unit, source:'estimated', capturedAt:
<that exposure's completedAt>, sourceRecordId: <exposure id> }`, unless a record with that id
already exists or the exercise already has a higher one. Drop-set segments and rest-pause clusters
do not contribute. **ATTENTION** (A7) — unilateral estimates use individual completed limbs,
not combined repetitions (20 kg × 5 per limb yields 23.3, not 26.7). Finishing a migrated active
workout uses the same per-limb selection.

### 5.8 The workout in progress

`S.active` (v1) → a separate **active session** (`activeSession`, returned beside the profile):

* Each entry with an `id` gets a **frozen prescription** built from its `target` (or, when it has
  none, from its rows: work-row count, first row's reps/weight/sec/min) — **never re-derived from
  history**. A linked entry (same `linkOf` rule, using the active session's `routineId(s)`) uses
  its occurrence's rule (same `ruleFor`), so finishing it advances the same track; an unlinked one
  gets an `autoregulated` rule (`rule:${id}:${j}`, `routineId: null`), a track `${id}:t${j}`, and
  `noProg: true` (`excludedFromProgression`).
* A linked prescription is stamped like a logged one (the live `planFingerprint` when its
  `planned` matches the routine, else the stamp's), and its rule keeps the occurrence's start
  (`sameStart`) with the session's load held on it. Otherwise the finished session reads as an
  edited plan and the next one restarts from the occurrence's start: the step it earned, the
  rep or seconds climb and a pending back-off are lost.
* The load grid is widened only when the entry's load is off the rule's grid.
* Every v1 entry field is kept (`clone(entry)`), plus `exposureId`; missing inferred
  `target`/`mode` is materialised in both entry and frozen stub (**A51**). Work rows without a `setId`
  get `r0, r1, …` up to the prescription's row count — one per prescribed set, so the left and
  right row of a per-side hold share theirs, in saved history too; **warm-up rows, rows past the prescription,
  and rows that already have a `setId` are left as they are** (past-the-prescription rows stay
  "unprescribed").
* Other v1 active fields are kept (`note`, `workoutView`, `groupMeta`, `backfill`,
  `editingWorkoutId`, `editBase`, `noProg`, …); `cur` is remapped/clamped after
  filtering invalid entries (**A52**). `exposures[]` holds the stubs (`performance:
  { sets: [] }`, with `mode`). Configured unfinished warm-up ramps regain `autoWarmup: true`,
  so work-load edits re-aim them. Completed ramps and explicit manual flags stay unchanged;
  v1 did not record manual-edit provenance, so missing flags on unfinished ramps are inferred.
* **Where it goes**: browser `gym_active_v1` and phone `gym_active_v1.json`, with separate legacy active keys converted too; the separate key takes precedence
  over an embedded v1 session (**A28**, **A51**). **ATTENTION** (A20) — the **server never receives or converts `active`** (the API
  has always deleted `active` on every write; it was local-only in practice), so an in-progress
  workout on device A is never visible on device B.

### 5.9 What is deliberately not migrated

| v1 data | v2 |
|---|---|
| `routine.prog` | kept, unread (baked into rules) |
| Own or inherited policy unknown | `autoregulated` + `migrationAudit.unsupported` entry with field `prog` |
| `deloadFactor` with no deloading rule | `migrationAudit.deloadFactor` |
| `intensifier` the rule cannot run | dropped from the plan + `migrationAudit.intensifier` |
| `exWeights` | kept, unread (**A15**) |
| whole-workout `excludeFromProgression` | per-entry link decision; the flag itself is dropped |
| `entry.topW` when sets exist | dropped (recomputable) |
| Entries/exercises without an `id` | omitted from live data; retained in `migrationAudit.discarded` (**A21**) |

Everything else in the v1 file is in the untouched backup.

---

## 6. Worked examples (the first session after the upgrade)

All run through the real migration and the real session builder (`buildSessionExposures`):
barbell bench press, `linear`, `3×5 @ 80 kg`, `inc 2.5`, one v1 workout with `3×5 @ 80`, all done.

| # | v1 history entry | Linked? | Migrated state | First session after the upgrade |
|---|---|---|---|---|
| A | `rid`, `target {3,5,80}`, `planned {3,5}`, clean | yes | `values.load` 82.5 | **3×5 @ 82.5** — the earned step is applied once |
| B | no `target`, no `rid` (old record) | **no** (legacy, **A3**) | no state | **3×5 @ 80** — the plan, at the load last lifted; no step is invented |
| C | as A, but the routine was edited afterwards to `reps: 8` | yes | `values.load` 82.5, fingerprint differs | **3×8 @ 80** — v1's "plan changed": restart from what was lifted, the new plan's reps |
| D | as A, no `planned` stamp | yes (fingerprint `null`) | `values.load` 82.5 | **3×5 @ 82.5** — an own log with no recorded plan never resets |
| E | as A, but the sets were `5, 4, 3` reps | yes | `stalls: 1`, `values.load` 80 | **3×5 @ 80** — a miss holds the load; three misses in a row at one load will deload (linear `after: 3`) |

| F | as A, but the lifter lifted `5 × 70` (clean) | yes | `values.load` 72.5 | **3×5 @ 72.5** — the next load starts from what was lifted (the heaviest set; the lightest help on an assistance machine), as v1 `readSession.weight` |
| G | as A, but the sets were `60, 60, 50` | yes | `values.load` 62.5 | **3×5 @ 62.5** — from the heaviest set |

A session is judged by sets and reps only, never by the load lifted (v1). A double progression opens at the
last result + 1 rep after any session; three sessions at one weight that never beat the best of the run
still deload. A ladder session that was not clean asks for the same sets and reps again.

Also seeded in A: `oneRepMaxes["one-rep-max:migrated:0025"] = { value: 93.3, source: 'estimated' }`
(80 × (1 + 5/30)), and the saved exposure `w1:x0` carries `prescriptionId: 'w1:p0'`,
`actual { sets: 3, reps: 5, load: { 80, kg } }`, `audit: []`.

---

## 7. Other readers of profile data

| Reader | v2 behaviour |
|---|---|
| Coach payload/cohort, admin, effort and muscle stats, workout text export | Read exposures back into the v1 entry shape with `legacyEntriesOf(workout, prescriptions)` (`api/engine/performance.js`): `id`, `rid`, `target`, `sets[{ w, r, sec, min, speed, rir, rpe, warmup, type, drops, clusters, done }]`, `muscleSnapshot`, `note`/`notePin`. `target` comes from the exposure's prescription (`sets`, `reps`, `weight`, `sec`, or cardio `min`/`speed`) — for a legacy exposure from its `legacyTarget`. A workout that was never migrated (a v1 state file on the server) comes back as is |
| MCP server (`mcp/`) | Reads `DATA_DIR` directly, never through the gate: a v1 profile is **refused explicitly** (`engineUnsupported`) rather than reported as empty |
| Reminder tick, admin lists | Read the file directly; unaffected by the schema |
| Plan share / import | Plan files carry each exercise's `rule`, validated on import; `PLAN_FMT` 1 files are converted with the shared migration, including units, custom exercises and schedule (**A11**); retired format 2 remains refused |
| History import (CSV, Strong, Hevy) | Written as v2 exposures with `exposureId: 'ie…'`, `trackId: 'import:<exerciseId>'`, `excludedFromProgression: true`, no prescription — the same *legacy-like* shape a migrated unlinked entry has, disconnected from routines (see `DATA_IMPORTS.md`) |
