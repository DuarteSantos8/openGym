// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { todayISO, isoOf, weekKey, weekStartOf, fmtNum } from './format.js'
import { isCardio, isBodyweightEq } from './exercises.js'
import { phaseForSet, modeForSet, modeForEntry, isWarmupRow, normalizeMode, extraVolumeOf, nextDropWeight, splitBurstReps, makeSideSet, isSideSet, syncSideAggregate } from './workout-model.js'
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
// Completed-state-independent work rows whose authoritative mode matches the requested mode.
const workRowsForMode = (entry = {}, mode = 'reps') => {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const expectedMode = normalizeMode(mode, 'reps')
  return (Array.isArray(source.sets) ? source.sets : [])
    .filter(set => phaseForSet(set) === 'work' && modeForSet(set, target) === expectedMode)
}
// i18n-core, not i18n: this file is imported by mcp/, which is plain Node with no Vite and no
// React. i18n.js is the Vite half — import.meta.glob over the locale packs, useSyncExternalStore
// for the hook — and it re-exports this very `t` from core, so nothing changes here except what
// gets dragged along behind it.
import { t } from './i18n-core.js'

// How an exercise is logged (issue #16). This used to be derived from the body part alone,
// which meant a plank or a farmer's carry could only be timed by filing it under cardio.
// A routine entry can now say so explicitly:
//   reps   — weight × reps      sets look like { w, r }
//   time   — a work duration    sets look like { sec, w }   (w = 0 for bodyweight)
//   cardio — duration + speed   sets look like { min, speed }
// An entry without `mode` behaves exactly as before, so every existing plan, workout and
// plan file is read unchanged and nothing needs migrating.
export function modeOf(cfg) {
  const m = cfg && cfg.mode
  if (m === 'reps' || m === 'time' || m === 'cardio') return m
  return isCardio(cfg && cfg.id) ? 'cardio' : 'reps'
}
export const isTimed = cfg => modeOf(cfg) === 'time'

// Two flags that ride on top of a mode rather than making new ones (issues #31/#32), because
// "bodyweight" and "per side" are true of a rep set and of a timed hold alike:
//   bodyweight — the exercise carries no load of its own, so `w` means *added* weight and is
//                asked for only once you say there is some. Seeded from the equipment field.
//                Spelled out rather than `bw`, which a workout already uses for the weigh-in
//                it was logged at — two different things one letter apart is a bug waiting.
//   side       — the exercise is unilateral. You still log what you did: 16, the total across
//                both sides. The split is derived for planning ("8 per side"), never entered
//                — a number that sometimes means one side and sometimes both is the thing
//                that made this ambiguous in the first place, and one rep count that always
//                means the same thing beats two that need a legend.
// Both are absent on every plan, workout and backup written before they existed, and absent
// reads as false, so nothing needs migrating.
export const isBw = cfg => (cfg && cfg.bodyweight != null ? !!cfg.bodyweight : isBodyweightEq(cfg && cfg.id))
export const isPerSide = cfg => !!(cfg && cfg.side)
// What one side did, for display only. Half of an odd total is shown as it falls (8.5) rather
// than rounded away: it means the sides were not even, which is worth seeing.
export const sideReps = reps => (reps || 0) / 2
// Unilateral work moves in pairs, so its rep target steps by two — 16, 18, 20 — and a total
// that stayed odd would put a rep on one side and not the other.
export const repStep = cfg => (isPerSide(cfg) ? 2 : 1)

