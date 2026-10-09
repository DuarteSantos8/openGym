// The chip row at the top of a running workout (#323, the "coloured dots" of #163): one chip per
// unit (a superset is one chip), saying how far along it is. It needs no new data, only the
// session's own rows, so it lives here as a plain function the view and the tests share.
import { supersetUnits } from './history.js'
import { isWarmupRow, isSideSet } from './workout-model.js'

// Anything ticked counts as a start, one side of a per-side set included.
const touched = s => !!(s.done || (isSideSet(s) && (s.sides.L?.done || s.sides.R?.done)))

/** How far one exercise is: 'done' once every work set is ticked (a warm-up you skipped does not
 *  hold the chip back), 'partial' once anything is ticked, else 'todo'. An exercise with no rows
 *  yet has nothing done. */
export function entryProgress(entry) {
  const sets = entry?.sets || []
  const work = sets.filter(s => !isWarmupRow(s))
  if (work.length && work.every(s => s.done)) return 'done'
  return sets.some(touched) ? 'partial' : 'todo'
}

/** One chip per unit: { key, unit, n, state, current }. A superset is done when all of its
 *  members are, and started when any of them is. `cur` is the session's marker (s.active.cur). */
export function exerciseChips(entries, cur) {
  const list = Array.isArray(entries) ? entries : []
  return supersetUnits(list).map((unit, k) => {
    const states = unit.map(idx => entryProgress(list[idx]))
    const state = states.every(s => s === 'done') ? 'done' : states.some(s => s !== 'todo') ? 'partial' : 'todo'
    return { key: unit.join('-'), unit, n: k + 1, state, current: unit.includes(cur) }
  })
}
