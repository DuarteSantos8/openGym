// "Don't count for progression" (an exercise's ⋯, the workout's settings, or a routine's own
// switch) stamps the logged entry `noProg`, or the whole workout `excludeFromProgression`
// (history.js `entryExcluded`). Progression and "last time" already skip such entries; the
// statistics pages (Stats, Structural balance) read the log through `countedS` so they skip them
// too: a mobility block or a technique day kept out of progression should not count as training
// volume, 1RM or muscle balance either. Every such entry is left out, a workout with nothing left
// is left out as a whole, and the volume of one that lost an entry is worked out again. History,
// the calendar and the workout's own pages read the log as it is.
import { entryExcluded, workoutVolume } from './history.js'

const byList = new WeakMap()
const byS = new WeakMap()

/** `workouts` without the entries kept out of progression (the same array when none is). */
export function countedWorkouts(workouts) {
  if (!Array.isArray(workouts)) return []
  if (byList.has(workouts)) return byList.get(workouts)
  let changed = false
  const out = []
  for (const w of workouts) {
    const entries = Array.isArray(w?.entries) ? w.entries : []
    const kept = entries.filter(e => !entryExcluded(w, e))
    if (kept.length === entries.length) { out.push(w); continue }
    changed = true
    if (!kept.length) continue
    out.push({ ...w, entries: kept, ...(Number.isFinite(w.vol) ? { vol: workoutVolume({ entries: kept }) } : {}) })
  }
  const res = changed ? out : workouts
  byList.set(workouts, res)
  return res
}

/** `S` with its workouts counted, the same object while nothing is kept out. Kept per copy of S. */
export function countedS(S) {
  if (!S || typeof S !== 'object') return S
  if (byS.has(S)) return byS.get(S)
  const ws = countedWorkouts(S.workouts)
  const res = ws === S.workouts ? S : { ...S, workouts: ws }
  byS.set(S, res)
  return res
}
