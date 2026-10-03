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
| Progression policies | `linear`, `greyskull`, `double`, `time`, `off` (+ routine-level default) | 12 presets (`manual`, `autoregulated`, `linear`, `greyskull`, `double`, `triple`, `duration`, `hold_seconds`, `bodyweight_ladder`, `pyramid`, `reverse_pyramid`, `five_three_one`) |

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

### 3.4 `PlanRule`

```
{ id, revision, routineId, exerciseId, preset,
  parameters: { sets{min,max}, reps{min,max}, durationSeconds?{min,max}, speed?, rir?{min,max},
                load, loadTo?, restSeconds },
  target, increment, completion[], rounding, special, deload? }
```

| Field | Meaning / constraints |
|---|---|
| `id`, `revision` | Rule id (`rule:${occurrenceId}`); positive integer, bumped on edit (an edit reopens a completed track) |
| `routineId`, `exerciseId` | Owner |
| `preset` | One of the 12 presets (section 3.5) |
| `parameters.sets`, `.reps` | Integer ranges; `fixed` presets require `min === max` |
| `parameters.durationSeconds?` | Seconds range (holds, cardio intervals); required by `duration`, `hold_seconds` |
| `parameters.speed?` | **Cardio target speed, km/h**, `> 0`; needs `durationSeconds` |
| `parameters.rir?` | Target reserve range, max 10 |
| `parameters.load` | `{ mode:'absolute', value ≥ 0, unit }` \| `{ mode:'percent_1rm', percent > 0 }` \| `{ mode:'empty' }` |
| `parameters.loadTo?` | High end of a load range (same mode/unit, not below `load`); not allowed on `fixed`-load presets |
| `parameters.restSeconds` | Rest between work sets (≥ 0) |
| `target` | Terminal load: `absolute` \| `percent_1rm` \| `{ mode:'none' }` |
| `increment` | `{ type, value ≥ 0, unit? }`; types `absolute`, `current_load_percent`, `snapshot_1rm_percent`, `target_load_percent`, `percentage_points`, `seconds` (only with `hold_seconds`, and required by it) |
| `completion[]` | AND-list of `{ metric, target }`; metrics `target_load`, `max_sets`, `max_reps`, `max_duration`, `cycle_count`, `training_max`, `difficulty_rung` (which a preset accepts is per-preset) |
| `rounding` | `{ mode:'nearest'\|'up'\|'down', step > 0 }` or `{ mode:'allowed_values', allowedValues[] }` |
| `special` | Preset extras: `offsets[]` (pyramids), `trainingMax`/`cycleSets`/`endOfCycleIncrement` (5/3/1), `rungs[]` (ladder) |
| `deload?` | `{ after: 1–10, factor: 0.5–0.95 }`; only presets whose gate can stall |