// mm:ss for a work duration — seconds alone read badly past a minute ("90 s" vs "1:30").
export function fmtSec(sec) {
  const n = Math.max(0, Math.round(Number(sec) || 0))
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

// How hard a set felt, if the profile logs it at all. Two scales for the same thing, kept in
// their own fields: RIR counts the reps still in the tank, RPE reads the same effort off a
// 10-point scale from the top (RPE 8 ≈ RIR 2). A set logged on one scale is never silently
// rewritten as the other — switching the setting changes what new sets ask for, nothing else.
// `min`..`max` is the range the stepper walks. RIR bottoms out at 0 (a set taken to failure);
// RPE bottoms out at 6, since the scale is only meaningful for working sets and anything
// lighter is a warm-up nobody rates.
export const EFFORT = {
  rir: { f: 'rir', hd: 'RIR', step: 0.5, min: 0, max: 10 },
  rpe: { f: 'rpe', hd: 'RPE', step: 0.5, min: 6, max: 10 }
}
// One tap of an effort stepper. Empty is not 0 — an unlogged effort must not become "went to
// failure" from one stray tap — so − on an empty cell leaves it empty, and + starts at the
// bottom of the scale and walks up from there in even steps. Stepping back off the bottom
// clears the cell again, so a mistap is undoable. null means "nothing logged"; the caller
// stores that by dropping the key rather than writing a null.
export function stepEffort(kind, cur, dir) {
  const e = EFFORT[kind]
  if (!e) return cur ?? null
  if (cur == null) return dir < 0 ? null : e.min
  const n = Math.round((cur + dir * e.step) * 100) / 100
  if (dir < 0 && n < e.min) return null
  // only the ceiling is enforced on the way up: a value typed below the floor (nothing stops
  // someone entering RPE 3) still steps in even increments instead of snapping to the floor.
  return dir > 0 ? Math.min(e.max, n) : Math.max(e.min, n)
}
// A typed effort is capped but not floored — clamping up while someone types "10" would turn
// the first keystroke into the floor and fight the input.
export const capEffort = (kind, v) =>
  (v == null || !EFFORT[kind] ? v : Math.min(EFFORT[kind].max, v))
// Which scale a profile logs. `showRir` is the boolean this replaced and is only consulted
// when the profile has no answer of its own — an explicit 'none' has to win over it, or a
// backup or another device that still carries the old flag would switch the column back on.
export const effortOf = S => {
  const e = S && S.effort
  return e === 'none' || EFFORT[e] ? e : (S && S.showRir ? 'rir' : 'none')
}
// The "(RIR 2)" / "(RPE 8)" tail on a set summary, empty when nothing was logged.
const effortTail = s => {
  const k = s.rir != null ? 'rir' : s.rpe != null ? 'rpe' : null
  return k ? ` (${EFFORT[k].hd} ${fmtNum(s[k])})` : ''
}

// One-line summary of a logged set. `cfg` carries the mode when the caller has it (a routine
// entry or a workout entry); passing an id alone keeps the old body-part behaviour.
export function setLabel(id, s, cfg) {
  const c = cfg || { id }
  const mode = modeOf(c)
  if (mode === 'cardio') return `${s.min || 0} min @ ${fmtNum(s.speed || 0)} km/h`
  if (mode === 'time') return fmtSec(s.sec) + (s.w > 0 ? ` · ${fmtNum(s.w)}` : '')
  const bw = isBw({ ...c, id: c.id ?? id })
  // One side's "weight×reps" (or bodyweight "reps" / "+belt × reps"), the same shape a whole
  // straight set reads as — reused for each side of a unilateral set below.
  const oneSide = side => {
    const reps = side.r || 0
    return bw ? (side.w > 0 ? `+${fmtNum(side.w)} × ` : '') + reps : `${fmtNum(side.w || 0)}×${reps}`
  }
  // A unilateral set logged per side (issue #60) reads "L 15×8 · R 15×7" — the asymmetry is the
  // whole point, so both sides are shown rather than a single combined total.
  if (isSideSet(s)) {
    return `${t('L')} ${oneSide(s.sides.L)}${effortTail(s.sides.L)} · ${t('R')} ${oneSide(s.sides.R)}${effortTail(s.sides.R)}`
  }
  // Bodyweight reads as what you did — "12", or "+10 × 12" once there is a belt involved —
  // rather than "0×12", which says a set was performed with no weight and means nothing.
  return oneSide(s) + effortTail(s)
}
// Default config for a freshly added exercise.
export function defaultConfig(id, mode) {
  const m = mode || modeOf({ id })
  if (m === 'cardio') return { sets: 1, min: 20, speed: 8 }
  // Written only when it is true, so a barbell config is byte-for-byte what it was before
  // the flag existed and a plan file gains nothing it does not need.
  const bw = isBodyweightEq(id) ? { bodyweight: true } : {}
  if (m === 'time') return { sets: 3, sec: 45, weight: 0, mode: 'time', ...bw }
  return { sets: 3, reps: 10, weight: 0, mode: 'reps', ...bw }
}
// One-line summary of a planned exercise ("3 × 10 · 60 kg"), shared by the routine editor
// and the plan export so a mode is described the same way everywhere.
export function exLine(cfg, unit) {
  const mode = modeOf(cfg)
  const n = cfg.sets || 1
  // Added weight reads as added: "+10 kg" on a dip belt, "60 kg" on a barbell.
  const load = cfg.weight ? ' · ' + (isBw(cfg) ? '+' : '') + fmtNum(cfg.weight) + ' ' + unit : ''
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min @ ${fmtNum(cfg.speed || 8)} km/h`
  if (mode === 'time') return `${n} × ${fmtSec(cfg.sec || 45)}${load}`
  // This is the line with room for it, so the split is spelled out: "3 × 16 · 8/side".
  const split = isPerSide(cfg) ? ' · ' + t('{0}/side', fmtNum(sideReps(cfg.reps))) : ''
  return `${n} × ${cfg.reps}${load}${split}`
}

// Drop superset ids that no longer have an adjacent partner (after unlink/reorder/remove).
export function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
  })
}

// Return the contiguous run around an entry that shares its superset id. A repeated id in a
// separated part of the list is deliberately not included: the display semantics are adjacent
// entries sharing one id, not every entry that happens to carry that id.
function contiguousSgGroup(items, idx) {
  const sg = items[idx]?.sg
  if (!sg) return [idx]
  let first = idx
  let last = idx
  while (first > 0 && items[first - 1]?.sg === sg) first--
  while (last + 1 < items.length && items[last + 1]?.sg === sg) last++
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}

function freshSg(items, first, second) {
  const base = `sg-${Math.min(first, second)}-${Math.max(first, second)}`
  let sg = base
  let n = 2
  while (items.some(e => e.sg === sg)) sg = `${base}-${n++}`
  return sg
}

// Purely pair two adjacent entries. Existing contiguous groups on either side are merged, so
// pairing the end of one group with the start of another produces one display unit. A caller can
// provide a group id (useful when restoring a known id); otherwise an existing id is preferred,
// with a deterministic unused id for two previously ungrouped entries.
export function pairAdjacent(items, first, second, groupId) {
  if (!Array.isArray(items)) throw new TypeError('Superset entries must be an array')
  if (!Number.isInteger(first) || !Number.isInteger(second) || !items[first] || !items[second]) {
    throw new RangeError('Superset entry indexes are invalid')
  }
  if (Math.abs(first - second) !== 1) throw new RangeError('Superset entries must be adjacent')

  const next = items.map(e => ({ ...e }))
  const left = Math.min(first, second)
  const right = Math.max(first, second)
  const group = groupId || next[left].sg || next[right].sg || freshSg(next, left, right)
  const members = new Set([...contiguousSgGroup(next, left), ...contiguousSgGroup(next, right)])
  members.forEach(i => { next[i].sg = group })
  return next
}

// Remove one entry from its superset and clean any ids that no longer have an adjacent partner.
// This is pure so the active workout can replace its entries atomically through the store.
export function unpairSuperset(items, idx) {
  if (!Array.isArray(items)) throw new TypeError('Superset entries must be an array')
  if (!Number.isInteger(idx) || !items[idx]) throw new RangeError('Superset entry index is invalid')
  const next = items.map(e => ({ ...e }))
  delete next[idx].sg
  next.forEach((e, i) => {
    if (e.sg && !(next[i - 1]?.sg === e.sg || next[i + 1]?.sg === e.sg)) delete e.sg
  })
  return next
}

/**
 * Is this completed entry excluded from progression / session read-back?
 *
 * "Excluded" moved from a whole-workout flag to a per-entry one (ENG-11): a rehab routine
 * combined with real work excludes only its own exercises. A legacy workout carries the
 * whole-workout flag and no per-entry field, so every one of its entries reads as excluded.
 * `noProg` is frozen onto the entry from its source routine's `excludeFromProgression` at
 * build time — editing the routine flag later never rewrites a saved session.
 */
export function entryExcluded(w, entry) {
  return w?.excludeFromProgression === true || entry?.noProg === true
}

export function lastEntryFor(S, exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const w = S.workouts[i]
    const en = w.entries.find(e => e.id === exId)
    if (!en) continue
    // A session that does not count — a planned deload, or a rehab block merged into a real
    // session — is not "last time" for the next regular prescription: its reps and durations
    // must not seed the rows any more than its weight seeds the progression.
    if (entryExcluded(w, en)) continue
    // Work sets only. Every caller asks the same question — "what did you actually lift last
    // time" — to seed the next session's rows, to size a freestyle config, and to print "Last
    // time" on the card. A warm-up answers none of them: seeding position 0 from a 50% ramp row
    // walks the working weight DOWN a little every session, and counting the ramp rows makes a
    // 3x5 come back as a 5-set exercise. Warm-ups are already excluded from volume, records and
    // progression; this is the same rule one level up.
    const done = en.sets.filter(s => s.done && !isWarmupRow(s))
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    if (done.length) return { d: w.d, sets: done, target: en.target || null }
  }
  return null
}

/** How long any single note may get. Long enough for a paragraph, short enough to stay a note. */
export const NOTE_MAX = 500

/**
 * The most recent session note the user pinned for this exercise, or null.
 *
 * A note written mid-session is about that session — "shoulder twinged today". Some of them are
 * about the NEXT one instead: "go a notch narrower". The pin is how the user says which, at the
 * moment of writing, when they are the only one who knows. Pinned notes surface again the next
 * time the exercise comes up; unpinned ones stay in that day's history.
 *
 * Only the newest pinned note is returned: a pin is a message to your next self, and a stack of
 * them from six sessions ago is noise, not context.
 */
export function pinnedNoteFor(S, exId) {
  const workouts = S?.workouts || []
  for (let i = workouts.length - 1; i >= 0; i--) {
    const en = (workouts[i].entries || []).find(e => e.id === exId)
    const note = (en?.note || '').trim()
    if (note && en.notePin) return { note, d: workouts[i].d }
  }
  return null
}

/** The standing note for an exercise — the one that is true every session. */
export const exNoteFor = (S, exId) => ((S?.exNotes || {})[exId] || '').trim() || null

// A freestyle exercise starts with the last target the user actually trained, rather than the
// generic config sheet defaults used when there is no history. The set rows themselves are still
// built by buildSets(), which copies each completed set by position; only the target shape and
// number of rows need to be seeded here so the config sheet and the rows agree.
export function freestyleConfig(S, cfg) {
  const last = lastEntryFor(S, cfg.id)
  if (!last) return { ...cfg }
  return {
    ...cfg,
    ...(last.target || {}),
    id: cfg.id,
    sets: Math.max(1, last.sets.length)
  }
}
export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => w.entries.forEach(e => {
    if (e.id === exId) best = Math.max(best, bestWeightForEntry(e))
  }))
  return best
}
/**
 * The routines planned for a date, in merge order. Plural is the primary form now that a
 * weekday can hold several routines (`S.week[wd]` is `string[]`); the singular helpers below
 * are thin wrappers. `[]` — a stray empty array, or a key that is absent — all mean rest, so
 * "is this a rest day?" is `effectiveRoutineIds(S, iso).length === 0`.
 *
 * `S.dayPlan[iso]` stays scalar (a routine id, the `'rest'` sentinel, or undefined): the
 * per-date override and Start-time are single-pick. All array-tolerance is on `S.week`.
 */
export function effectiveRoutineIds(S, iso) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return []
  if (ov && S.routines.some(r => r.id === ov)) return [ov]
  const wd = new Date(iso + 'T12:00:00').getDay()
  return [].concat(S.week[wd] || []).filter(id => S.routines.some(r => r.id === id))
}
export function effectiveRoutines(S, iso) {
  return effectiveRoutineIds(S, iso).map(id => S.routines.find(r => r.id === id)).filter(Boolean)
}
export const effectiveRoutineId = (S, iso) => effectiveRoutineIds(S, iso)[0] ?? null
export const effectiveRoutine = (S, iso) => effectiveRoutines(S, iso)[0] ?? null

/**
 * The next day that actually has something to train, looking forward from `iso` (exclusive).
 *
 * Takes a date string rather than reading the clock so callers and tests agree on "today".
 * A routine with no exercises does not count: starting one lands you in an empty session, so
 * it is not an answer to "what is next" (the same guard TabBar applies before starting). On a
 * combined day, any one routine with exercises makes the day trainable.
 * Returns null when the whole week is rest.
 *
 * Return shape carries `routines` (the whole day) plus `routine` = `routines[0]` for the
 * "what's next" label.
 */
export function nextTrainingDay(S, iso) {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(iso + 'T12:00:00')
    d.setDate(d.getDate() + i)
    const nextIso = isoOf(d)
    const routines = effectiveRoutines(S, nextIso)
    if (routines.some(r => (r.ex || []).length)) {
      return { iso: nextIso, weekday: d.getDay(), routines, routine: routines[0] }
    }
  }
  return null
}
/**
 * Build the rows a planned exercise starts a session with: its work sets, preceded by however
 * many warm-up sets the routine asks for (`cfg.warmupSets`, 0 by default so an existing plan
 * behaves exactly as before).
 *
 * The warm-ups are stacked with insertWarmupRow, one call each, so the ramp is the same one
 * the in-session "Add warm-up set" button produces: each row halves the gap left to the work
 * weight, giving 50% / 75% / 87.5% for three. `options.step` is the exercise's loading step,
 * passed in by the caller (see insertWarmupRow for why this module cannot read it itself).
 */
export function buildSets(S, cfg, options = {}) {
  const rows = buildWorkSets(S, cfg, options)
  const warm = Math.max(0, Math.min(MAX_PLANNED_WARMUPS, Math.round(cfg.warmupSets) || 0))
  if (!warm) return rows
  const mode = modeOf(cfg)
  let out = rows
  for (let i = 0; i < warm; i++) out = insertWarmupRow(out, mode, cfg, options.step)
  return out
}

/** Beyond this a "warm-up" is its own workout; the config stepper stops here too. */
export const MAX_PLANNED_WARMUPS = 5

function buildWorkSets(S, cfg, options = {}) {
  const preferLast = !!options.preferLast
  const useTarget = !!options.useTarget
  // `lastEntryFor` now skips any entry that does not count — a planned deload, or a rehab
  // block merged into a real session (entryExcluded) — so the rows seed from the last
  // *counting* session without this function pre-filtering the history itself.
  const last = lastEntryFor(S, cfg.id)
  const n = Math.max(1, cfg.sets || 1)
  const mode = modeOf(cfg)
  const sets = []
  // A deload routine must use its own prescription instead of carrying regular-session values
  // into the workout. Other planned sessions keep the existing history-first behaviour.
  const prevAt = i => (!useTarget && last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null)

  if (mode === 'cardio') {
    for (let i = 0; i < n; i++) {
      const prev = prevAt(i)
      sets.push({ min: prev ? prev.min : (cfg.min || 20), speed: prev ? prev.speed : (cfg.speed || 8), done: false })
    }
    return sets
  }
  if (mode === 'time') {
    for (let i = 0; i < n; i++) {
      // Only carry a previous value over when it came from a timed set — switching an
      // exercise from reps to time must not seed the duration from a rep count.
      const prev = prevAt(i)
      const carried = prev && prev.sec > 0 ? prev : null
      sets.push({ sec: carried ? carried.sec : (cfg.sec || 45), w: carried ? (carried.w || 0) : (cfg.weight || 0), done: false })
    }
    return sets
  }
  const conf = S.exWeights[cfg.id]
  for (let i = 0; i < n; i++) {
    const prev = prevAt(i)
    const usable = prev && prev.r > 0 ? prev : null
    // Planned sessions may use the confirmed working weight, while freestyle should reproduce
    // the load of each matching set when that option is requested.
    // A deload uses the routine's target weight; a routine that never set one (weight 0) falls
    // back to the last regular load rather than prescribing an empty bar.
    const lastRegular = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null
    const w = useTarget
      ? (cfg.weight > 0 ? cfg.weight : (lastRegular && lastRegular.r > 0 ? lastRegular.w : cfg.weight))
      : preferLast && usable ? usable.w : (conf && conf.w > 0 ? conf.w : (usable ? usable.w : cfg.weight))
    const row = { w, r: usable ? usable.r : cfg.reps, done: false }
    // A unilateral exercise logs each side on its own (issue #60): the row splits into L/R,
    // each seeded with half the total reps at the same weight. When "last time" was itself a
    // per-side set, carry its two sides over verbatim so an asymmetry you logged persists.
    if (isPerSide(cfg)) sets.push(usable && isSideSet(usable) ? seedSideFromLast(row, usable) : makeSideSet(row))
    else sets.push(row)
  }
  return sets
}

// Seed a fresh per-side row from a previous per-side set: same reps/weight each side, nothing
// done, no effort carried (that is logged afresh each session). Falls back to an even split if
// the previous row was not actually per-side.
function seedSideFromLast(row, prev) {
  const base = makeSideSet(row)
  if (!isSideSet(prev)) return base
  const carry = s => ({ w: Number(s?.w) || 0, r: Number(s?.r) || 0, done: false })
  return syncSideAggregate({ ...base, sides: { L: carry(prev.sides.L), R: carry(prev.sides.R) } })
}

/**
 * Stamp every work row with the exercise's planned intensifier and pre-fill its drops/clusters,
 * already computed and editable — the plan designs the set, not a button pressed mid-workout.
 *
 * Must run AFTER applyPrescription: a drop-set's chain of drops is a percentage of each row's
 * own `w`, so it has to be computed from the final prescribed weight, not the pre-progression
 * one buildSets started from — otherwise a bumped working weight would leave stale, cheaper
 * drops sitting underneath it.
 */
export function applyIntensifierPlan(sets, cfg) {
  const kind = cfg && cfg.intensifier && cfg.intensifier.type
  if (kind !== 'dropset' && kind !== 'restpause') return sets
  if (kind === 'dropset') {
    const count = Math.max(1, Math.round(cfg.intensifier.count) || 1)
    const pct = cfg.intensifier.pct
    // Stamp a descending chain of drops onto a row (or one side of a per-side row): each drop is
    // pct% lighter than the last, at that row/side's own rep count.
    const withDrops = row => {
      const drops = []
      let w = row.w || 0
      for (let k = 0; k < count; k++) { w = nextDropWeight(w, pct); drops.push({ w, r: row.r }) }
      return { ...row, type: 'dropset', drops }
    }
    return sets.map(s => {
      if (isWarmupRow(s)) return s
      // A unilateral set drops per side (issue #60): stamp each side, then resync the aggregate.
      if (isSideSet(s)) return syncSideAggregate({ ...s, sides: { L: withDrops(s.sides.L), R: withDrops(s.sides.R) } })
      return withDrops(s)
    })
  }
  // Rest-pause trains as exactly two sets, not one per configured `sets` count: a warm-up at
  // the exercise's own configured reps, then a single rest-pause work set. Doing the full
  // activation+bursts protocol several times over isn't how rest-pause is actually trained, so
  // planning it replaces whatever buildSets built rather than stamping each of those rows.
  // The work row's own reps are the total — not "the total minus what the bursts carry" — and
  // the bursts are the full breakdown of that same total, down to the last one. See
  // extraVolumeOf/setTonnage: a rest-pause row's `clusters` are read-only display of how `r`
  // breaks down, not extra volume on top of it, precisely so this doesn't double-count.
  const restSec = Math.max(5, cfg.intensifier.restSec || 15)
  const totalReps = Math.max(1, Math.round(cfg.intensifier.totalReps) || 1)
  const w = (sets.find(s => !isWarmupRow(s)) || sets[0] || {}).w || 0
  const warmup = { w, r: Math.max(1, Math.round(cfg.reps) || 1), done: false, phase: 'warmup' }
  const work = { w, r: totalReps, done: false, type: 'restpause', clusters: splitBurstReps(totalReps).map(r => ({ r, restSec })) }
  return [warmup, work]
}
export function workoutVolume(w) {
  let v = 0
  // No special case for unilateral work: a per-side set logs its total, so both sides are
  // already in the rep count that arrives here. Drop-set drops and rest-pause bursts add their
  // own weight x reps on top of the row's main/activation set (see extraVolumeOf).
  // Warm-ups are excluded here as everywhere else. The config sheet promises it in so many
  // words ("left out of volume, records and progression") and every other consumer already
  // does it; this line was the one that did not, which only stopped being harmless when a
  // routine started planning warm-ups by default. The number is written into the saved
  // workout, so an inflated one would stay wrong forever.
  w.entries.forEach(e => e.sets.forEach(s => {
    if (s.done && !isWarmupRow(s)) v += (s.w || 0) * (s.r || 0) + extraVolumeOf(s)
  }))
  return v
}
// A unilateral row counts as two toward the "x / y sets" progress — one per side — since each
// side is logged and ticked on its own (issue #60). Every other row counts as one.
export const setUnits = s => (isSideSet(s) ? 2 : 1)
// How many of a row's units are done: both sides independently for a per-side row, else 0/1.
export const doneUnits = s => (isSideSet(s) ? (s.sides.L.done ? 1 : 0) + (s.sides.R.done ? 1 : 0) : (s.done ? 1 : 0))
// Total completion-units across a session's rows (both sides of every unilateral set counted).
export const setUnitsTotal = entries => (entries || []).reduce((n, e) => n + (e.sets || []).reduce((m, s) => m + setUnits(s), 0), 0)

export function setsDone(w) {
  let n = 0
  w.entries.forEach(e => e.sets.forEach(s => { n += doneUnits(s) }))
  return n
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { n += doneUnits(s) }))
  return n
}
export const lastBW = S => (S.bodyweight.length ? S.bodyweight[S.bodyweight.length - 1] : null)

// Group consecutive items sharing a superset id (sg) into "units" of indices.
// items may be routine exercises ({sg}) or active-workout entries ({sg}).
export function supersetUnits(items) {
  const units = []
  items.forEach((e, i) => {
    const prev = items[i - 1]
    if (i > 0 && e.sg && prev && prev.sg && e.sg === prev.sg) units[units.length - 1].push(i)
    else units.push([i])
  })
  return units
}

// Move the selected occurrence's complete display unit by one neighbouring unit. Returning a
// new array keeps this helper pure; the caller decides how to persist it. Index identity matters
// here because the same exercise id may appear more than once with different setup.
export function moveSupersetUnit(items, index, direction) {
  if (!Array.isArray(items) || (direction !== -1 && direction !== 1)) return null
  const units = supersetUnits(items)
  const source = units.findIndex(unit => unit.includes(index))
  const target = source + direction
  if (source < 0 || target < 0 || target >= units.length) return null
  const reordered = [...units]
  const selected = reordered[source]
  reordered[source] = reordered[target]
  reordered[target] = selected
  return reordered.flat().map(i => items[i])
}
export function unitOf(units, idx) { return units.find(u => u.includes(idx)) || [idx] }

export function streakWeeks(S) {
  if (!S.workouts.length) return 0
  const ws = weekStartOf(S)
  const weeks = new Set(S.workouts.map(w => weekKey(w.d, ws)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur), ws)
    if (weeks.has(wk)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}

/**
 * Cascade a weight change forward: following sets of the same warm-up flag that are still
 * undone take the new value (null deletes the key). Done sets are never rewritten.
 */
export function cascadeWeight(rows, from, value) {
  const warm = isWarmupRow(rows[from])
  const next = rows.slice()
  for (let j = from + 1; j < next.length; j++) {
    if (isWarmupRow(next[j]) === warm && !next[j].done) {
      if (value == null) delete next[j].w
      else next[j].w = value
    }
  }
  return next
}

/**
 * Insert a warm-up row at the end of the warm-up block, ramping toward the working weight.
 *
 * Each added row halves what is left between the last warm-up and the first work set, so the
 * first one lands at half the working weight, a second at three quarters, and so on — and a
 * row you edited by hand is what the next one ramps from. `step` is the exercise's own loading
 * step (progression.js's defaultIncrement, passed in by the caller so this module keeps no
 * dependency on progression — that one already imports from here): a warm-up you cannot
 * actually load onto the bar is noise.
 *
 * The reference is the first WORK row, never `rows[at - 1]` alone: for the first warm-up
 * `at` is 0, and reading `rows[-1]` used to fall through to the *last* row — the heaviest
 * work set — so "add warm-up set" handed you a full-weight set to correct by hand.
 */
/**
 * Recompute the warm-up block so it ramps toward the weight the work rows ACTUALLY carry.
 *
 * buildSets prepends the warm-ups before a prescription is applied, and applyPrescription
 * deliberately rewrites work rows only — so without this the ramp still aims at last
 * session's weight. On a deload that put the last warm-up above every work set, which is
 * the exact opposite of what a warm-up is for.
 *
 * A warm-up already logged keeps its weight and becomes what the next one ramps from: it
 * happened, and rewriting performed work is data loss. Entries with nothing to ramp toward
 * — cardio, bodyweight, an unloaded hold — are returned untouched.
 */
export function rerampWarmups(rows, step = 2.5) {
  const firstWork = rows.findIndex(x => !isWarmupRow(x))
  if (firstWork <= 0) return rows
  const target = rows[firstWork].w || 0
  if (!(target > 0)) return rows
  const out = rows.slice()
  let from = 0
  for (let i = 0; i < firstWork; i++) {
    if (out[i].done) { from = out[i].w || 0; continue }
    const w = target > from
      ? Math.max(0, Math.min(target, Math.floor((from + (target - from) / 2) / step) * step))
      : target
    out[i] = { ...out[i], w }
    from = w
  }
  return out
}

export function insertWarmupRow(rows, mode, target, step = 2.5) {
  const firstWork = rows.findIndex(x => !isWarmupRow(x))
  const at = firstWork === -1 ? rows.length : firstWork
  const prev = at > 0 ? rows[at - 1] : null            // the warm-up this one ramps from
  const work = firstWork === -1 ? null : rows[firstWork]
  const rampTo = to => {
    const from = prev ? (prev.w || 0) : 0
    // Nothing to ramp toward: bodyweight, cardio, a timed hold with no load.
    if (!(to > 0)) return 0
    // Already at or past the work weight — which happens when a warm-up was edited by hand
    // above it. Returning `from` here handed the next warm-up that same too-heavy number and
    // let it propagate down the block. A warm-up is never heavier than the set it warms up for.
    if (to <= from) return to
    // Rounded DOWN to the step: a warm-up that lands a notch light costs nothing, one that
    // lands a notch heavy is a set you have to strip plates off before you can use it.
    return Math.max(0, Math.min(to, Math.floor((from + (to - from) / 2) / step) * step))
  }
  const warm = mode === 'cardio'
    ? {
      min: prev ? prev.min : (work ? work.min : (target.min || 20)),
      speed: prev ? prev.speed : (work ? work.speed : (target.speed || 8)),
      done: false, phase: 'warmup', warmup: true,
    }
    : mode === 'time'
      ? {
        sec: prev ? prev.sec : (work ? work.sec : (target.sec || 45)),
        w: rampTo(work ? (work.w || 0) : (target.weight || 0)),
        done: false, phase: 'warmup', warmup: true,
      }
      : {
        w: rampTo(work ? (work.w || 0) : (target.weight || 0)),
        r: work ? work.r : (prev ? prev.r : target.reps),
        done: false, phase: 'warmup', warmup: true,
      }
  const next = rows.slice()
  next.splice(at, 0, warm)
  return next
}

/** Remove the row at `i`, never emptying the entry below one row. */
export function removeRowAt(rows, i) {
  if (rows.length <= 1) return rows.slice()
  const next = rows.slice()
  next.splice(i, 1)
  return next
}

/** Completed non-warm-up sets across a workout's entries. */
export function workSetsDone(w) {
  return (w?.entries || []).reduce(
    (n, e) => n + (e.sets || []).filter(s => s.done && !isWarmupRow(s)).length, 0,
  )
}

const METRIC_MODES = ['reps', 'time', 'cardio']
const completedRowsForMode = (entry, mode) => workRowsForMode(entry, mode).filter(s => s.done === true && !isWarmupRow(s))

export function metricRowsForEntry(entry, mode) {
  const requested = typeof mode === 'string' ? mode.trim().toLowerCase() : ''
  const resolved = METRIC_MODES.includes(requested) ? requested : metricModeForEntry(entry)
  return resolved ? completedRowsForMode(entry, resolved) : []
}

/** The authoritative metric for an entry; reps rows take precedence over timed/cardio rows. */

export function metricModeForEntry(entry, fallback = null) {
  for (const mode of METRIC_MODES) {
    if (completedRowsForMode(entry, mode).length) return mode
  }
  return modeForEntry(entry, fallback)
}

/** Best load from completed work rows, with a guarded reps-only legacy topW fallback. */

export function bestWeightForEntry(entry = {}) {
  const target = entry.target || entry
  const workRows = Array.isArray(entry.sets)
    ? entry.sets.filter(s => phaseForSet(s) === 'work')
    : []
  const repsRows = metricRowsForEntry(entry, 'reps')
  // Reps rows are the authoritative load metric for a mixed entry. Otherwise use every
  // completed work row (timed holds can carry an added load too).
  const completedRows = repsRows.length
    ? repsRows
    : workRows.filter(set => set?.done === true && !isWarmupRow(set))
  let best = 0
  let hasUsableWeight = false
  completedRows.forEach(set => {
    const weight = Number(set?.w)
    if (!Number.isFinite(weight)) return
    hasUsableWeight = true
    if (weight > best) best = weight
  })

  // A real completed row, including an explicit zero for an unloaded bodyweight set, always
  // wins. A manual topW is only useful for old records whose rows did not carry a usable load.
  if (hasUsableWeight) return best

  const parentMode = modeForSet({}, target)
  const hasNonRepsWorkRow = workRows.some(set => modeForSet(set, target) !== 'reps')
  const hasWarmupRow = Array.isArray(entry.sets) && entry.sets.some(isWarmupRow)
  const topWeight = Number(entry.topW)
  // topW predates phase-tagged warm-ups. It remains a fallback for legacy all-work records,
  // but cannot override resolved work rows once any warm-up marker exists.
  if (parentMode === 'reps' && !hasNonRepsWorkRow && !hasWarmupRow
    && Number.isFinite(topWeight) && topWeight > best) best = topWeight
  return best
}
