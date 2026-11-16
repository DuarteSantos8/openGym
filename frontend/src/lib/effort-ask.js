// Settings → Workout → "Ask how hard every set was" (S.effortAsk): ticking a working set that has
// no effort yet asks for it first, and the set counts only once it is rated. The phone opens the
// effort sheet (views/Workout.jsx toggle); the Wear OS watch gets the same choice in its settings
// (lib/watch-sync.js watchExtras, effortAsk) and asks on its own Done.
import { EFFORT, effortOf } from './history.js'
import { isWarmupRow } from './workout-model.js'

/**
 * The effort scale to ask in before this tick counts ('rir' or 'rpe'), or null to tick at once.
 * `row` is the set as it is before the tick, `side` 'L'/'R' for one side of a per-side set, `mode`
 * the exercise's ('reps', 'time', 'cardio'). Only a tick that marks a working reps set done asks,
 * and only while it has no rating: an untick, a warm-up, a hold, cardio or a set already rated
 * never does.
 */
export function askEffortFirst(S, row, side = null, mode = 'reps') {
  if (!S || S.effortAsk !== true || mode !== 'reps' || !row) return null
  const kind = effortOf(S)
  if (!EFFORT[kind]) return null
  if (isWarmupRow(row)) return null
  const part = side ? row.sides?.[side] : row
  if (!part || part.done) return null
  return part[EFFORT[kind].f] == null ? kind : null
}