`special` by preset (`{}` for the others; a migrated rule's `special` is `{}` except a
`bodyweight_ladder`'s `rungs: []`):

| Preset | `special` |
|---|---|
| `pyramid`, `reverse_pyramid` | `offsets: [{ percentOfAnchor (0–100], reps? }]` — rising (pyramid) or falling (reverse), the anchor set is `100` and takes its reps from `parameters.reps`; `parameters.sets` must include `offsets.length` |
| `five_three_one` | `trainingMax: { mode:'direct', value, unit }` \| `{ mode:'ninety_percent_1rm' }`; `cycleSets: [[{ percentOfTM, reps, amrap? }]]` (one list per week; standard 4-week cycle `65/75/85 × 5`, `70/80/90 × 3`, `75/85/95 × 5/3/1`, deload week `40/50/60 × 5`); `endOfCycleIncrement: { value ≥ 0, unit }` |
| `bodyweight_ladder` | `rungs: [string]` — named difficulty rungs (`difficulty_rung` completion needs them) |

### 3.5 The 12 presets

| Preset | Gate (what earns a step) | v1 counterpart |
|---|---|---|
| `manual` | none | policy `off`, or an unknown policy |
| `autoregulated` | none | — |
| `linear` | `hit` | `linear` |
| `greyskull` | `hit` (last set AMRAP) | `greyskull` |
| `double` | `max_reps` (top of range on every set) | `double` |
| `triple` | `max_sets_reps` | — |
| `duration` | none (you set the seconds) | timed with no progression — the closest preset; the migration writes `manual`, which keeps the same numbers |
| `hold_seconds` | `seconds` (top of the window earns `+increment.value` s) | `time` ("Add time") |
| `bodyweight_ladder` | `rung` (reps, then sets, up to `sets.max`) | `linear` on an unloaded bodyweight exercise |
| `pyramid`, `reverse_pyramid` | `hit` | — |
| `five_three_one` | none (cycle position) | — |

Deload defaults (`DELOAD_AFTER`): `linear` 3, `greyskull` 1, `double` 3, `hold_seconds` 3 — the
same thresholds as v1 — with `factor: 0.9`.

### 3.6 `Prescription` (frozen)

```
{ id, generatedAt, planRuleId, planRuleRevision, planFingerprint, exerciseId, trackId, preset,
  assisted?, statusAtGeneration, snapshot1RM,
  parameters: { sets, reps, durationSeconds?, speed?, load{expression,resolved}, loadTo?, rir?, restSeconds },
  target{expression,resolved}, basis, increment, completion, rounding, special, deload?,
  position, trainingMax, rows[], warmupRows?[], prefill{sets,reps,durationSeconds?,speed?,rir?,load,carried?},
  provenance{ derivedFromOutOfPlan, sourceLogId, deload? }, contentHash }
```

| Field | Meaning |
|---|---|
| `planFingerprint` | Canonical JSON of `{ sets, reps, durationSeconds }` — v1's "did the plan change" test. Edit any of the three and the track restarts (`plan_changed`) |
| `assisted` | Present (`true`) on an assistance machine; frozen so finishing reads the load the other way |
| `statusAtGeneration` | `'active'` \| `'completed'` |
| `snapshot1RM` | Copy of the 1RM used (only for rules that need one) |
| `parameters.load.expression/resolved` | The load as declared and as resolved (rounded once, capped by the target) |
| `basis` | The rule's declared load at generation: progress carries across revisions only if it did not change |
| `position` | Ladder rung, 5/3/1 week, or hold_seconds window steps |
| `trainingMax` | 5/3/1 training max |
| `rows[]` | One planned row per set: `{ reps{min,max}, load, loadTo?, anchor?, amrap? }` |
| `warmupRows[]` | `{ load{value,unit}, reps, phase:'warmup' }` from the occurrence's warm-up recipe |
| `prefill` | What the rows open with (`startFrom` decides plan vs last session) |
| `provenance.derivedFromOutOfPlan` | The baseline log had audit findings other than `completed_track` |
| `provenance.sourceLogId` | The exposure this prescription started from |
| `provenance.deload` | `{ stalls, from, to, method: 'epley'\|'factor'\|'assist'\|'seconds', reps? }` when a back-off was applied |
| `contentHash` | FNV-1a-64 of the body |

### 3.7 `ProgressionState` (`progression[trackId]`)

| Field | Meaning |
|---|---|
| `trackId` | The occurrence id |
| `status` | `'active'` \| `'completed'` (completion conditions all met; an edited rule revision reopens it) |
| `cyclesCompleted` | 5/3/1 cycles |
| `lastPrescriptionId`, `lastCompletedLogId`, `lastActual` | The newest counted session on the track |
| `terminalTarget`, `completedAt` | Set when completed |
| `planRuleRevision` | Revision of the rule the last log was made under |
| `readyToIncrement` | The newest session earned one automated step |
| `position` | Rung / week / hold window steps |
| `trainingMax` | 5/3/1 |
| `stalls` | Sessions in a row **short of the minimum prescribed** at one load (a hold: at one window) |
| `stallLoad` | The load (or window) the run of misses is at |
| `readyToDeload` | `stalls ≥ rule.deload.after` — the next prescription backs off |

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
| `excludedFromProgression` | `true` on legacy and `noProg` exposures: visible to every reader, never an engine success or failure |
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
discarded?: [{ path, value }] }`. Unsupported settings are recorded as follows:

| `field` | When | What to do |
|---|---|---|
| `prog` | An incompatible own policy or an unknown own/inherited policy | Rule migrated as `manual`; choose a preset in the exercise sheet |
| `deloadFactor` | The factor was set on an exercise whose rule cannot deload (no progression, a ladder) | Nothing to act on; kept for reference |
| `intensifier` | The intensifier is one the rule cannot run (a preset that shapes its own rows, a timed or unloaded rule) | Dropped from the live plan; re-add if you switch preset |

The count is shown once as a toast ("Training data upgraded — {0} settings need review").
Settings → Data → **Training data upgrade review** shows the list and malformed records retained
in `discarded`, with their original paths and values (**ATTENTION** (A12)).

### 3.12 Engine semantics that changed the *meaning* of a stored number

* **Deload** — stalls are counted from the stored state (`stalls`, `stallLoad`) with v1's
  thresholds; linear/double use the Epley candidate selection, others the factor, holds slide the
  window back (`deloadedPosition`), assistance machines add one step of help.
* **Assistance machines** — the increment runs the other way and clamps at 0, the target is a
  floor, `hit` accepts *no more* help than prescribed, the weakest set is the one with the most
  help, and warm-up ramps are off.
* **Cardio** — the rule stores `durationSeconds` (interval) and `speed` (km/h); UI rows are
  `{ min, speed }`; `actualOfRow` converts minutes to seconds.
* **Rounding** — every absolute load is snapped to `rounding.step`. The migration chooses the
  step so every logged load stays exactly on the grid (section 5.2).
  A load within 0.1 of the grid counts as on it (v1's one-decimal storage), and the step must divide
  the increment. Every lifted load, not only logged targets, is considered.
* **Dates** — an unparseable `d`/`start`/`end` is dropped, repaired from its sibling field and listed
  in `migrationAudit.unsupported` (`field: 'date'`, `path`); it never blocks the upgrade.
* **Accepted differences** — M9 (a typed `rir` is kept beside `rpe`), M11 (a combined session
  without `rid` is not linked), M12 (the back-off run of a timed hold).

---

## 4. How the migration works

### 4.1 Trigger and gate

* **When**: the first launch of an updated app that finds *any* copy still in v1 — the server's
  (`GET /api/data/migration-status`, asked, never assumed), the browser's (`gym_state_v1`), or the
  phone's file mirror. The app then shows the blocking screen **"Your training data needs an
  upgrade"** (`MigrationGate.jsx`). Nothing is converted, pulled, pushed or overwritten until the
  person presses **OK** — there is no startup scan on the server.
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

`confirmMigration()` in `useStore.js`:

1. **backup** — `localStorage["gym_state_v1.pre-engine-v1"]` is written once if absent (never
   replaced); on a phone `nativeBackupOnce` writes `gym_state_v1.pre-engine-v1.json`.
2. **convert** — this browser's copy and the phone's copy are each converted in memory with
   `migrateProfileV1ToV2(state, LIB_BY_ID)`.
3. **check** — `validateCanonicalProfile` plus active/dictionary validation and expanded sync-body size checks; errors abort before primary replacement.
4. **write** — `gym_state_v1` and its converted `gym_active_v1` / strict `nativeSave` +
   `nativeActiveSave`; exact read-back verifies durability. A pending journal retains the original
   source strings until both writes and references validate, so retry/restart resumes partial writes (**A28**).
5. **server** — if the server holds v1: `POST /api/data/migrate-engine-v2 { confirmed: true,
   baseRev }`. `baseRev` is the revision the screen showed; if the file changed meanwhile the
   server answers `409 migration-state-changed` and the screen restarts from a fresh status.
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

`importLegacyBackup` opens the same screen (`phase: 'confirm'`, `importData`); the file is
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

---

## 5. Field-by-field mapping

### 5.1 Profile root

| v1 | v2 |
|---|---|
| Every root field of section 2.2 | **kept verbatim** (deep clone): settings, `bodyweight`, `week`, `dayPlan`, `customEx`, `exNotes`, `favEx`, `barWeights`, `plates`, `loadKind`, `gymCards`, `equipProfiles`…, `resetAt`/`resetIds`/`_ts`/`_rev`; Coach metadata stays, but legacy snapshot routines are converted |
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
| any | `off`, cardio, a policy the mode does not accept, an unknown string | `manual` — an incompatible own policy or unknown own/inherited policy is also written to `migrationAudit` as field `prog` |

**Rule parameters** (`ruleFrom`), per field:

| v1 | v2 | Notes |
|---|---|---|
| `sets` | `parameters.sets = {n,n}` | **ATTENTION** (A22) missing `sets` becomes **1**, preserving the v1 default |
| `reps` | `parameters.reps = {n,n}` | preset default when missing |
| `repsMin` / `reps` (double) | `parameters.reps = { min: repsMin, max: reps }` | top = `reps`, else `repsMax`, else 10; bottom = `repsMin`, else top−2; stride 2 for `side`; a bottom ≥ top widens to `top+stride` |
| `repsMax` (bodyweight ladder) | `parameters.reps.max = repsMax`, `parameters.sets.max = max(sets, 6)` | v1's ceiling: reps climb to it, then a set is added, up to 6 |
| `sec` (time) | `durationSeconds = {sec,sec}`, `reps = {1,1}` | v1 default **45** seconds (**A53**) |
| `min` (cardio) | `durationSeconds = {min·60}`, `reps = {1,1}` | default 20 min |
| `speed` (cardio) | `parameters.speed` | default **8** km/h (what a v1 cardio row opened at) |
| `weight` | `parameters.load = { absolute, value, unit }` | a loaded preset with no weight starts at `0`; an unloaded one is `{ mode:'empty' }`; the newest linked session's weight replaces it (5.6) |
| `restSec` | `parameters.restSeconds` (and `occurrence.restSec`) | else the profile's global `restSec` (**A8**), else preset default; `restFromProfile` keeps new prescriptions linked to the global setting until explicitly edited |
| `inc` | `increment = { absolute, inc, unit }` — for `hold_seconds` `{ seconds, inc }` | v1 default when unset: 2.5 kg / 5 lb, **5 kg / 10 lb** for upper legs, lower legs, back, hips, glutes; 5 s for a hold; none for cardio. Kept only where the rule steps by itself or the value was typed |
| `deloadFactor` | `rule.deload.factor` | linear/double only, if within 0.5–0.95 (v1 fell back to 0.9 outside it too). A factor on a rule that cannot deload → `migrationAudit` `deloadFactor` |
| (rule default) | `rule.deload = { after: 3\|1\|3\|3, factor: 0.9 }` | linear/greyskull/double/hold_seconds; the same thresholds v1 used |
| — | `rule.target = { mode:'none' }`, `rule.completion = []` | v1 had no terminal target: a migrated track keeps progressing, it never "completes" |
| — | `rule.rounding = { nearest, step }` | `step` = the exercise's increment (its own `inc`, else v1's body-part default) if every logged load is on that grid, else the coarsest of 2.5/1.25/1/0.5/0.25/0.1/0.05/0.01/0.001 kg (5/2.5/1/… lb) that leaves every recorded load exactly as it was |
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
  which reads exactly as v1.3.9 did — an own log with no recorded plan never resets;
* `assisted` from the occurrence.

If the engine cannot express a target (an invalid number combination) the link is **dropped** and
the entry stays as readable legacy history (5.4).

### 5.4 Workout entry → exposure

**Linking rule** (`linkOf`) — an entry is tied to a routine occurrence only when it is certain:

* it has an object `target`; `noProg` is not `true`; the workout is not `excludeFromProgression`;
* its routine id is `entry.rid`, else the workout's *single* `routineIds` entry;
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
| `entry.topW` | used **only** when `entry.sets` is empty: one done work row at that load, no reps | same |
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

1. Each occurrence's **live rule** starts from where its newest linked log left off: the load of
   the newest linked target (`weight`). For holds, the declared duration retains the original
   plan identity, while the frozen last prescription carries the earned duration window (**A40**).
2. For every occurrence, its linked logs are replayed **oldest → newest** through
   `advanceProgression` with the prescription each was logged against. The newest log's gate
   decides one earned increment (`readyToIncrement`); the run of misses at one load that v1
   recomputed from history on every read (`stallCount`) becomes `stalls`/`stallLoad`, so a deload
   comes when v1's would have (`readyToDeload`).
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
  gets a `manual` rule (`rule:${id}:${j}`, `routineId: null`), a track `${id}:t${j}`, and
  `noProg: true` (`excludedFromProgression`).
* The load grid is widened only when the entry's load is off the rule's grid.
* Every v1 entry field is kept (`clone(entry)`), plus `exposureId`; missing inferred
  `target`/`mode` is materialised in both entry and frozen stub (**A51**). Work rows without a `setId`
  get `r0, r1, …` up to the prescription's row count; **warm-up rows, rows past the prescription,
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
| Own or inherited policy unknown | `manual` + `migrationAudit.unsupported` entry with field `prog` |
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
| A | `rid`, `target {3,5,80}`, `planned {3,5}`, clean | yes | `readyToIncrement: true` | **3×5 @ 82.5** — the earned step is applied once |
| B | no `target`, no `rid` (old record) | **no** (legacy, **A3**) | no state | **3×5 @ 80** — the plan, at the load last lifted; no step is invented |
| C | as A, but the routine was edited afterwards to `reps: 8` | yes | `readyToIncrement: true`, fingerprint differs | **3×8 @ 80** — v1's "plan changed": restart from what was lifted, the new plan's reps |
| D | as A, no `planned` stamp | yes (fingerprint `null`) | `readyToIncrement: true` | **3×5 @ 82.5** — an own log with no recorded plan never resets |
| E | as A, but the sets were `5, 4, 3` reps | yes | `stalls: 1`, `readyToIncrement: false` | **3×5 @ 80** — a miss holds the load; three misses in a row at one load will deload (linear `after: 3`) |

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
