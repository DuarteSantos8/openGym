# REPORT — audit of the v2 engine and the v1 → v2 migration

Branch `feat/generic-engine-v1.3.12-issue186` against `main` (v1).
Scope: `api/engine/*`, `api/migration/*`, the session start/finish boundary (`frontend/src/lib/session-start.js`,
`finish-session.js`, `session-ui-adapter.js`), and the documented migration contract
(`docs/MIGRATION_TO_ENGINE_NOTE.md`).

**Verdict: the migration is not yet "absolutely robust".** The mapping is careful and large parts are
exact (see §6), but I found **3 blocking/critical problems**, **several silent behaviour changes in
progression**, and a few smaller data-fidelity gaps. Every finding below was reproduced; the
reproductions live in two new test files (§7). Nothing in the application code was changed.

Severity: **S1** = user blocked or data/plan silently wrong for many users · **S2** = wrong
prescription for a recognisable group · **S3** = minor / edge.

---

## 1. Summary table

| Id | Area | Sev | One line |
|---|---|---|---|
| **M5** | migration | **S1** | v2 profile is ~7× the v1 size; a power user (≈1000 sessions × 6 exercises, 2.5 MB in v1) becomes 17 MB > the 16 MB sync cap → migration fails with `profile-too-large` forever |
| **P1** | progression (live + migration) | **S1** | An exercise left untouched in a finished session is logged as a *miss*; 3 skipped sessions deload the lift (v1 ignored such entries) |
| **M1/M2/M4** | migration | **S2** | The rounding step picked by the migration changes the loads v1 would have prescribed (22.6 instead of 22.5, 55 instead of 54.5, 55 for a lifted 52.5) |
| **M3** | migration | **S2** | Assisted / bodyweight work that reached 0 help restarts at the plan once ("plan changed") because of a fingerprint mismatch |
| **M6** | migration | **S2** | A single unparseable `d`/`start`/`end` throws and blocks the entire migration |
| **P2** | progression | **S2** | Bodyweight ladder: an unchecked set permanently removes a set; one weak set drags the whole next target down |
| **P3** | progression | **S2** | Double progression lost v1's "beat your best at this weight is progress" rule and the `low+1` aim |
| **P4** | progression | **S2** | The lifter's own load is ignored when building the next load (increment applies to the *prescribed* load) |
| M8 | migration | S3 | No upper bound on `sets`: `1e6` → 59 MB output / 8 s, `1e9` → out-of-memory (would kill the API process) |
| M7 | migration | S3 | Migrated cardio logs are flagged `actual.incomplete: true` and carry no duration/speed summary |
| M9–M13, D1–D6 | misc | S3 | Smaller divergences and data-not-migrated items (§3, §4) |

---

## 2. Bugs in the v1 → v2 migration

> **Resolved** (`report-corrections` Task 2): M1, M2, M3, M4, M6, M7, M8, M10, M13. Accepted, documented differences: M9, M11, M12 (see `docs/MIGRATION_TO_ENGINE_NOTE.md` §3.12).

### M5 — the migrated profile exceeds the sync cap for heavy users (S1)

