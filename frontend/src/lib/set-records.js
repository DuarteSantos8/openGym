// Records on the set itself (gm-live, 1.4.5): the trophy a set earns the moment it is ticked, the
// same mark on that set in History and on the day's workout, the "how close am I" line before a
// set, and the rep-record table of an exercise's history.
//
// Four kinds, kept apart because they are different claims:
//   weight  the heaviest load ever (on an assistance machine, the least help). The same decision
//           the finish summary and the saved `prs` make (lib/finish-workout.js isWeightPr).
//   reps    the most reps at this weight or heavier (on an assistance machine, at this much help
//           or less). Only once there is something at that weight to beat: a weight never lifted
//           before is a weight record, not a rep record.
//   e1rm    the best estimated 1RM, with the profile's formula (lib/onerm.js).
//   volume  the biggest single set, weight × reps.
// A set is held against the history before its session plus the sets before it in that session,
// so set 3 can beat set 2 and both keep the trophy they earned. An exercise logged for the first
// time sets no records: everything would be one, which says nothing.
//
// Warm-ups never count. A per-side row counts each side as its own set. Only rep work with a
// load or with reps has records here; holds and cardio have their own lines elsewhere.
import { isWarmupRow, isSideSet } from './workout-model.js'
import { metricRowsForEntry, workoutAt, bestWeightFor } from './history.js'
import { isAssisted, beatsWeight } from './exercises.js'
import { estimate1RM, best1RM, weightedEstimate, FORMULAS, DEFAULT_FORMULA, REP_CAP } from './onerm.js'
import { historyAs } from './dumbbells.js'
import { t, tn } from './i18n.js'

export const RECORD_KINDS = ['weight', 'reps', 'e1rm', 'volume']

const EPS = 1e-9
const num = v => Number(v) || 0
const sidesOf = s => (isSideSet(s) ? [s.sides.L, s.sides.R] : [s])

/** Whether the trophies are on (Settings → Workout → Record trophies). On unless switched off. */
export const liveRecordsOn = S => S?.liveRecords !== false
/** Whether a record also sounds (when the app's sounds are on). On unless switched off. */
export const recordSoundOn = S => S?.recordSound !== false
/** Whether the line before a set says how close it is to a record. On unless switched off. */
export const recordHintsOn = S => S?.recordHints !== false

// Every done work set (side) of one entry, as { w, r, rir }.
function doneSets(entry) {
  const out = []
  for (const row of metricRowsForEntry(entry, 'reps')) {
    for (const s of sidesOf(row)) if (s?.done === true && num(s.r) > 0) out.push({ w: num(s.w), r: Math.round(num(s.r)), rir: s.rir ?? null })
  }
  return out
}

// Baselines are read on every render of every exercise card while a session runs, so one scan per
// history array, exercise, dumbbell meaning and formula is kept until the history changes.
const cache = new WeakMap()

/**
 * What the history `H` holds for `exId`: `{ any, weight, e1rm, volume, points }`. `points` is
 * every done work set as `{ w, r }`; `weight` and `e1rm` come from the same readers as the finish
 * summary (bestWeightFor, best1RM), so a live trophy and the summary agree.
 */
export function recordBaseline(H, exId, { as = 'as', formula = DEFAULT_FORMULA } = {}) {
  const ws = H?.workouts
  if (!Array.isArray(ws) || exId == null) return emptyBaseline(exId)
  let byKey = cache.get(ws)
  if (!byKey) { byKey = new Map(); cache.set(ws, byKey) }
  const key = exId + '|' + as + '|' + formula
  if (byKey.has(key)) return byKey.get(key)
  const view = historyAs(H, exId, as)
  const points = []
  for (const w of view.workouts || []) {
    for (const en of w.entries || []) if (en?.id === exId) points.push(...doneSets(en))
  }
  const assisted = isAssisted(exId)
  const base = {
    exId, assisted,
    any: points.length > 0,
    weight: bestWeightFor(H, exId, as),
    e1rm: assisted ? 0 : (best1RM(H, exId, formula, as)?.est || 0),
    volume: assisted ? 0 : Math.max(0, ...points.map(p => p.w * p.r)),
    points,
  }
  byKey.set(key, base)
  return base
}

const emptyBaseline = exId => ({ exId, assisted: isAssisted(exId), any: false, weight: 0, e1rm: 0, volume: 0, points: [] })

