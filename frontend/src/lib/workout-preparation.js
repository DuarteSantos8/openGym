import { isoOf } from './format.js'
import { supersetUnits, unitOf } from './history.js'
import { nextUnfinishedUnit, supersetFlowStep } from './supersetFlow.js'
import { nextOpenSet } from './workout-keys.js'

// Only new live sessions opt in. Old active sessions and history edits keep their clocks.
export const isPreparing = active => !!active?.preparing && !active.backfill && !active.editingWorkoutId

export function startPreparedSession(active, now = Date.now()) {
  if (!isPreparing(active) || !active.entries?.length) return active
  const { preparing, ...started } = active
  return { ...started, start: now, d: isoOf(new Date(now)) }
}

// Follow the set that owns the rest, not the card the user happens to be browsing.
// The same navigation helpers drive completion in Workout.jsx, including uneven supersets.
export function restPreview(active, timer) {
  if (!active || isPreparing(active) || active.backfill || active.editingWorkoutId || !timer) return null
  const entries = active.entries || []
  const from = timer.forIdx
  if (!Number.isInteger(from) || !entries[from]) return null
  if (timer.kind === 'switch') return nextOpenSet(entries, from)
  const units = supersetUnits(entries)
  const unit = unitOf(units, from)
  const step = supersetFlowStep(entries, unit, from)
  const at = step?.nextIdx ?? (entries[from].sets.some(s => !s.done) ? from : nextUnfinishedUnit(entries, units, from)?.[0])
  return at == null ? null : nextOpenSet(entries, at)
}
