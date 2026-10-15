import { modeOf } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { supersetMeta } from './superset-meta.js'

// Automatic intervals only count ordinary timed work; warm-ups and side-specific work stay manual.
export function intervalGroupReady(entries, unit) {
  return unit?.length > 1 && supersetMeta(entries, unit, { onTarget: true }).mode === 'interval'
    && unit.every(idx => {
      const e = entries[idx]
      return modeOf(e?.target) === 'time' && e?.sets?.length > 0
        && e.sets.every(s => s.done || (!isWarmupRow(s) && !s.side && !s.sides && !s.failure
          && Number.isFinite(Number(s.planSec ?? s.sec)) && Number(s.planSec ?? s.sec) > 0))
    })
}

export function nextIntervalSet(entries, unit, after = null) {
  if (!intervalGroupReady(entries, unit)) return null
  const pos = after == null ? -1 : unit.indexOf(after)
  const order = [...unit.slice(pos + 1), ...unit.slice(0, pos + 1)]
  for (const idx of order) {
    const i = entries[idx].sets.findIndex(s => !s.done)
    if (i >= 0) return { idx, i, roundEnd: after != null && unit.indexOf(idx) <= pos }
  }
  return null
}
