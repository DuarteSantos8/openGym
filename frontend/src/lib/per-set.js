/* Per-set progress (issue #145): Stats → Exercise progress drawn as one line per set number, so
 * the set you drop off on shows up — which is often not the last one.
 *
 * A set's number is its place among the session's working sets of this exercise, in reps mode:
 * warm-ups are not counted, a set left undone keeps its number (set 4 never reads as set 3), a
 * per-side set is one set, and a drop set or rest-pause set is plotted at its main set. The same
 * exercise twice in one workout keeps counting across both entries. Pure, so the chart and the
 * tests read the same thing. */
import { workoutAt } from './history.js'
import { phaseForSet, modeForSet, hasCompletedWork, isSideSet } from './workout-model.js'
import { rowsOfPerformance } from './session-ui-adapter.js'
import { legacyEntriesOf } from './prescription/index.js'
import { estimate1RM } from './onerm.js'

export const PER_SET_MAX = 5

const doneSides = set => [set.sides.L, set.sides.R].filter(side => side?.done === true)
const weightOf = set => (isSideSet(set) ? Math.max(0, ...doneSides(set).map(side => Number(side.w) || 0)) : Number(set.w) || 0)

/** Each session with plottable sets: [{ t, d, sets: [{ n, y, w, r }] }], in workout order.
 *  `metric`: 'weight' (default), 'reps', or 'e1rm' — the estimated 1RM of the set itself, which
 *  is what tells straight sets apart: at one weight their lines would lie on top of each other,
 *  and the rep that went missing in the last set is the thing to see. A set past the estimate's
 *  rep cap has no point, as on the Est. 1RM curve. A per-side set is estimated from one side's
 *  reps, not both added up. */
export function perSetSessions(workouts, exId, { metric = 'weight', formula } = {}) {
  const out = []
  for (const w of workouts || []) {
    let n = 0
    const sets = []
    const entries = w.exposures ? w.exposures.map(x => ({ id: x.exerciseId, target: { mode: x.mode }, sets: rowsOfPerformance(x.performance?.sets || [], x.mode) })) : legacyEntriesOf(w)
    for (const entry of entries.filter(entry => entry.id === exId)) {
      const target = entry.target || entry
      for (const set of Array.isArray(entry.sets) ? entry.sets : []) {
        if (phaseForSet(set) !== 'work' || modeForSet(set, target) !== 'reps') continue
        n++
        if (!hasCompletedWork(set)) continue
        const wt = weightOf(set), r = (isSideSet(set) ? doneSides(set).reduce((n, side) => n + (Number(side.r) || 0), 0) : Number(set.r) || 0)
        const perSide = isSideSet(set) ? r / doneSides(set).length : r
        const y = metric === 'reps' ? r : metric === 'e1rm' ? estimate1RM(wt, perSide, formula, set.rir ?? null) || 0 : wt
        if (y > 0) sets.push({ n, y, w: wt, r })
      }
    }
    if (sets.length) out.push({ t: workoutAt(w), d: w.d, sets })
  }
  return out
}

/** One line per set number for the chart, at most PER_SET_MAX of them: { lines, hidden }, where
 *  `hidden` counts the set numbers left out, so the card can say so instead of dropping them quietly. */
export function perSetLines(sessions) {
  const byN = new Map()
  for (const s of sessions) {
    for (const set of s.sets) {
      if (!byN.has(set.n)) byN.set(set.n, [])
      byN.get(set.n).push({ t: s.t, y: set.y, d: s.d })
    }
  }
  const all = [...byN.keys()].sort((a, b) => a - b).map(n => ({ n, points: byN.get(n) }))
  const lines = all.slice(0, PER_SET_MAX)
  return { lines, hidden: all.length - lines.length }
}

/** The set that most often is the first to fall below set 1, as { n, count, of } — `of` being
 *  the sessions with a set 1 and at least one more. Null with fewer than three such sessions (too
 *  few to call it a pattern) or when no session dropped. Ties go to the earlier set. */
export function dropOffSet(sessions) {
  const multi = sessions.filter(s => s.sets.length >= 2 && s.sets[0].n === 1)
  if (multi.length < 3) return null
  const counts = new Map()
  for (const s of multi) {
    const first = s.sets[0].y
    const drop = s.sets.slice(1).find(set => set.y < first)
    if (drop) counts.set(drop.n, (counts.get(drop.n) || 0) + 1)
  }
  let best = null
  for (const [n, count] of counts) {
    if (!best || count > best.count || (count === best.count && n < best.n)) best = { n, count }
  }
  return best && { ...best, of: multi.length }
}
