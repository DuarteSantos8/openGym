/* Relative strength: an exercise's progress against body weight over time.
 *
 * Each workout becomes one point: (best effective load) ÷ (body weight then), drawn as "×BW".
 * "Effective load" is what was actually moved, so one chart covers every kind of exercise:
 *   normal lift          logged weight
 *   bodyweight, loaded   body weight + the added weight (weighted pull-up, belted dip)
 *   bodyweight, bare     body weight
 *   assisted machine     body weight − the assistance (less help = a higher ratio)
 * The best is taken either as an estimated 1RM ('e1rm') or as the heaviest set ('top').
 * Pure, so the chart and the tests read the same thing. */
import { isAssisted } from './exercises.js'
import { entriesForExercise, metricRowsForEntry, workoutAt } from './history.js'
import { onLifter } from './structuralBalance.js'
import { isSideSet } from './workout-model.js'
import { estimate1RM, formulaOf } from './onerm.js'
import { currentDbLoad, workoutAs, isBellEx } from './dumbbells.js'

const DAY = 86400000
// A weigh-in further than this from a workout says nothing about that day.
export const BW_MAX_GAP_DAYS = 30

const timeOf = b => Number(b?.t) || new Date(b?.d).getTime()

/** Body weight at time `t`, from the weigh-in log: interpolated between the two weigh-ins around
 *  it, or the nearest one when `t` is outside the log. Null when the nearest weigh-in is more
 *  than `maxGapDays` away, or there is none. */
export function bodyweightAt(log, t, maxGapDays = BW_MAX_GAP_DAYS) {
  const pts = (log || [])
    .map(b => ({ t: timeOf(b), w: Number(b?.w) }))
    .filter(b => Number.isFinite(b.t) && Number.isFinite(b.w) && b.w > 0)
    .sort((a, b) => a.t - b.t)
  if (!pts.length || !Number.isFinite(t)) return null
  let before = null, after = null
  for (const p of pts) {
    if (p.t <= t) before = p
    else { after = p; break }
  }
  const gap = p => (p ? Math.abs(p.t - t) : Infinity)
  const limit = maxGapDays * DAY
  if (before && after) {
    if (Math.min(gap(before), gap(after)) > limit) return null
    return before.w + (after.w - before.w) * ((t - before.t) / (after.t - before.t))
  }
  const near = before || after
  return gap(near) <= limit ? near.w : null
}

/** The weight actually moved by one set, or 0 when it cannot be told (assistance above body weight). */
export function effectiveLoad({ assisted, bodyweight }, w, bw) {
  const load = Number(w) || 0
  if (assisted) return Math.max(0, bw - load)
  if (bodyweight) return bw + load
  return load
}

const doneSides = set => [set.sides.L, set.sides.R].filter(side => side?.done === true)

/** One point per workout: [{ t, d, y, bw, load, note? }], chronological. `y` is the ratio to body
 *  weight; `load` the effective load it was made from; `assisted` that the best set was on an
 *  assistance machine (as the entry says, so a routine's own setting counts), where there is no
 *  1RM and `y` is always the heaviest set. `basis` is 'e1rm' or 'top'. A workout with
 *  no weigh-in near it, or no set the basis can use, has no point. */
export function relativeSeries(S, exId, { basis = 'e1rm', formula = formulaOf(S) } = {}) {
  const out = []
  // Dumbbells and kettlebells are read as the total of both bells, whatever the exercise is set to
  // for its own display: body weight is one number, so the load it is divided into must be the
  // whole load, not the weight of one bell. One-arm work has one bell and so no conversion.
  const as = isBellEx(exId) ? 'total' : currentDbLoad(S, exId)
  for (const workout of S.workouts || []) {
    const t = workoutAt(workout)
    // The weigh-in the workout was logged at wins; the log fills in for older workouts.
    const logged = Number(workout.bw)
    const bw = logged > 0 ? logged : bodyweightAt(S.bodyweight, t)
    if (!(bw > 0)) continue
    let best = 0, viaHelp = false
    for (const entry of entriesForExercise(workoutAs(workout, exId, as), exId)) {
      // The same reading as the structural balance (lib/structuralBalance.js onLifter): the entry's
      // own flag, else the exercise, and belt-and-vest pull-ups and dips, whose logged weight is
      // the plate on the belt, so body weight is part of the load there too.
      const kind = { assisted: isAssisted(entry), bodyweight: onLifter(entry) }
      for (const row of metricRowsForEntry(entry, 'reps')) {
        for (const set of isSideSet(row) ? doneSides(row) : [row]) {
          const load = effectiveLoad(kind, set.w, bw)
          if (load <= 0) continue
          // No one-rep max on an assistance machine (issue #232): the load is partly the machine's,
          // so extrapolating 9 reps at 78 kg to a "102 kg 1RM" says you out-lift your own body
          // weight on a machine that is still helping you. It is always the heaviest set there.
          const y = basis === 'top' || kind.assisted ? load : estimate1RM(load, set.r, formula, set.rir ?? null)
          if (y > best) { best = y; viaHelp = kind.assisted }
        }
      }
    }
    if (best > 0) out.push({ t, d: workout.d, y: best / bw, load: best, bw, assisted: viaHelp })
  }
  return out
}
