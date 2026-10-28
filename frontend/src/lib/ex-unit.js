// A weight unit per exercise (#657): lb dumbbells next to kg barbell plates in the same gym.
//
// Storage does not move. Every weight in state stays in the profile's unit (S.unit), so the
// workouts, the stats, the records, the sync, the API, the MCP server, the Coach and the CSV
// export read exactly the numbers they always read. An exercise can be pinned to the other unit
// (S.exUnit[id] = { unit, _ts }, a stamped map like S.dbLoad), and then it is shown and typed in
// that unit: its rows, steppers, plates, bars, dumbbell and stack lists, increments, warm-ups,
// "last time", records, history and chart. Totals that mix exercises stay in the profile unit.
//
// The conversion sits at the edge. `exView(S, id)` is the state as that exercise sees it: the
// unit swapped and the exercise's own weights converted exactly (lib/units.js convertExact, three
// places), everything else untouched. The helpers that build, progress and plate-load a lift take
// any state, so they run on the view unchanged and land on the pinned unit's grid (5 lb steps,
// the lb plate set). What comes out goes back through `stored*`, four places in the profile unit:
// 45 lb is stored as 20.4117 kg and shows 45 lb again. A number that was shown and not changed
// is kept as it was stored, so opening and saving never moves it by a rounding.
//
// An exercise that is not pinned, or pinned to the profile's own unit, gets the state itself back
// from every helper here: nothing changes for it. Older apps do not know the map and show the
// stored numbers in the profile unit, which is what they are.
import { convertExact, convertStep, exUnitPin, mapEntryWeights, mapSetWeights, mapTargetWeights, EXACT_STORE, EXACT_VIEW } from './units.js'

export { exUnitPin }

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
/** The profile's unit. */
export const profileUnit = S => (S?.unit === 'lb' ? 'lb' : 'kg')
/** The unit this exercise is shown and typed in: its pin, else the profile's. */
export const exUnitOf = (S, exId) => exUnitPin(S, exId) || profileUnit(S)
/** Whether this exercise reads its weights in a unit other than the profile's. */
export const exConverted = (S, exId) => exUnitOf(S, exId) !== profileUnit(S)

/**
 * S.exUnit with the exercise pinned to `unit`, or back on the profile's (null). The way back is a
 * stamped null rather than a deleted key, so it wins a sync against the other device's pin.
 */
export const withExUnit = (map, exId, unit, now = Date.now()) =>
  ({ ...(isMap(map) ? map : {}), [exId]: { unit: unit === 'kg' || unit === 'lb' ? unit : null, _ts: now } })

/** A stored weight (profile unit) as the exercise shows it. */
export function shownWeight(S, exId, w) {
  if (!exConverted(S, exId)) return w
  return convertExact(w, profileUnit(S), exUnitOf(S, exId), EXACT_VIEW)
}

// Back from the exercise's unit to the profile's. `old` is the stored number the shown one came
// from, when there is one: unchanged on screen, it is kept to the last place.
const backOf = (from, to) => (v, old) => {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return v
  if (old != null && Number.isFinite(Number(old)) && convertExact(old, to, from, EXACT_VIEW) === Number(v)) return old
  return convertExact(v, from, to, EXACT_STORE)
}
const backIncOf = (from, to) => (v, old) => {
  if (!(Number(v) > 0)) return v
  if (old != null && convertStep(old, to, from, EXACT_VIEW) === Number(v)) return old
  return convertStep(v, from, to, EXACT_STORE)
}

/** A weight typed or stepped in the exercise's unit, as it is stored (profile unit). */
export function storedWeight(S, exId, v, old) {
  if (!exConverted(S, exId)) return v
  return backOf(exUnitOf(S, exId), profileUnit(S))(v, old)
}

const viewFns = (S, exId) => {
  const from = profileUnit(S), to = exUnitOf(S, exId)
  return [v => convertExact(v, from, to, EXACT_VIEW), v => convertStep(v, from, to, EXACT_VIEW)]
}
const storeFns = (S, exId) => {
  const from = exUnitOf(S, exId), to = profileUnit(S)
  return [backOf(from, to), backIncOf(from, to)]
}

/** An exercise's config (a routine slot, a session target) in the exercise's unit. */
export function viewTarget(S, exId, cfg) {
  if (!cfg || !exConverted(S, exId)) return cfg
  const [c, inc] = viewFns(S, exId)
  return mapTargetWeights(cfg, c, null, inc)
}
/** A config edited in the exercise's unit, back in the profile's. `prev` is the stored one it was opened from. */
export function storedTarget(S, exId, cfg, prev) {
  if (!cfg || !exConverted(S, exId)) return cfg
  const [c, inc] = storeFns(S, exId)
  return mapTargetWeights(cfg, c, prev, inc)
}
/** One set row (with its sides and drops) in the exercise's unit. */
export function viewRow(S, exId, row) {
  if (!row || !exConverted(S, exId)) return row
  return mapSetWeights(row, viewFns(S, exId)[0])
}
// Every stored weight of `prev` by the number it shows: a value shown and not changed is found
// again even when its row moved (a set added above it, a warm-up inserted), and keeps its stored
// value to the last place.
const knownOf = (S, exId, prev, walk) => {
  const known = new Map()
  if (!prev) return known
  const [view] = viewFns(S, exId)
  walk(prev, x => { if (x != null && Number.isFinite(Number(x))) known.set(view(x), x); return x })
  return known
}
const backKnown = (back, known) => (v, old) => {
  const kept = back(v, old)
  if (old != null && kept === old) return kept
  return known.has(Number(v)) ? known.get(Number(v)) : kept
}

