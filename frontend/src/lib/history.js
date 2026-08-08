// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { todayISO, isoOf, weekKey, fmtNum } from './format.js'
import { isCardio, isBodyweightEq } from './exercises.js'
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
  // Bodyweight reads as what you did — "12", or "+10 × 12" once there is a belt involved —
  // rather than "0×12", which says a set was performed with no weight and means nothing.
  // A per-side set needs no mark here: the number logged is the total, the same as every
  // other set in the app.
  const reps = s.r || 0
  if (isBw({ ...c, id: c.id ?? id })) {
    const load = s.w > 0 ? `+${fmtNum(s.w)} × ` : ''
    return `${load}${reps}` + effortTail(s)
  }
  return `${fmtNum(s.w || 0)}×${reps}` + effortTail(s)
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

export function lastEntryFor(S, exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const en = S.workouts[i].entries.find(e => e.id === exId)
    // `target` is what the session prescribed; finished workouts carry it so labels and the
    // progression engine can read a session back the way it was logged. Older workouts have
    // none — modeOf() falls back to the body part for them, which is what they were.
    if (en && en.sets.some(s => s.done)) return { d: S.workouts[i].d, sets: en.sets.filter(s => s.done), target: en.target || null }
  }
  return null
}

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
    if (e.id === exId) {
      e.sets.forEach(s => { if (s.done && s.w > best) best = s.w })
      if (e.topW && e.topW > best) best = e.topW
    }
  }))
  return best
}
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return null
  if (ov && S.routines.some(r => r.id === ov)) return ov
  const wd = new Date(iso + 'T12:00:00').getDay()
  return S.week[wd] || null
}
export function effectiveRoutine(S, iso) {
  const id = effectiveRoutineId(S, iso)
  return id ? S.routines.find(r => r.id === id) || null : null
}
export function buildSets(S, cfg, options = {}) {
  const last = lastEntryFor(S, cfg.id)
  const n = Math.max(1, cfg.sets || 1)
  const mode = modeOf(cfg)
  const preferLast = !!options.preferLast
  const sets = []
  // Last time's set at the same position, falling back to its final set when the plan grew.
  const prevAt = i => (last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null)

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
    const w = preferLast && usable ? usable.w : (conf && conf.w > 0 ? conf.w : (usable ? usable.w : cfg.weight))
    sets.push({ w, r: usable ? usable.r : cfg.reps, done: false })
  }
  return sets
}
export function workoutVolume(w) {
  let v = 0
  // No special case for unilateral work: a per-side set logs its total, so both sides are
  // already in the rep count that arrives here.
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) v += (s.w || 0) * (s.r || 0) }))
  return v
}
export function setsDone(w) {
  let n = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
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
export function unitOf(units, idx) { return units.find(u => u.includes(idx)) || [idx] }

export function streakWeeks(S) {
  if (!S.workouts.length) return 0
  const weeks = new Set(S.workouts.map(w => weekKey(w.d)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur))
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
  const warm = !!rows[from]?.warmup
  const next = rows.slice()
  for (let j = from + 1; j < next.length; j++) {
    if (!!next[j].warmup === warm && !next[j].done) {
      if (value == null) delete next[j].w
      else next[j].w = value
    }
  }
  return next
}

/** Insert a warm-up row before the first work row, copying the preceding warm-up's values. */
export function insertWarmupRow(rows, mode, target) {
  const firstWork = rows.findIndex(x => !x.warmup)
  const at = firstWork === -1 ? rows.length : firstWork
  const l = rows[at - 1] || rows[rows.length - 1]
  const warm = mode === 'cardio'
    ? { min: l ? l.min : (target.min || 20), speed: l ? l.speed : (target.speed || 8), done: false, warmup: true }
    : mode === 'time'
      ? { sec: l ? l.sec : (target.sec || 45), w: l ? (l.w || 0) : (target.weight || 0), done: false, warmup: true }
      : { w: l ? l.w : 0, r: l ? l.r : target.reps, done: false, warmup: true }
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
    (n, e) => n + (e.sets || []).filter(s => s.done && !s.warmup).length, 0,
  )
}
