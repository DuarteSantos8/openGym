// Purpose-built migration: keep separate entries so notes, targets, provenance and sets survive.
import { bestWeightForEntry, workoutVolume } from './history.js'
import { allExercises, beatsWeight } from './exercises.js'

export function mergeExerciseHistory(state, { source_exercise_id: source, target_exercise_id: target, update_routines = false }) {
  const catalogue = new Map(allExercises(state).map(ex => [ex.id, ex]))
  if (!source || !target || source === target) throw new Error('Choose two different exercise IDs')
  if (!catalogue.has(source) || !catalogue.has(target)) throw new Error('Unknown exercise ID; use search_exercises first')
  if (typeof update_routines !== 'boolean') throw new Error('update_routines must be a boolean')
  const next = structuredClone(state)
  let workouts_updated = 0, entries_moved = 0, sets_moved = 0, routines_updated = 0, overlapping_workouts = 0
  for (const w of next.workouts || []) {
    const entries = (w.entries || []).filter(e => e.id === source)
    if (!entries.length) continue
    workouts_updated++
    if (w.entries.some(e => e.id === target)) overlapping_workouts++
    for (const e of entries) {
      entries_moved++
      sets_moved += (e.sets || []).length
      e.id = target
      if (e.target?.id === source) e.target.id = target
    }
    if (w.vol != null) w.vol = workoutVolume(w)
  }
  if (update_routines) for (const r of next.routines || []) {
    if (!(r.ex || []).some(e => e.id === source)) continue
    // A duplicate in a routine is ambiguous: do not discard either prescription.
    if (r.ex.some(e => e.id === target)) throw new Error('Routine ' + r.id + ' already contains the target exercise; edit it explicitly or use update_routines=false')
    routines_updated++
    for (const e of r.ex) if (e.id === source) e.id = target
  }
  // PR flags and confirmed best loads are the persisted derived data. Other metrics
  // (1RM, progression and volume) read the log directly and need no stored cache.
  let best = 0, bestDate = null
  const chronological = [...(next.workouts || [])].sort((a, b) =>
    (a.start || new Date(a.d + 'T12:00:00').getTime()) - (b.start || new Date(b.d + 'T12:00:00').getTime()))
  for (const w of workouts_updated ? chronological : []) {
    const relevant = (w.entries || []).filter(e => e.id === target)
    let record = false
    for (const e of relevant) {
      const weight = bestWeightForEntry(e)
      if (beatsWeight(target, weight, best)) { best = weight; bestDate = w.d; record = true }
    }
    if (relevant.length || (w.prs || []).includes(source) || (w.prs || []).includes(target)) {
      const prs = (w.prs || []).filter(id => id !== source && id !== target)
      if (record) prs.push(target)
      w.prs = prs
    }
  }
  if (workouts_updated) {
    next.exWeights = { ...(next.exWeights || {}) }
    delete next.exWeights[source]
    delete next.exWeights[target]
    if (best > 0) next.exWeights[target] = { w: best, d: bestDate }
  }
  return { state: next, summary: {
    workouts_updated, entries_moved, sets_moved, routines_updated, overlapping_workouts,
    source_exercise: catalogue.get(source).n, target_exercise: catalogue.get(target).n,
    source_exercise_id: source, target_exercise_id: target
  } }
}
