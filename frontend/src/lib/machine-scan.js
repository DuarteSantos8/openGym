import { supersetUnits } from './history.js'
import { entryProgress } from './exercise-chips.js'

// Where an exercise scanned from a machine code goes in the workout in progress. Pure: the
// workout screen applies the answer (see moveActiveWorkoutUnitTo for the move).

// Entry position for a scanned exercise: right after the current unit once any of it has a ticked
// set, else in front of it. Always between whole supersets, never inside one.
export function scanSlot(active) {
  const entries = active?.entries || []
  const unit = supersetUnits(entries).find(u => u.includes(active?.cur)) || [0]
  const started = unit.some(i => entries[i] && entryProgress(entries[i]) !== 'todo')
  return started ? unit[unit.length - 1] + 1 : unit[0]
}

// { do: 'jump', idx } | { do: 'move', idx, slot } | { do: 'add', slot }
export function scanInWorkout(active, exId) {
  const entries = active?.entries || []
  const slot = scanSlot(active)
  const idx = entries.findIndex(e => e.id === exId)
  if (idx < 0) return { do: 'add', slot }
  if (entryProgress(entries[idx]) === 'done') return { do: 'jump', idx }
  const units = supersetUnits(entries)
  const cur = units.find(u => u.includes(active.cur))
  if (cur && cur.includes(idx)) return { do: 'jump', idx }
  const own = units.find(u => u.includes(idx))
  if (slot >= own[0] && slot <= own[own.length - 1] + 1) return { do: 'jump', idx }
  return { do: 'move', idx, slot }
}

// Which of several exercises sharing a code to open: the one present and not done, if exactly
// one; the only id when there is just one; otherwise null (the caller asks).
export function pickForScan(active, ids) {
  const entries = active?.entries || []
  const open = ids.filter(id => {
    const e = entries.find(x => x.id === id)
    return e && entryProgress(e) !== 'done'
  })
  if (open.length === 1) return open[0]
  return ids.length === 1 ? ids[0] : null
}