// At this load or a harder one: heavier, or on an assistance machine less help.
const atOrHarder = (assisted, pw, w) => (assisted ? pw <= w + EPS : pw >= w - EPS)

/** The most reps the baseline holds at `w` or a harder load, or null when nothing was done there. */
export function repsRecordAt(base, w) {
  let best = null
  for (const p of base?.points || []) {
    if (!atOrHarder(base.assisted, p.w, num(w))) continue
    // A loaded set never stands for a bodyweight one and back: 0 kg means "body only".
    if ((p.w > 0) !== (num(w) > 0)) continue
    if (best == null || p.r > best) best = p.r
  }
  return best
}

/**
 * The kinds of record one set `{ w, r, rir }` sets against `base`, in RECORD_KINDS order.
 * `formula` is the profile's (onerm.js formulaOf).
 */
export function recordKindsOf(set, base, formula = DEFAULT_FORMULA) {
  if (!base?.any || !set) return []
  const w = num(set.w), r = Math.round(num(set.r))
  if (!(r > 0)) return []
  const kinds = []
  // The load test of lib/finish-workout.js isWeightPr, against the running best: a first load
  // (nothing loaded before) is not a record here, as it is not one anywhere on this set.
  if (w > 0 && base.weight > 0 && beatsWeight(base.exId, w, base.weight)) kinds.push('weight')
  const rec = repsRecordAt(base, w)
  if (rec != null && r > rec) kinds.push('reps')
  if (!base.assisted && w > 0) {
    const est = estimate1RM(w, r, formula, set.rir ?? null)
    if (est != null && base.e1rm > 0 && est > base.e1rm + EPS) kinds.push('e1rm')
    if (base.volume > 0 && w * r > base.volume + EPS) kinds.push('volume')
  }
  return kinds
}

// The baseline with one more done set folded in, for the sets after it in the same session.
function fold(base, set, formula) {
  const w = num(set.w), r = Math.round(num(set.r))
  if (!(r > 0)) return base
  const est = !base.assisted && w > 0 ? estimate1RM(w, r, formula, set.rir ?? null) : null
  const better = w > 0 && (base.weight <= 0 || (base.assisted ? w < base.weight : w > base.weight))
  return {
    ...base,
    weight: better ? w : base.weight,
    e1rm: est != null && est > base.e1rm ? est : base.e1rm,
    volume: !base.assisted && w * r > base.volume ? w * r : base.volume,
    points: [...base.points, { w, r }],
  }
}

/**
 * The record kinds of every set of `entry`, by row index: an array as long as `entry.sets`, each
 * an array of kinds (empty for none). A per-side row lists the kinds either side set. Rows are
 * taken in their order, each held against the history and the done rows above it.
 */
export function entryRecords(entry, base, formula = DEFAULT_FORMULA) {
  const rows = entry?.sets || []
  const out = rows.map(() => [])
  if (!base?.any) return out
  let running = base
  rows.forEach((row, i) => {
    if (!row || isWarmupRow(row)) return
    const kinds = new Set()
    for (const side of sidesOf(row)) {
      if (side?.done !== true || !(num(side.r) > 0)) continue
      // Records are rep work; a hold or a cardio row carries no reps and drops out above.
      if (row.sec != null && row.r == null) continue
      for (const k of recordKindsOf(side, running, formula)) kinds.add(k)
      running = fold(running, side, formula)
    }
    out[i] = RECORD_KINDS.filter(k => kinds.has(k))
  })
  return out
}

/**
 * The same marks on a saved workout `w` (History, the day's workout): its entry held against the
 * workouts before it, never a later one, so an old record keeps its trophy after it was beaten.
 */
export function savedEntryRecords(S, w, entry, { as = 'as', formula = DEFAULT_FORMULA } = {}) {
  const at = workoutAt(w)
  const before = (S?.workouts || []).filter(x => x && x !== w && (w?.id == null || x.id !== w.id) && workoutAt(x) < at)
  return entryRecords(entry, recordBaseline(beforeView(S, before), entry.id, { as, formula }), formula)
}