> **Resolved for sync** (`report-corrections` Tasks 3–4): the profile is stored and sent in a lossless compact form (`api/migration/profile-pack.js`: short keys, derivable row fields dropped, the invariant part of each track's prescriptions written once). The 1000 × 6 fixture is 8.5 MB on the wire instead of 16.1 MB (canonical, as measured now); the ceiling moves from ≈ 950 to ≈ 1,800 sessions × 6 exercises. No row, prescription, `actual` or `audit` is dropped. **Still open:** the `localStorage` quota (~5 MB) of web guests — 8.5 MB for 1000 sessions still exceeds it (from ≈ 550 sessions). Signed-in users have the server copy, Capacitor guests the native file; closing it for web guests needs gzip (`CompressionStream`) or IndexedDB, as separate work.

*Repro* (`api/test/migration-audit.test.js` → M5): 1000 sessions × 6 exercises × (2 warm-up + 4 work rows),
linear, all linked.

| | size |
|---|---|
| v1 | 2.47 MB |
| v2 | **17.05 MB** (`workouts` 9.9 MB, `prescriptions` 7.2 MB; 6000 prescriptions of ~1.2 KB each) |

`assertSyncSize` caps the document at `MAX_SYNC_BODY` = 16 MiB (`api/migration/profile-size.js`). It is
applied in `POST /api/data/migrate-engine-v2` (`api/server.js:2084`, inside the `try` → `500
migration-failed`), in `confirmMigration`/`importBackup` (`useStore.js:1098,1258,1267,1629`) and by nginx
(16m). The threshold is ≈ 5,600 logged exercises with this shape (6 exercises × 4 sessions/week ≈ 4½ years;
fewer if rows carry notes, drops, per-side rows or media). The user then sits on "Your training data needs an
upgrade" with **Try again** that can never succeed; the backup is intact but there is no way forward.
Related, not tested: the browser/guest copy lives in `localStorage` (≈5 MB quota in most browsers) next
to the untouched `gym_state_v1.pre-engine-v1` backup, so the local write fails far earlier (around
300 sessions of 6 exercises).

*Cause*: one fully frozen prescription (rule copy, rounding, increment, completion, `rows[]`, …) per
logged exercise, plus a `performance`/`actual`/`audit` block per exposure.
*Suggested fix*: de-duplicate prescriptions (content-addressed by `contentHash`, most migrated
prescriptions for a track differ only in load/reps), or store a compact prescription for migrated
history and only expand the newest per track; fail *before* writing anything and offer "archive
history older than N months" rather than a dead end.

### M1 — one-decimal v1 loads push the step onto a 0.1 grid (S2)

v1 stored loads through `round1(snapWeight(...))`, so a 1.25 kg plate step produces `21.3` (=21.25),
`23.8`, `26.3`… `stepFor` (`profile-migration.js:75`, `onGrid` tolerance 1e-6, line 74) sees 21.3 as
off the 1.25 grid, falls through the list to **0.1**, and every later increment lands off the plate grid.
v1 `addStep` treats a load within 0.1 of the grid as on it and snaps.

```
v1: 21.3 + 1.25 → 22.5      v2 after migration: 22.6 (then 23.9, 25.1 …)
```
Repro: `M1`. Affects everybody who uses a 1.25 (or 0.25/0.625) increment — common for micro-plates and
dumbbells. The fuzz comparison with v1 (`diff.mjs`, 3000 trials) shows **zero** load differences once loads
are on a 2.5 grid, so this is the whole difference.
*Fix*: use v1's own tolerance (`≤ 0.1`) in `onGrid`, and prefer `inc` as the step whenever every load is
within 0.1 of it.

### M2 — the rounding step does not divide the increment (S2)

`stepFor` only checks that **loads** sit on the step, not that `load + inc` does. A 52 kg load with the
default 2.5 kg increment → step **1** → 54.5 is rounded by `resolveLoad` to **55**; v1 prescribes 54.5
("a sled logged as 397 lb… goes to 407", `addStep`, issue #175). Any off-grid load (machines with pin
stacks, 47 kg, 8.75 kg, 17 kg, …) is affected, every session, forever.
Repro: `M2`. *Fix*: pick the coarsest step that divides both every load and the increment.

### M4 — held loads are re-rounded onto a grid chosen without them (S2)

The step is computed from the plan weight and the **target** weights of linked logs only. Loads that
come from *unlinked* history are held by `resolveProgressionContext` (`first_in_routine`,
`generate.js:103`: `hold` → `expression = heldLoad`) and then snapped by `resolveLoad`. Example: legacy log
of 52.5 kg, plan weight 50, heavy body part (inc 5 → step 5): the next prescription is **55**, a load
that was never lifted and is 2.5 kg *heavier* than the best set. v1 held 52.5.
Repro: `M4`. Same root cause as M1/M2: include **all** logged work loads of the exercise (not only
linked targets) when choosing the step, or hold a lifted load unrounded.

### M3 — ladder tracks restart once they reach zero help (S2)

For an assistance machine (or a bodyweight exercise) whose routine slot has `weight > 0` but whose last
log is at 0, the draft rule becomes `bodyweight_ladder` (sets `max 6`, reps `max 20`), while the
fingerprint stamped on each logged prescription is computed from `d.ruleFor({})`, i.e. the **linear**
rule built from `cfg.weight` (`profile-migration.js:264–267`):

```
rule fingerprint  {"reps":{"min":13,"max":20},"sets":{"min":1,"max":6}}
stamped last log  {"reps":{"min":13,"max":13},"sets":{"min":1,"max":1}}
```
`resolveProgressionContext` reads that as `plan_changed`, drops the state and holds: v1 climbs 13 → 14,
v2 stays at 13 and (when sets were added) drops back to the plan's set count. One session of lost
progress per affected track — typically every user of an assisted pull-up/dip who has reached "no help".
Repro: `M3`. *Fix*: compute the stamped fingerprint with the same preset/shape the live rule will have
(`d.preset`/ladder when the newest linked load is 0).

### M6 — one bad date blocks the whole migration (S2)

`checkDates` (`profile-migration.js:528`) throws `invalid-date …` for any `d` that
`Date.parse(d+'T00:00:00Z')` rejects (`''`, `2026-1-5`, `2026-01-05T10:00`, `05/01/2026`), and for a
string `start`/`end`. The doc's A21 says malformed records are *dropped, not repaired* — but these are
not dropped, they abort everything (server: `500 migration-failed`; client: error screen). A hand-edited
or imported backup with one such workout makes the account un-upgradable.
Repro: `M6`. *Fix*: fall back (`start` → `d` → epoch of file order) and record the workout path in
`migrationAudit.discarded`/`unsupported` instead of throwing.

### M8 — `sets` is unbounded (S3)

`whole(v.sets)` has no cap, `generatePrescription` builds `Array.from({length: sets})` rows: `sets: 1e4` →
0.6 MB, `1e6` → 59 MB and 8 s, `1e9` → heap exhaustion. On the server the migration runs inside the API
process. v1's own UI limited what a person could type, but plan files, the Coach and hand-edited backups
are not that UI. Cap at the rule's own sane maximum (e.g. 50) and audit the clamp. Repro: `M8`.

### M7 — migrated cardio logs are `incomplete` (S3)

`performedOf` (`profile-migration.js:329`) reads `row.sec`, but a cardio row carries `min`/`speed`:
`actual = { sets: 1, incomplete: true, reps: null, load: null }`, no `durationSeconds`/`speed`. Cardio
is `manual` (never progresses) so no prescription changes, but any reader of `actual` (audit, Coach,
exports) sees an incomplete log. Live finishing (`actualOfRow`) converts minutes to seconds correctly.
Repro: `M7`.

### Smaller migration items (S3)

* **M9 — effort fields collapse.** A row carrying both `rir` and `rpe` keeps only the RPE-derived RIR
  (`normalizeEffort` prefers RPE), so the typed `rir` is lost (`performanceRow`).
* **M10 — `routineIds: []` with a scalar `routineId`.** `...rest` drops `routineId` and the array is kept
  as `[]`: the routine association is lost (and the entry is unlinked). v1 itself reads
  `routineIds[0] ?? routineId` (`history.js:284`). Only reachable from hand-edited data; the app writes both.
* **M11 — a combined session without per-entry `rid`** is unlinked (v1 attributed it to `routineIds[0]`).
  Documented as A3(d); listed because it silently drops that session from progression.
* **M12 — hold (timed) back-off.** The documented "a new window is a new run" difference means a track
  that v1 would deload on its next session after a previous back-off is held instead (8/2500 fuzz trials).
* **M13 — invalid root `unit`** (`"lbs"`, `"KG"`) with an in-progress workout throws `invalid-active unit
  must be kg or lb`, because the profile `unit` is copied verbatim while the conversion itself defaults to kg.

---

## 3. Data not migrated / changed

| Id | v1 data | v2 |
|---|---|---|
| D1 | `exWeights` (confirmed working weight per exercise) | kept verbatim, **read by nothing** (`grep`: only sync-merge/backfill/session-edit maintain it). v1 used it as the opening weight for an exercise with no session and no plan weight (`history.js:495`). After migration such a slot opens at 0/empty unless some logged session exists. Documented as A15 |
| D2 | v1 `topW`-only entries (pre-sets history) with a `target` | converted to one done row with no reps; they are *linked* but excluded from progression, as v1 ignored them (P1, resolved) |
| D3 | unknown fields on routine exercises, entries and rows (e.g. anything a future/foreign build wrote) | dropped (`occurrenceOf`, `performanceRow` are whitelists); only the untouched backup holds them. The documented fields are all covered — see the leaf-diff in §6 |
| D4 | `routineId` scalar, whole-workout `excludeFromProgression` | folded (`progressionExclusion:'explicit'` keeps the semantics), flag not kept |
| D5 | typed `rir` when an `rpe` is also present | lost (M9) |
| D6 | `target.*` (other than sets/reps/weight/sec/min/speed) and `planned.weight` of **linked** entries | not kept; legacy entries keep `legacyTarget`/`legacyPlanned` verbatim |

Nothing else in the documented root/routine/workout/entry/row schema was found missing (leaf diff, §6).

---

## 4. Bugs and divergences in the progression system

Method: a differential harness drove **v1's real `nextPrescription`** (`git archive main`) and the
**v2 engine after migration** (`migrateProfileV1ToV2` + `buildSessionExposures`) over randomly generated
histories (barbell/dumbbell/machine/bodyweight/assisted/ball/timed; linear, greyskull, double, time, off;
routine-level default policy; plan edits; clean/missed/partial/extra/over sessions), comparing the
weight, reps, sets and seconds the next session opens with.
**Result: on grid-aligned loaded work, linear and Greyskull match v1 exactly (0 differences in 3000
trials; the same for `time` apart from M12).** Every difference found is listed here.
The bugs below also occur in a profile that never was v1 (the live engine), except where noted.

### P1 — skipped exercise = miss (S1, live + migration)

> **Resolved** (`report-corrections` Task 1): an exposure with no completed work row is `excludedFromProgression: true` — live (`finish-session.js`) and migrated (`link.skipped`); migrated entries stay converted, not legacy. Also resolves D2.

v1 never saved an entry without a completed set (`finish-workout.js:64`, `.filter(entry =>
entry.sets.some(hasCompletedWork))`) and ignored sessions without a done set (`sessionsIn`).
v2's `finishWorkout` (`sheets.jsx:2629–2641`) calls `buildCompletedSession` for **every** exposure; for an
exercise with nothing checked it runs `advanceProgression` with `actual = { sets: 0, reps: null }`, which
is `!hit` → `stalls++` (`advance.js:87–91`). After 3 sessions in which the exercise is skipped:

```
stalls: 3, readyToDeload: true → next prescription 100 → 90 (epley)
```
Skipping an exercise (equipment taken, injury, short on time — and the "Finish early?" dialog invites it)
silently deloads it. Also true for migrated history (`H6`: a linked entry with no done set counts as a
stall; v1 history from `topW`-only records or edited workouts can contain them).
Repro: `frontend/src/lib/engine-audit.test.js` → P1.
*Fix*: in `buildCompletedSession` (and the migration's `link`) do not advance the track — and mark the
exposure excluded — when no work row is completed.

### P2 — bodyweight ladder (S2)

> **Resolved** (`report-corrections` Task 5): v1 semantics restored in the engine and proven on migrated history (`api/test/migration-audit.test.js` parity tests, expected values taken from v1's own `nextPrescription`).

`prefill.sets = last.sets` and `prefill.reps = last.reps` come from the **summary of what was
completed**, not what was prescribed (`generate.js:155–166`, `fromLast` is on for the `rung` gate):

* 3 prescribed sets, last set not checked → next session has **2** rows; do it again → 1. Volume decays
  one set per incomplete session. (v1 kept the prescribed count: `reached`, `progression.js:455`.)
* reps 10, 10, 4 → next opens at **4** reps (weakest set); one bad set ratchets the target down. v1: "same
  target again until every set is clean".

Repro: P2 ×2. *Fix*: take sets from `max(prescribed, …)` and reps from the prescribed target unless the
session was clean.

### P3 — double progression (S2)

> **Resolved** (`report-corrections` Task 5): v1 semantics restored in the engine and proven on migrated history (`api/test/migration-audit.test.js` parity tests, expected values taken from v1's own `nextPrescription`).

* v1 `stallCount` (PR !93): at one weight, a session that **beats the best of the run** is progress,
  not a stall. v2 has no equivalent (`advance.js` counts any `!hit`). Lows of 5, 6, 7 against an aim of 8
  deload on the 3rd session in v2 (50 → 42.5); v1 holds. In the fuzz run this is the dominant source of
  `weight` differences (double).
* After a session short of the aim, v1 aims at `low + 1` (`progression.js:557`); v2 repeats `low`
  (`climb` requires `state.clean`, otherwise `prefill.reps = last.reps`). Combined with the first point,
  the aim stops moving after any miss.

Repro: P3 ×2. *Fix*: carry a per-weight "best low" in the progression state and treat an improving session as
a hold (not a stall); keep `+1` after a miss.

### P4 — the lifter's own load is not the baseline (S2)

> **Resolved** (`report-corrections` Task 5): v1 semantics restored in the engine and proven on migrated history (`api/test/migration-audit.test.js` parity tests, expected values taken from v1's own `nextPrescription`).

v1 built the next load from the heaviest load actually lifted (`readSession.weight`) and judged
sessions by reps only. v2 increments `lastPrescription.parameters.load.expression` and judges by
`hit` (which also requires load ≥ prescribed):

| session | v1 next | v2 next |
|---|---|---|
| prescribed 60, lifted 70 ×5 clean | 72.5 | **62.5** (and the rows then open at 62.5, 7.5 kg under the lifter's real load) |
| prescribed 60, lifted 50 ×5 clean | 52.5 | 60 hold, `stalls = 1` (three such sessions → deload of a *lighter* load than lifted) |
| 60, 60, 50 | 62.5 (max) | 60 hold |

For the migration this means that if the **last** logged session was lifted off its target, the seed is
the target (`ctx` `last.values.weight`), not the lifted load. The UI partly hides it (rows open at
`prefill.load` = last lifted on a *hold*), which makes the behaviour inconsistent between hold and
increment sessions. Repro: P4 ×2. *Decision needed*: either rebase the rule's load on the lifted load
when the session was clean (closest to v1), or document it as a deliberate change.

---

## 5. Other observations (not bugs)

* `docs/MIGRATION_TO_ENGINE_NOTE.md` §6 examples all assume lifted == target; P4 shows they do not generalise.
* `migrationAudit.unsupported` never records the behavioural changes above (it only lists unknown policies,
  unusable `deloadFactor`/intensifier), so a user cannot tell they were affected.
* The migration is deterministic (`nonDeterministic: 0` over 4000 mutated inputs) and a v2 input is returned
  unchanged.

---

## 6. What was checked and holds

* **Determinism & validity**: 4000 randomly corrupted v1 profiles (wrong types, negatives, strings,
  NaN→null, arrays/objects in scalar slots, bogus ids/units) — no crash other than the throws listed
  (M6, M13, id-as-array); every output passed `validateCanonicalProfile`/`validateCanonicalActive`; two runs
  were byte-identical.
* **Rows**: warm-ups, drop sets (segments), rest-pause clusters, per-side rows, timed holds, cardio — all
  carried (`migration-audit.test.js`, "no logged row is lost").
* **Leaf diff of a fully populated v1 profile**: every documented root, routine, workout, entry and row
  field is present in v2 (renamed/restructured where documented); the only absences are §3.
* **Progression equivalence**: see §4 intro (linear, Greyskull, time; double and ladder differ as listed).
* **Active (in-progress) workout**: converts without throwing across the fuzz set, `cur` is clamped, rows
  keep their values.

Not reviewed (out of time; worth a second pass): the client transaction (`useStore.confirmMigration`,
journal/resume), `sync-merge` with two diverged v1 copies, the Capacitor file mirror, `mcp/` and
`coach/` readers, 5/3/1 / pyramid presets (new in v2, no v1 counterpart).

---

## 7. New tests and how to run them

| File | Runner | What |
|---|---|---|
| `api/test/migration-audit.test.js` | `cd api && node --test test/migration-audit.test.js` | Every finding (M1–M8, M10, M13, P1) and the v1-parity cases (P2–P4, values taken from v1's own `nextPrescription`) as plain passing tests |
| `api/test/migration-robustness.test.js` | `cd api && node --test test/migration-robustness.test.js` (`FUZZ_N=8000 FUZZ_HARD=60` widens the seeded fuzz) | Invariants for ANY v1 document — seeded realistic and corrupted profiles: never throws, valid canonical output, input untouched, deterministic, JSON/wire lossless, first session generable — plus named edge cases (shapes, ids, `__proto__`, dates, numbers, active session, stray v2 keys, scale) and one regression per bug the fuzz found |
| `frontend/src/lib/engine-audit.test.js` | `cd frontend && npx vitest run src/lib/engine-audit.test.js` | The live-engine counterparts of P1–P4, all plain passing tests |

Both are green (api: 605 pass; frontend: 3305 pass).


The differential and fuzz harnesses (`diff.mjs`, `garbage.mjs`, `size.mjs`, `leaf.mjs`) are in the session
scratchpad, not in the repo: they import `main`'s `progression.js` from a `git archive`, which the repo
test setup cannot do. They can be added as a dev script if useful.

## 8. Suggested order of work

1. **M5** (size) and **P1** (skipped = miss) — one blocks users, the other silently deloads everybody.
2. **M1/M2/M4/M3** — small, local changes in `stepFor` / fingerprint; they make the first session after the
   upgrade match v1 (the stated goal of the migration).
3. **M6/M8** — turn throws into audited quarantines.
4. **P2/P3/P4** — product decisions; at minimum add the v1 behaviours back or document them.

## 9. Robustness pass (seeded fuzz + edge cases)

`api/test/migration-robustness.test.js` drives thousands of generated and corrupted v1 documents through
the migration and checks, for every one: no throw, `validateCanonicalProfile`/`Active` ok, input not mutated
(deep-frozen), deterministic, JSON round trip and wire pack/unpack lossless, no non-finite number, and the
first session after the upgrade can be generated for every occurrence. It found, all fixed:

| Bug | Effect before | Fix |
|---|---|---|
| Fractional logged reps (5.5) reach the plan | first session after upgrade throws `parameters.reps: must be whole numbers` (the app cannot open the exercise) | `generatePrescription` counts the whole reps; the log keeps 5.5 |
| Unloaded plan of > 6 sets | same crash (`sets: min is above max`) in the unloaded-ladder transition | ladder keeps `max(sets, 6)` |
| Negative logged reps / load / time / speed | negative reps seeded the next rule → invalid rule | read as absent |
| Rest-pause clusters as bare numbers / junk | output failed validation → `invalid-output`, migration stuck | numbers → `{ r }`, junk dropped |
| Rest-pause total as text on a logged target | prescription with `reps: "x"` → invalid output | whole numbers only |
| Exercise/routine/workout id `[]`, `{}`, `true` | `''` / `[object Object]` ids, colliding 1RM keys → invalid output | not an id (audited) |
| Load ≥ 1e308 or time × 60 overflow | `Infinity` 1RM / volume / duration → invalid output | numbers past ±1e15 are absent; guards on 1RM and volume |
| Coach snapshot with non-list `routines` | recursive migration throws → whole migration fails | snapshot left untouched |
| `prescriptions` / `progression` / `oneRepMaxes` junk already on the document | invalid output → stuck | kept only if valid, rest audited |
| `packed` / `templates` on a v1 root | wire form mistook the profile for an already packed one → unpack lost data | stripped and audited |
| `sets` above 50 | silently clamped | clamped + `migrationAudit.unsupported` (`sets`) |
| Loaded lift never given a weight (log without load) | v2 opened at one increment (0 → 2.5 kg), reset double reps to the bottom and could count stalls; v1 held the plan and asked for the weight | `advanceProgression` earns/counts nothing for a load-progressing log with no load (`unweightedLog`); `generatePrescription` holds the plan (double: its top reps); typing a weight resumes progression from it |

Every one of these was a state in which `POST /api/data/migrate-engine-v2` answered `500 migration-failed`
(or the client showed "Try again") forever; each now has its own named regression test, red on the old code.

**Not changed — differences from v1 that remain** (found with the differential harness against v1's own
`nextPrescription`, not bugs of the migration but of the v2 engine; product decisions):

* *Double progression after a session whose last set was not checked*: v1 reads the unchecked set as 0 reps and
  aims back at the bottom of the range; v2 judges the sets that were done and keeps the aim (A41/A42 by design).
* *Rep climbs after an over-performed session* (bodyweight / unloaded): v1 steps from the prescribed target
  (+1), v2 from what was logged (+1).
* *Timed hold after a deload run*: seconds can differ by one step in a few percent of random histories (M12).
* Linear and Greyskull on loaded work with grid-aligned loads match v1 exactly (differential harness, 1,200 trials, 0 differences); the only residue is v1's one-decimal storage (v1 21.3 vs v2 21.25).