/** A row changed in the exercise's unit, back in the profile's; `prev` is the stored row. */
export function storedRow(S, exId, row, prev) {
  if (!row || !exConverted(S, exId)) return row
  const known = knownOf(S, exId, prev, (r, c) => mapSetWeights(r, c))
  return mapSetWeights(row, backKnown(storeFns(S, exId)[0], known), prev)
}
/** A session entry in the exercise's unit. */
export function viewEntry(S, entry) {
  if (!entry || !exConverted(S, entry.id)) return entry
  const [c, inc] = viewFns(S, entry.id)
  return mapEntryWeights(entry, c, null, inc)
}
/** An entry built or changed in the exercise's unit, back in the profile's; `prev` is the stored one, if any. */
export function storedEntry(S, entry, prev) {
  if (!entry || !exConverted(S, entry.id)) return entry
  const [c, inc] = storeFns(S, entry.id)
  const known = knownOf(S, entry.id, prev, (e, k) => mapEntryWeights(e, k, null, x => x))
  return mapEntryWeights(entry, backKnown(c, known), prev, inc)
}

// One view per state and exercise: the store hands out a new state on every change, and a render
// asks for the same view many times over.
const VIEWS = new WeakMap()
// The history as each exercise sees it, by the workouts array it was made from (exView).
const HISTORY_VIEWS = new WeakMap()

/**
 * The state as this exercise sees it (see the top of the file): `unit` is the exercise's, and its
 * entries in every workout and in the running session, its slots in every routine, its kept
 * working weight and its bar are converted to it. A session that holds the exercise has its body
 * weight converted too, for the lifts that add it. The state itself for an exercise in the
 * profile's unit. For reading only: write through the `stored*` helpers.
 */
export function exView(S, exId) {
  if (!S || typeof S !== 'object' || !exConverted(S, exId)) return S
  let byEx = VIEWS.get(S)
  if (!byEx) VIEWS.set(S, byEx = new Map())
  if (byEx.has(exId)) return byEx.get(exId)
  const from = profileUnit(S), to = exUnitOf(S, exId)
  const [c] = viewFns(S, exId)
  const session = w => {
    if (!w || !Array.isArray(w.entries) || !w.entries.some(e => e?.id === exId)) return w
    const out = { ...w, entries: w.entries.map(e => (e?.id === exId ? viewEntry(S, e) : e)) }
    if (Number.isFinite(Number(w.bw)) && w.bw != null) out.bw = convertExact(w.bw, from, to, EXACT_VIEW)
    return out
  }
  const V = { ...S, unit: to }
  if (Array.isArray(S.workouts)) {
    // The history is the same array through a whole workout (only S.active changes), so its
    // converted copy is kept by that array and reused: every tap makes a new state, and each
    // pinned exercise on screen walked years of sessions again.
    let seen = HISTORY_VIEWS.get(S.workouts)
    if (!seen) HISTORY_VIEWS.set(S.workouts, seen = new Map())
    const key = exId + '|' + from + '|' + to
    if (!seen.has(key)) seen.set(key, S.workouts.map(session))
    V.workouts = seen.get(key)
  }
  if (S.active) V.active = session(S.active)
  if (Array.isArray(S.routines)) {
    V.routines = S.routines.map(r => (Array.isArray(r?.ex) && r.ex.some(x => x?.id === exId)
      ? { ...r, ex: r.ex.map(x => (x?.id === exId ? viewTarget(S, exId, x) : x)) } : r))
  }
  if (Array.isArray(S.bodyweight)) {
    const cw = w => convertExact(w, from, to, EXACT_VIEW)
    V.bodyweight = S.bodyweight.map(b => (b && b.w != null
      ? { ...b, w: cw(b.w), ...(Array.isArray(b.ins) ? { ins: b.ins.map(r => (r && r.w != null ? { ...r, w: cw(r.w) } : r)) } : {}) } : b))
  }
  const kept = S.exWeights?.[exId]
  if (kept != null) V.exWeights = { ...S.exWeights, [exId]: isMap(kept) ? { ...kept, w: c(kept.w) } : c(kept) }
  // A bar of the exercise's own: 0 is "no bar" in both units. Without one the bar type's default
  // for the exercise's unit applies (lib/bar.js reads `unit`), so a pinned barbell gets 45 lb.
  const bar = S.barWeights?.[exId]
  if (typeof bar === 'number' && bar > 0) V.barWeights = { ...S.barWeights, [exId]: c(bar) }
  byEx.set(exId, V)
  return V
}

/** A bar weight for the exercise typed in its unit, as S.barWeights stores it. */
export const storedBar = (S, exId, v) => (v > 0 ? storedWeight(S, exId, v, S?.barWeights?.[exId]) : v)

/**
 * Change one entry of the running session in its own unit: `fn` gets the entry as the exercise
 * shows it and changes it in place, the way it changes a stored one, and what it leaves is stored
 * back in the profile's unit. `s` is a state being changed (a store update's draft).
 */
export function inEntryUnit(s, idx, fn) {
  const e = s?.active?.entries?.[idx]
  if (!e || !exConverted(s, e.id)) return fn(e)
  const v = viewEntry(s, e)
  const out = fn(v)
  s.active.entries[idx] = storedEntry(s, v, e)
  return out
}

/** " (lb)" after a line of sets of an exercise shown in a unit other than the profile's, else "". */
export const exUnitTag = (S, exId) => (exConverted(S, exId) ? ` (${exUnitOf(S, exId)})` : '')
