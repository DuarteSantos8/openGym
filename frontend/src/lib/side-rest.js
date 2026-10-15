import { clampDuration } from './duration.js'
import { isWarmupRow } from './workout-model.js'

// Missing means the old behaviour: no break for reps, a short switch for timed holds.
export function sideRestSecFor(target, workRest = 10) {
  if (!target?.side || target.mode === 'cardio') return 0
  if (Number.isFinite(target.sideRestSec) && target.sideRestSec >= 0) return clampDuration(target.sideRestSec)
  return target.mode === 'time' ? Math.min(10, clampDuration(workRest)) : 0
}

export function hasUnfinishedSide(entry, index, side) {
  const rows = entry?.sets || []
  const row = rows[index]
  if (side === 'L' || side === 'R') return !!(row?.sides?.[side]?.done && !row.sides[side === 'L' ? 'R' : 'L']?.done)
  if (entry?.target?.mode !== 'time' || !row?.done || isWarmupRow(row)) return false
  const partner = row.side === 'L' ? rows[index + 1] : row.side === 'R' ? rows[index - 1] : null
  return !!(partner && !isWarmupRow(partner) && partner.side === (row.side === 'L' ? 'R' : 'L') && !partner.done)
}
