# Combine routines — do more than one routine in a session

Implementable spec for **combining routines**: running more than one routine in a single
workout. Two ways in — an ad-hoc "add a routine" from the workout header, and a weekly-planner
day that holds several routines — plus a shared merge helper and every existing reader that
changes shape.

Design provenance: Linear map [ENG-9](https://linear.app/factical/issue/ENG-9) and its
decision tickets ENG-10 (reader inventory), ENG-11 (`noProg` semantics), ENG-12 (UI
surfaces), ENG-14 (data-model invariants), ENG-15 (plan fingerprint / Coach). This document
is the assembled hand-off; it describes what to build, not a change already made.

---

## 1. Model

**Model A — no new entity.** A combined session is the concatenation of the session entries
built from N routines. There is no "composite routine" object; nothing is stored that a
single-routine session did not already store, only widened.

- **Planner day slots hold a list.** `S.week[weekday]` becomes `string[]` (routine ids, in
  merge order). `S.dayPlan[iso]` **stays scalar** — the per-date override and Start-time are
  single-pick (ENG-12).
- **The active session tracks its routines.** `s.active.routineId` is removed; `s.active`
  gains `routineIds: string[]` and a `rid` stamped on every `active.entries[]` entry at merge
  time.
- **Saved workouts mirror it.** `w.routineId` becomes `w.routineIds: string[]` with a
  back-compat mirror `w.routineId = routineIds[0]`; each saved entry carries its `rid` (and
  its `noProg`, see §6).
- **No migration pass.** Readers tolerate the old shape: a bare string is treated as a
  one-element list. Existing profiles are never rewritten.
- **Merge = concatenation in routine order** (the order routines were selected in the planner,
  or added in-session). In-session reorder covers anything finer.
- **Duplicate exercise = same exercise `id` across routines. v1 keeps every exercise** — no
  dedupe or choice UI.
- **Adding the same routine twice is blocked** (already-in-session routines are shown
  disabled). This also removes the superset-group (`sg`) id-collision risk.

### 1.1 The four shapes and their readers

From the [reader inventory](https://linear.app/factical/issue/ENG-10): 74 anchored sites
across 21 non-test files, **61 needing a code change**. The shape-by-shape tables in that
ticket's resolution comment are the migration checklist; the load-bearing groups:

| Shape | Change | Reader treatment |
|---|---|---|
| **S1** `S.week[d]` value | scalar id → `string[]` | 44 sites: 17 new-shape writers, plural-helper conversions, 11 array-tolerant reads, 4 array-tolerant writes (remove-from-list + delete-when-empty). `S.dayPlan` **excluded** — stays scalar. |
| **S2** `s.active.routineId` | → `routineIds: []` + per-entry `rid` | 24 sites: `beginWorkout` / `beginBackfill` writers, 9 per-entry `rid` reads (swap, progression settings, add-exercise), the 6-site `startFlow` caller cluster. |
| **S3** `w.routineId` | → `routineIds: []` + `routineId` mirror | 6 sites. Only `WorkoutRow`'s glyph reads it, and the mirror covers that. `buildCompletedWorkout` is the sole writer. Nothing aggregates saved workouts by routine. |
| **S4** `effectiveRoutineId` / `effectiveRoutine` / `nextTrainingDay` | plural primaries + thin singular wrappers | 10 call sites (2 internal to `history.js`, 8 across `sheets.jsx`, `mobile.js`, `TabBar.jsx`, `Workout.jsx`, `Home.jsx`). |

**Gotchas the implementation must not trip on** (full list in ENG-10): empty-array
truthiness (`[]` is truthy — writers must `delete` the key, never store `[]`); `=== id`
comparisons that silently stop matching against an array; `views/Workout.jsx:35`
`r !== todayR` identity filter; `hashPlan` string coercion of an array (§7).

---

## 2. The merge helper

**New module `frontend/src/lib/session-merge.js`**, paired with `session-merge.test.js`.
Imports `buildSessionEntries` from `lib/session-start.js`; nothing imports it but `sheets.jsx`
and `views/Workout.jsx`, so there is no cycle.

```js
import { buildSessionEntries } from './session-start.js'

// Build a session's entries from an ordered list of routine ids.
// - resolves + filters to still-existing routines, de-duplicates by id (first wins)
// - concatenates each routine's entries in list order
// - stamps entry.rid = <that routine's id> on every entry
// Returns { entries, routineIds, routines } — routineIds/routines are the resolved,
// de-duplicated list (so callers store exactly what was built).
export function buildCombinedEntries(st, routineIds) {
  const seen = new Set()
  const routines = [].concat(routineIds ?? [])
    .filter(id => id && !seen.has(id) && seen.add(id))
    .map(id => st.routines.find(r => r.id === id))
    .filter(Boolean)
  const entries = routines.flatMap(r =>
    buildSessionEntries(st, r).map(e => ({ ...e, rid: r.id }))
  )
  return { entries, routineIds: routines.map(r => r.id), routines }
}

// ENG-12 name rule. names in merge order.
//  1–3 routines: join with " + "         → "Rehab + Core"
//  4+ routines:  first two, then + N more → "Rehab + Core + 2 more"
export function deriveSessionName(names) {
  if (!names.length) return null            // not a reachable state for a saved/active session
  if (names.length <= 3) return names.join(' + ')
  return `${names[0]} + ${names[1]} + ${names.length - 2} more`
}
```

`buildSessionEntries(st, r)` (in `lib/session-start.js`) is refactored in the same change:

- **Returns a bare `entries` array** — the `{ entries, excluded }` wrapper is retired
  (ENG-11). Callers that used `excluded` use per-entry `noProg` instead.
- Computes `noProg = r?.excludeFromProgression === true`, uses it exactly where `excluded`
  is used today (`plan: { policy:'off', kind:'off' }`, `useTarget: plan.kind === 'off'`), and
  stamps `entry.noProg = true` **on excluded entries only**.
- Does **not** stamp `rid` — the merge helper does, so the same builder serves the
  single-routine and combined paths unchanged.

Every start path routes through `buildCombinedEntries`, including a single-routine start (a
one-element list) and freestyle (an empty list → `entries: []`, no `rid`).

---

## 3. Entry-point flows

Exactly two ways to build a combined session.

### 3.1 In-session — workout header ⋮ → Add routine

`views/Workout.jsx` `openViewMenu` is restructured (ENG-12 §3):

- First menu item: **Add routine** (icon `plus`, sub "Bring another routine into this
  session").
- A **Layout** row (icon `list`, sub = current layout name) opens a **nested sheet** holding
  Cards / List / Compact — today's three-item toggle, moved down one level. The menu drops
  its "Workout view" title.

**Add-routine sheet** — single-pick routine list:

- A routine already in `s.active.routineIds` → shown **disabled**, `already added` tag.
- A routine with no exercises → shown **disabled**, `no exercises` tag (not hidden).
- Tapping an eligible routine:
  1. `const add = buildSessionEntries(st, r).map(e => ({ ...e, rid: r.id }))`
  2. `s.active.entries.push(...add)`
  3. `s.active.routineIds.push(r.id)`
  4. `s.active.name = deriveSessionName(s.active.routineIds.map(id => nameOf(id)))`
  5. toast `"{name} added — {n} exercises"`.

`s.active.cur` is untouched — the current unit stays put; the appended block is reached by
scrolling / Next.

### 3.2 Weekly Plan — a multi-routine day, inline

`views/Plan.jsx` "Week schedule" replaces "tap day → radio sheet" with inline management
(ENG-12 §1):

- Each weekday row renders its assigned routines as **sub-rows** beneath the day header,
  **always visible** — routine glyph + name + exercise count, slightly indented.
- Each sub-row carries an inline **✕** (`iconbtn` sm) that removes that routine from the day.
  No swipe.
- A populated day shows a **＋ Add routine** action row → **single-pick** list; tapping a
  routine **appends** it and closes. A routine already on that day is disabled.
- An **empty day** stays one tappable row (label + "Rest" tag + chevron) → the single-pick
  picker chooses the **first** routine (today's behaviour, kept).
- **No reordering** in v1 — stored order (= order added) is the merge order.
- Day header shows a muted "`N routines`" hint when N ≥ 1.

Writers `delete` the day key when the last routine is removed — never store `[]`. `DayAssign`
as a full radio sheet is retired for the populated case (`dayAssignSheet` in `sheets.jsx`);
the old multi-select day sheet is removed entirely.

**Today card one-tap** (`views/Home.jsx` `onToday`): starts the day's planned session —
`startFlow(effectiveRoutineIds(S, todayISO()))`. When the weekday holds ≥ 2 routines and
there is no override, that single tap starts the combined session.

### 3.3 `startFlow` / `beginWorkout` / `beginBackfill`

```js
export function startFlow(routineIds) {
  bwSheet({ required: true, onDone: bw => beginWorkout(routineIds, bw) })
}

export function beginWorkout(routineIds, bw) {
  const st = S()
  const { entries, routineIds: rids, routines } = buildCombinedEntries(st, routineIds)
  update(s => {
    s.active = {
      id: uid(), d: todayISO(), start: Date.now(),
      routineIds: rids,
      name: routines.length ? deriveSessionName(routines.map(r => r.name)) : t('Freestyle'),
      bw: bw || null, cur: 0, entries,
      workoutView: st.workoutView || 'cards',
    }
  })
  useUI.getState().stopRest()
  nav('/workout')
}
```

- **`s.active.routineId` is not written** (removed — S2). **`s.active.excludeFromProgression`
  is not written** (removed — ENG-11); per-entry `noProg` + each excluded entry's
  `plan.kind === 'off'` carry it.
- `routineIds` accepts `string | string[] | null`; `buildCombinedEntries` normalises with
  `[].concat(x ?? [])`. The ~6 `startFlow` / `onStart` call sites
  (`components/TabBar.jsx:21`, `views/Home.jsx:56`, `views/Workout.jsx:44,47,52`,
  `App.jsx:143`) pass `[r.id]` for a specific routine, `effectiveRoutineIds(...)` for
  "today's planned session", `[]` for explicit freestyle.
- **`beginBackfill` stays single-routine** — `LogPastWorkout` UI is unchanged (one
  `SelectRow`). It still emits the new shape: `buildCombinedEntries(st, routineId ? [routineId] : [])`,
  `routineIds` set, no `routineId` on `active`.

---

## 4. Planner resolver — plural helpers

`frontend/src/lib/history.js` gains the plural primaries; the singular helpers stay as thin
wrappers (fewer call sites to touch, and "first routine" is already load-bearing for the
glyph).

```js
export function effectiveRoutineIds(S, iso) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return []
  if (ov && S.routines.some(r => r.id === ov)) return [ov]      // dayPlan stays scalar
  const wd = new Date(iso + 'T12:00:00').getDay()
  return [].concat(S.week[wd] || []).filter(id => S.routines.some(r => r.id === id))
}
export function effectiveRoutines(S, iso) {
  return effectiveRoutineIds(S, iso).map(id => S.routines.find(r => r.id === id)).filter(Boolean)
}
export const effectiveRoutineId = (S, iso) => effectiveRoutineIds(S, iso)[0] ?? null
export const effectiveRoutine   = (S, iso) => effectiveRoutines(S, iso)[0] ?? null
```

- `[]` / a stray empty array / key-absent all mean **rest**. "Is this a rest day?" is
  `effectiveRoutineIds(S, iso).length === 0`.
- `nextTrainingDay` uses `effectiveRoutines`; a day is trainable if **any** of its routines
  has exercises. Return shape gains `routines`; `routine` (= `routines[0]`) is kept for the
  "what's next" label.

**Call-site conversions** (switch to the plural helper, iterate a list where they rendered
one): `sheets.jsx` `DayOverride` (`:1508-1524`) and `Calendar` (`:1620-1621`);
`lib/mobile.js` `buildReminderNotifications` (`:111` — notification body joins names or
counts); `views/Home.jsx` Today card (`:22`), week-strip dot (`:43`), `next` (`:25`);
`components/TabBar.jsx:20`; `views/Workout.jsx` `StartChooser` (`:33-35` — replace the
`r !== todayR` identity filter with an id-set exclusion); `views/Plan.jsx:52`.

**`plannedPerWeek`** (`views/Home.jsx:52`) counts **days, not routines**:
`Object.values(S.week).filter(ids => ids?.length).length`. A combined day = **1**, matching
`wThisWeek` (which counts `w` records — a combined session saves one `w`). `streakWeeks` is
`S.workouts`-derived and unaffected.

**`RoutineEdit` delete-cleanup** (`views/RoutineEdit.jsx:449-450`): pull the deleted id out
of each `S.week` array, `delete` the key when it empties. `S.dayPlan` line is unchanged
(scalar — `=== id` still valid).

```js
Object.keys(s.week).forEach(k => {
  const next = [].concat(s.week[k]).filter(id => id !== deletedId)
  if (next.length) s.week[k] = next; else delete s.week[k]
})
```

---

## 5. `lib/plan-share.js`

The plan bundle carries arrays; import remaps each element.

| Site | Change |
|---|---|
| `buildPlanBundle` (`:104`) | `if (S.week?.[d]?.length) week[d] = [].concat(S.week[d])` |
| `parsePlan.scheduledDays` (`:149`) | `WEEK_DAYS.filter(d => data.week?.[d]?.length).length` |
| `mergePlan` schedule (`:184-186`) | per-element remap — see below |
| `weekHTML` (`:246-247`) | render `[].concat(S.week?.[d])` → routine names, joined by `deriveSessionName` (one cell per day) |

```js
// mergePlan — replace the scalar lookup
Object.entries(bundle.week || {}).forEach(([d, val]) => {
  const ids = [].concat(val).map(oldId => ridMap[oldId]).filter(Boolean)
  if (ids.length) s.week[d] = ids            // element whose id didn't survive parsing is dropped
})
```

A pre-upgrade bundle with scalar `week[d]` strings is tolerated by `[].concat`.

---

## 6. Progression & session read-back — `noProg`

From [ENG-11](https://linear.app/factical/issue/ENG-11). "Excluded from progression" moves
from a whole-workout flag to a **per-entry** one, so a rehab routine combined with real work
excludes only its own exercises.

- **One shared predicate**, exported from `history.js` and unit-tested once:
  `entryExcluded(w, entry) → w.excludeFromProgression === true || entry.noProg === true`.
  A legacy workout (whole-workout flag, no per-entry field) reads as all-entries-excluded.
- **`noProg` is derived purely from the source routine's `excludeFromProgression`** at build
  time and frozen onto the entry. No per-exercise toggle; editing the routine flag later does
  not rewrite a saved session. Written only when `true`.

**`progression.js` — `sessionsFor` (`:150-161`)**: drop the whole-workout
`if (w.excludeFromProgression === true) return`; after `const entry = w.entries.find(...)`,
add `if (entryExcluded(w, entry)) return`. This is the **only** progression-exclusion path in
the file — `nextPrescription → sessionsFor` is the sole caller; `stallCount` / `readSession`
work on the list it returns. A `noProg` gap at the same weight does not reset a stall.

**`history.js` — `lastEntryFor`**: becomes universally `noProg`-aware (skips
`entryExcluded(w, entry)` entries) for all four call sites (`buildWorkSets`,
`freestyleConfig`, `sheets.jsx:626` `ExerciseDetail`, `Workout.jsx:111` recap). The
`regular`-wrapper hack in `buildWorkSets` (`:335-337`, which rebuilt `S` with excluded
workouts filtered out) is **retired** — the predicate now lives one level down. Accepted
consequence: the in-session "Last time …" recap and the Library exercise sheet stop
surfacing an excluded session; "Last time" now has one definition everywhere — the most
recent *counting* entry.

**"Best" / PRs — unchanged.** `bestWeightFor`, `bestWeightForEntry`, and the `prs` calc in
`finish-workout.js` have never filtered `excludeFromProgression`; `noProg` does not change
that. A set you performed is a fact; `noProg` suppresses the next *prescription*, not the
record. (Pin this in a test so a future reader doesn't "fix" it.)

**All-history-`noProg`** (an exercise only ever logged in excluded routines): `sessionsFor →
[]` → `nextPrescription` hits `{ kind: 'first' }`, rows seed from the routine's own `target`.
The sessions stay visible in History and charts.

**`buildCompletedWorkout`** (`lib/finish-workout.js`): the per-entry field whitelist (`:6-26`)
must also copy `entry.noProg` (when truthy) and `entry.rid` onto each saved entry, or they
are dropped at finish. It writes the legacy **`w.excludeFromProgression: true` mirror iff
every completed entry is `noProg`** — derived from the entries, **not** read from `active`
(which no longer carries the flag). Rationale mirrors the `routineId` mirror: an all-excluded
session keeps working for older builds and external readers; the mixed case is new territory
only the new code handles. Header fields become `routineIds: active.routineIds`,
`routineId: active.routineIds[0] ?? null`.

**Mid-session plain "Add exercise"** (not "Add routine"): no `noProg` — a freehand add counts
for progression. The only mid-session route to an excluded entry is **Add routine** with an
excluded routine, through `buildSessionEntries`.

---

## 7. Coach — read-context & plan fingerprint

From [ENG-15](https://linear.app/factical/issue/ENG-15). The plan fingerprint is computed in
two runtimes that share no build step (`frontend/src/lib/coach.js` and `api/coach/core/`) and
must stay byte-for-byte matched. See `docs/AI_COACH.md` for the feature overview.

**Canonical form** — one string form shared by both runtimes. `canonicalPlan` (both) and
`cleanPlan` (server) normalise every day to an array:

```js
week: Object.fromEntries(
  [1,2,3,4,5,6,0].filter(d => S.week?.[d]?.length).map(d => [d, [].concat(S.week[d])])
)
```

Bare string `'r1'` and `['r1']` both normalise to `['r1']` — legacy and new-shape values are
indistinguishable downstream. `?.length` replaces the old truthiness filter so a stray `[]`
cannot leak in. Insertion order is preserved and **never sorted** (it is the merge order).

**`hashPlan`** (both runtimes) joins each day's list explicitly:

```js
week: Object.keys(plan?.week || {}).sort().map(k => k + '=' + plan.week[k].join('+'))
```

`{1:['r1']}` → `"1=r1"` — **byte-identical to the pre-upgrade fingerprint** for every
existing single-routine plan, so no false-stale storm on the first load after the update.
`{3:['r2','r3']}` → `"3=r2+r3"`. The outer `Object.keys().sort()` still sorts the weekday
keys; only the inner routine list is order-significant. `+` matches the ENG-12 display join.

**Model payload.** `build()` sends `plan: cleanPlan(S)`, so `p.plan.week` values become
`string[]`. The model is told, and told it still cannot compose a combined day:

- `api/coach/prompts/common.md`, plan-reading notes — add: *"`plan.week` maps a weekday to
  the list of routine ids trained that day — usually one; a combined day lists several, in
  training order."*
- `api/coach/prompts/review.md`, the `week` change-op row — add: a proposed `week` change
  names **exactly one** routine (or `"rest"` / `null`) and **replaces** the day; the Coach
  can move a day's routine but cannot build a combined day. On a combined day, `before` is
  the list, `after` is a single id.

**`api/` change list:**

| File | Change |
|---|---|
| `api/coach/core/payload.js` — `canonicalPlan` | day value → `[].concat(S.week[d])`; filter `S.week?.[d]?.length` |
| `api/coach/core/payload.js` — `cleanPlan` | same normalisation (stays ≡ `canonicalPlan` — the parity `coach.test.js` pins) |
| `api/coach/core/payload.js` — `aggregates` | `plannedDays`: `filter(k => S.week[k]?.length)` — a combined day already counts as 1 |
| `api/coach/core/plan-hash.js` — `hashPlan` | week join → `k + '=' + plan.week[k].join('+')` |
| `api/coach/prompts/common.md` | one plan-reading bullet |
| `api/coach/prompts/review.md` | `week` change-op clause |

`api/coach/jobs.js:315` (calls the fixed helpers), `api/coach/core/validate.js` (validates
the model's scalar proposed `week`; an array `beforeValue` for a combined day is
display-only), the `api/coach/routes.js` handlers, and `cadence.js` (reads `cadence.weekly`)
all need **no change**.

**Frontend `lib/coach.js` change list:**

| Function | Change |
|---|---|
| `canonicalPlan` / `hashPlan` | mirror the two server changes above |
| `currentValue` `case 'week'` (`:143`) | `return [].concat(S.week?.[wd] ?? [])` (empty array = rest) |
| `markStale` (`:168`) | `week` branch: stale when `norm(cur).join('+') !== norm(before).join('+')` |
| `CHANGE_APPLY.week` (`:506-509`) | `else s.week[d] = [c.after]` — single-routine op, slot stays an array; collapses a combined day to one routine (same limitation as `DayOverride`, §8) |
| `changeValues.fmt` (`:610-618`) | handle `c.type === 'week'` **before** the generic `Array.isArray` branch — render an array as `" + "`-joined routine names, `null` / empty as *Rest* |

`markStale`'s `planMoved` check needs nothing (the stable canonical form means an untouched
legacy plan hashes the same after the upgrade). Revert needs nothing — `snapshotPlan` /
`revertLast` deep-clone the whole `{ routines, week }`. The `week` change op stays **strictly
scalar**.

---

## 8. Data-model invariants

- **Rest contract.** `S.week[wd]` is `string[]`. **No app writer ever persists `[]`** —
  removing the last routine `delete`s the key. **Key-absent is the sole canonical "rest"**,
  unchanged from today, so every existing truthiness gate keeps working after a `.length`
  tweak rather than a rewrite. Helpers still *defensively* treat a stray `[]` as rest
  (tolerant-reader policy — no migration), but the app maintains the no-empty-array invariant.
- **`S.dayPlan[iso]` stays scalar** — a routine id, the `'rest'` sentinel, or `undefined`.
  Never an array. Every `dayPlan` reader stays scalar-only; all array-tolerance is on
  `S.week`. The reader inventory's "`dayPlan[iso] → rid[]`" line is retracted.
- **`plannedPerWeek` counts days, not routines** (§4).
- **Mid-session `rid` attribution** (ENG-14):
  - **Add exercise → inherit the current unit's `rid`.** The new entry is inserted adjacent
    to that unit, so inheriting its `rid` keeps each routine's block contiguous in the
    grouped `WorkoutDetail`, matches intent, and gives `nextPrescription` a real routine.
    Sites: `views/Workout.jsx:862` (picker), `:870` (`nextPrescription` routine lookup),
    `:878` (splice — stamp `rid`).
  - **Swap → keep the replaced slot's `rid`.** In-place substitution; routine identity
    unchanged. Sites: `sheets.jsx:955-973` (`swapTo` — resolve routine from
    `entries[index].rid`, stamp `current.rid` onto `replacement`);
    `lib/active-exercise-swap.js:38-41` (split-insert literal — add
    `...(current.rid ? { rid: current.rid } : {})`, the way `sg` is already preserved).
  - **`noProg` follows that `rid`**, frozen at insert. An added exercise is never
    independently `noProg`.
  - **Routine-less freestyle session** (Quick Start, `routineIds` empty): `rid = null`,
    `plan = null` — the explicit-null path `nextPrescription` already handles.
- **Stated limitation.** Because `S.dayPlan[iso]` stays scalar, overriding a **scheduled
  combined date** via `DayOverride` or the Today card collapses it to the single chosen
  routine (or `'rest'`); `effectiveRoutineIds` then returns `[override]`. A one-off combined
  day is still reachable: start one routine, then **Add routine** from the workout ⋮ menu.
  No multi-select on `DayOverride`; no new per-date composite storage.

---

## 9. UI surfaces

From [ENG-12](https://linear.app/factical/issue/ENG-12) (prototype branch
`prototype/eng-12-combine-ui`, dev route `/#/proto/combine`).

- **Plan → Week schedule** — inline per-day management (§3.2).
- **`DayOverride` & Start** — unchanged, single-pick; `S.dayPlan[iso]` stays scalar.
- **Workout header ⋮ menu** — **Add routine** as the first item; Cards / List / Compact
  demoted to a nested **Layout** sheet (§3.1).
- **Add-routine sheet** — single-pick; already-added and empty routines shown
  disabled + tagged; toast `"{name} added — {n} exercises"`.
- **Home Today card** — title = derived session name (§2 helper); glyph = the **first
  routine's** emoji (`glyphOf(routines[0].emoji)`). No routine chips, no count line, no new
  "combine" icon. Layout identical to a single-routine day.
- **History `WorkoutRow`** — glyph = first routine's emoji; title = derived name (already on
  `w.name`).
- **History `WorkoutDetail` body** — entries **grouped into per-routine sections** in merge
  order, keyed by per-entry `rid`. Each section subheader: routine glyph + name (left),
  `"{sets} sets · {volume} {unit}"` for that routine's entries (right), hairline under it —
  matching the existing section-divider style. PR badges / per-entry notes stay on the entry
  rows. **A legacy single-routine workout** (one `routineIds`, or entries without `rid`)
  renders as one implicit group with no subheader — exactly as today.
- **Name-derivation rule** — `deriveSessionName` (§2). Used by the Today card, the
  `WorkoutRow` / `WorkoutDetail` headers, `s.active.name` / `w.name`, and the printed plan
  grid (`plan-share.js` `weekHTML`).

---

## 10. Out of scope

Ruled beyond this effort's destination — each returns only as its own later effort:

- **Duplicate-exercise drop/keep UI** — v1 keeps every exercise.
- **Bulk "remove routine" mid-session** — remove exercises individually; per-entry `rid`
  makes this a cheap later add.
- **Reordering a planned day's routines; interleaving the merge order** — selection / stored
  order only.
- **Consolidating the other workout-footer actions into the ⋮ menu** — adjacent cleanup, not
  required here.
- **Coach reasoning about or proposing composite days** — read-context array-tolerance only;
  a `week` proposal stays single-routine.
- **Past-workout logging / backfill going multi-routine** — `LogPastWorkout` stays
  single-routine.

---

## 11. Test checklist

Per CONTRIBUTING, anything that decides what you lift or reads a session back is a **pure
helper in `lib/` with a unit test beside it**. New/changed helpers and their coverage:

### `lib/session-merge.test.js` (new)

- `buildCombinedEntries` concatenates two routines' entries in list order; every entry has
  `rid` set to its source routine.
- De-dupes a repeated id (first wins); drops an id with no matching routine; `[]` / `null` →
  `{ entries: [], routineIds: [] }`.
- A single-element list produces the same entries as the pre-change `buildSessionEntries`
  path (no regression for the common case).
- `deriveSessionName`: `[]` → `null`; 1–3 → `" + "` join; 4 → `"A + B + 2 more"`;
  5 → `"A + B + 3 more"`.

### `lib/session-start.test.js`

- `buildSessionEntries` returns a bare array (no `{ entries, excluded }`).
- An excluded routine stamps `noProg: true` on every entry and `plan.kind === 'off'`; a
  normal routine stamps neither.

### `progression.test.js` (existing `sessionsFor` block + legacy-deload test stay green)

1. Per-entry `noProg` in a mixed session is skipped for **that exercise only** —
   `sessionsFor(S, squat)` omits it, `sessionsFor(S, press)` still includes it.
2. Mixed combined session still advances the non-excluded exercise.
3. A `noProg` entry never becomes the deload / stall baseline —
   `[60 hit, 60 hit, {noProg 30}]` → next is 62.5, not a reset.
4. Legacy whole-workout `excludeFromProgression` still honoured (flag ⇒ all entries skipped).
5. Entire history `noProg` ⇒ `sessionsFor → []`, `nextPrescription → { kind: 'first' }`.
6. `entryExcluded(w, entry)` truth table — `{},{}`→false; `{excludeFromProgression:true},{}`→true;
   `{},{noProg:true}`→true; both→true.
7. `stallCount` across a `noProg` gap — three real misses at one weight still streak to a
   deload; the gap does not reset.

### `history.test.js`

8. `lastEntryFor` skips a `noProg` entry, returns the prior counting session.
9. `lastEntryFor` skips a legacy `excludeFromProgression` workout (behaviour moved in from
   the retired `regular` wrapper — assert the wrapper is gone).
10. `buildSets` seeds opening rows from the last *counting* session, not a later `noProg` one.
11. `buildSets` with only `noProg` history falls back to the routine `target`.
12. `freestyleConfig` ignores a `noProg` entry.
13. `bestWeightFor` **unchanged** — a heavy `noProg` set still counts toward "Best".
14. `effectiveRoutineIds`: bare-string `S.week[wd]` → `[string]`; multi-id array resolved and
    filtered to existing routines; `[]` / stray empty / key-absent → `[]`; a scalar
    `dayPlan` override → `[override]`; `'rest'` override → `[]`.
15. `effectiveRoutineId` / `effectiveRoutine` wrappers return `[0] ?? null`.
16. `nextTrainingDay` skips a day whose every routine is empty; returns a day where any
    routine has exercises; return shape carries `routines`.

### `finish-workout.test.js`

17. `routineIds` + `routineId = routineIds[0]` mirror on the built workout.
18. Per-entry `noProg` and `rid` carried onto the saved entry (currently dropped by the
    whitelist).
19. `w.excludeFromProgression` mirror written **iff** every completed entry is `noProg` —
    rehab-only combined session → present; rehab + strength → absent; all-normal → absent.

### `plan-share.test.js`

20. `mergePlan` remaps each element of an array `week[d]` through `ridMap`; an element whose
    id didn't survive parsing is dropped, not written as `undefined`.
21. `scheduledDays` counts a populated array day as 1; a `[]` / absent day as 0.
22. Populated `week` round-trips (build → parse → merge) with arrays intact; a legacy scalar
    bundle value is tolerated.

### Coach — `api/test/jobs.test.js` + frontend `coach.test.js`

23. Shared fixture with a combined day (`week: {1:['r1','r2']}`) — client `hashPlan` ===
    server `hashPlan`.
24. Legacy fixture: `week: {1:'r1'}` vs `week: {1:['r1']}` — identical fingerprint (upgrade
    stability).
25. `canonicalPlan` / `cleanPlan`: a `[]` day is omitted; order preserved
    (`['r2','r3']` ≠ `['r3','r2']`).
26. `CHANGE_APPLY.week`: `after:'r3'` onto `['r1','r2']` → `['r3']`; `after:null` deletes the
    key.
27. `markStale`: `before:['r1','r2']`, live `['r1','r2']` → not stale; live
    `['r1','r2','r4']` → stale.
28. `changeValues`: `before:['r1','r2']` renders as `"Rehab + Core"`, not `"2"`.

### Component

29. `views/Plan.test.jsx` — inline sub-rows render per day; ＋ Add routine appends;
    ✕ removes and `delete`s the key on the last removal.
30. `views/Workout.test.jsx` — ⋮ → Add routine appends entries with `rid`, updates
    `routineIds` and `name`, toasts; already-added / empty routines disabled. Layout nested
    sheet still switches Cards / List / Compact.
31. `views/Workout.test.jsx` — `WorkoutDetail` groups entries into per-routine sections with
    sets/volume subheaders; a legacy single-routine workout renders with no subheader.
32. `views/Home.test.jsx` — Today card shows the derived name and the first routine's glyph
    for a combined day; one-tap Start passes the full id list.

### Test fixtures to migrate (scalar `week` / `routineId` → new shape)

`lib/history.test.js`, `lib/mobile.test.js`, `lib/finish-workout.test.js`,
`lib/starter.test.js`, `lib/coach.test.js`, `lib/coach-local.test.js`,
`sheets.starter.test.jsx`, `sheets.swap.test.jsx`, `views/Workout.test.jsx`,
`views/Workout.remove.test.jsx`, `views/week-start.test.jsx`, `views/CoachChat.test.jsx`,
`store/useStore.restore.test.jsx`, `lib/notes-render.test.jsx`. (`lib/plan-share.test.js`
only has `week: {}` fixtures today — it won't break, but it's the natural home for the new
plan-share coverage above.)
