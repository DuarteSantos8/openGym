// Pure helpers for editing past workouts.
import { bestWeightForEntry, workoutVolume } from './history.js'
import { insertChronological } from './backfill.js'

export function buildEditedWorkout({
  originalWorkout = {},
  name,
  d,
  start,
  durationMin = 60,
  entries = [],
  note = '',
  snapshotFor,
}) {
  const safeDurMin = Math.max(1, Math.round(Number(durationMin) || 60))
  const cleanEntries = (entries || []).map(entry => {
    const doneSets = (entry.sets || []).filter(s => s.done)
    if (!doneSets.length) return null

    const completed = {
      id: entry.id,
      sets: doneSets,
      topW: bestWeightForEntry({ sets: doneSets }) || null,
      target: entry.target || null,
      ...(entry.rid ? { rid: entry.rid } : {}),
      ...(entry.noProg === true ? { noProg: true } : {}),
    }

    const snapshot = typeof snapshotFor === 'function' ? snapshotFor(entry) : entry.muscleSnapshot
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && Object.keys(snapshot).length) {
      completed.muscleSnapshot = { ...snapshot }
    }

    const entryNote = (entry.note || '').trim()
    if (entryNote) {
      completed.note = entryNote
      if (entry.notePin) completed.notePin = true
    }
    return completed
  }).filter(Boolean)

  const sessionNote = (note || '').trim()
  const routineIds = [].concat(originalWorkout.routineIds ?? (originalWorkout.routineId ? [originalWorkout.routineId] : []))
  const allNoProg = cleanEntries.length > 0 && cleanEntries.every(e => e.noProg === true)

  const workout = {
    id: originalWorkout.id,
    d: d || originalWorkout.d,
    start: Number(start) || originalWorkout.start || Date.now(),
    end: (Number(start) || originalWorkout.start || Date.now()) + safeDurMin * 60000,
    routineIds,
    routineId: routineIds[0] ?? null,
    name: (name || '').trim() || originalWorkout.name || 'Freestyle',
    bw: originalWorkout.bw ?? null,
    entries: cleanEntries,
    prs: originalWorkout.prs || [],
    ...(allNoProg ? { excludeFromProgression: true } : {}),
    ...(sessionNote ? { note: sessionNote } : {}),
  }

  workout.vol = workoutVolume(workout)
  return workout
}

export function updateWorkoutInHistory(workouts = [], originalId, updatedWorkout) {
  const kept = (workouts || []).filter(x => x.id !== originalId)
  return insertChronological(kept, updatedWorkout)
}

export function applyEditedWorkoutWeights(exWeights = {}, updatedWorkout) {
  const updated = { ...exWeights }
  let changed = false
  for (const entry of updatedWorkout.entries || []) {
    const mx = bestWeightForEntry(entry)
    if (mx > 0) {
      const cur = updated[entry.id]
      if (!cur || mx > cur.w) {
        updated[entry.id] = { w: mx, d: updatedWorkout.d }
        changed = true
      }
    }
  }
  return changed ? updated : exWeights
}