// One state object per "before" list would defeat the cache, so it is keyed on the workout list's
// shape: the same S and the same cut point give the same array.
const beforeCache = new WeakMap()
function beforeView(S, before) {
  let byLen = beforeCache.get(S.workouts)
  if (!byLen) { byLen = new Map(); beforeCache.set(S.workouts, byLen) }
  const key = before.length + ':' + (before.at(-1)?.id ?? '') + ':' + (before[0]?.id ?? '')
  const hit = byLen.get(key)
  if (hit && hit.S === S) return hit.view
  const view = { ...S, workouts: before }
  byLen.set(key, { S, view })
  return view
}

/**
 * The line before a set: how its planned `{ w, r }` stands against the records. Null when there
 * is nothing honest to say (first time, no load and no reps, an assistance machine's 1RM).
 * `{ pct, moreReps, record }`: `pct` the set's estimate as a share of the best estimated 1RM
 * (whole percent, null without one), `moreReps` the reps beyond the planned ones that would make
 * a rep record at this weight (null when there is no rep record there), `record` the kinds the
 * set would set as planned.
 */
export function recordHint(set, base, formula = DEFAULT_FORMULA) {
  if (!base?.any || !set) return null
  const w = num(set.w), r = Math.round(num(set.r))
  if (!(r > 0)) return null
  const record = recordKindsOf(set, base, formula)
  const est = !base.assisted && w > 0 ? estimate1RM(w, r, formula, set.rir ?? null) : null
  const pct = est != null && base.e1rm > 0 ? Math.round(est / base.e1rm * 100) : null
  const rec = repsRecordAt(base, w)
  const moreReps = rec != null && r <= rec ? rec + 1 - r : null
  if (pct == null && moreReps == null && !record.length) return null
  return { pct, moreReps, record }
}

// The share of the 1RM one rep count is lifted at, by the formula: every formula here is the
// weight times a factor of the reps, so the weight for r reps is the 1RM over that factor.
export function repFactor(r, formula = DEFAULT_FORMULA) {
  const reps = Math.round(num(r))
  if (reps < 1) return null
  if (reps === 1) return 1
  if (formula === 'weighted') return weightedEstimate(1, reps)
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA]
  const f = fn(1, reps)
  return Number.isFinite(f) && f > 0 ? f : null
}

/**
 * The rep-record table of an exercise (history sheet): for 1 to REP_CAP reps, the heaviest weight
 * done for at least that many reps, with its date, and what the best estimated 1RM says is
 * possible for that many. `[{ r, best: { w, r, d } | null, possible: number | null }]`; empty for
 * an exercise with no loaded rep work. On an assistance machine "best" is the least help and
 * nothing is "possible" (it has no 1RM).
 */
export function repRecordTable(S, exId, { as = 'as', formula = DEFAULT_FORMULA, max = REP_CAP } = {}) {
  const view = historyAs(S, exId, as)
  const assisted = isAssisted(exId)
  const sets = []
  for (const w of view?.workouts || []) {
    for (const en of w.entries || []) {
      if (en?.id !== exId) continue
      for (const s of doneSets(en)) if (s.w > 0) sets.push({ ...s, d: w.d, t: workoutAt(w) })
    }
  }
  if (!sets.length) return []
  const e1rm = assisted ? 0 : (best1RM(S, exId, formula, as)?.est || 0)
  const rows = []
  for (let r = 1; r <= max; r++) {
    let best = null
    for (const s of sets) {
      if (s.r < r) continue
      const better = !best || (assisted ? s.w < best.w : s.w > best.w) || (s.w === best.w && s.t < best.t)
      if (better) best = s
    }
    const f = e1rm > 0 ? repFactor(r, formula) : null
    const possible = f ? Math.round(e1rm / f * 2) / 2 : null
    rows.push({ r, best: best && { w: best.w, r: best.r, d: best.d }, possible })
  }
  return rows
}

/** The words of the line before a set (lib/set-records.js recordHint), or null. */
export function recordHintText(hint) {
  if (!hint) return null
  const parts = []
  if (hint.record.includes('weight')) parts.push(t('Heavier than ever. No pressure.'))
  else if (hint.record.includes('reps')) parts.push(t('These reps would be a record'))
  else if (hint.moreReps != null) parts.push(tn('{0} more rep for a record at this weight', '{0} more reps for a record at this weight', hint.moreReps))
  if (hint.pct != null) parts.push(hint.pct > 100 ? t('Beats your best e1RM') : t('{0}% of your best e1RM', hint.pct))
  return parts.length ? parts.join(' · ') : null
}
