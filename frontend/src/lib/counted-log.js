// "Don't count for progression" (an exercise's ⋯, the workout's settings, or a routine's own
// switch) stamps the logged entry `noProg`, or the whole workout `excludeFromProgression`
// (history.js `entryExcluded`). Progression and "last time" already skip such entries; the
// statistics pages (Stats, Structural balance) read the log through `countedS` so they skip them
// too: a mobility block or a technique day kept out of progression should not count as training
// volume, 1RM or muscle balance either. Every such entry is left out, a workout with nothing left
// is left out as a whole, and the volume of one that lost an entry is worked out again. History,
// the calendar and the workout's own pages read the log as it is.
//
// A deload routine's workouts are the exception: the routine stamps `noProg` on every exercise
// it starts (session-start.js), but its switch promises they still show in the statistics, and
// a deload week is training done. An entry whose routine is still a deload routine is counted.
import { entryExcluded, entryRoutineId, workoutVolume } from './history.js'

const byS = new WeakMap()

/**
 * `workouts` without the entries kept out of progression (the same array when none is).
 * `routines` tells a deload routine's entries apart, which are counted.
 */
export function countedWorkouts(workouts, routines = []) {
  if (!Array.isArray(workouts)) return []
  const deloads = new Set((routines || []).filter(r => r?.excludeFromProgression === true).map(r => r.id))
  const kept = (w, e) => !entryExcluded(w, e) || deloads.has(entryRoutineId(w, e))
  let changed = false
  const out = []
  for (const w of workouts) {
    const entries = Array.isArray(w?.entries) ? w.entries : []
    const left = entries.filter(e => kept(w, e))
    if (left.length === entries.length) { out.push(w); continue }
    changed = true
    if (!left.length) continue
    out.push({ ...w, entries: left, ...(Number.isFinite(w.vol) ? { vol: workoutVolume({ entries: left }) } : {}) })
  }
  return changed ? out : workouts
}

/** `S` with its workouts counted, the same object while nothing is kept out. Kept per copy of S. */
export function countedS(S) {
  if (!S || typeof S !== 'object') return S
  if (byS.has(S)) return byS.get(S)
  const ws = countedWorkouts(S.workouts, S.routines)
  const res = ws === S.workouts ? S : { ...S, workouts: ws }
  byS.set(S, res)
  return res
}
