import { buildCompletedWorkout } from './finish-workout.js'
import { bestWeightForEntry, workoutVolume } from './history.js'
import { hasCompletedWork } from './workout-model.js'

const clone = value => structuredClone(value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const byDayStart = (a, b) => a.d === b.d ? (a.start || 0) - (b.start || 0) : a.d < b.d ? -1 : 1

// A saved-workout edit is an ordinary persisted active draft. The history record stays byte for
// byte unchanged until Save, so reload, cancel and an offline spell cannot lose the original.
export function editCompletedSession(state, workoutId) {
  if (state.active) throw new Error('Finish the current workout first.')
  const original = state.workouts.find(workout => workout.id === workoutId)
  if (!original) throw new Error('This workout is no longer available.')
  const active = clone(original)
  active.entries = clone(original.entries)
  active.cur = 0
  active.editingWorkoutId = original.id
  active.editingOriginal = clone(original)
  for (const key of ['vol', 'prs']) delete active[key]
  state.active = active
  return active
}

// Refresh the record-derived caches that can become stale when a correction lowers or removes a
// set. PRs are historical: each workout is compared only with sessions before it.
export function rebuildHistoryDerived(state, exerciseIds) {
  const ids = new Set(exerciseIds)
  const best = new Map()
  for (const workout of [...state.workouts].sort(byDayStart)) {
    const existing = (workout.prs || []).filter(id => !ids.has(id))
    for (const id of ids) {
      const weight = Math.max(0, ...workout.entries.filter(entry => entry.id === id).map(bestWeightForEntry))
      if (weight > (best.get(id) || 0)) existing.push(id)
      if (weight > (best.get(id) || 0)) best.set(id, weight)
    }
    workout.prs = [...new Set(existing)]
  }
  for (const id of ids) {
    const candidates = state.workouts.flatMap(workout => workout.entries
      .filter(entry => entry.id === id)
      .map(entry => ({ w: bestWeightForEntry(entry), d: workout.d })))
      .filter(value => value.w > 0)
      .sort((a, b) => b.w - a.w)
    if (candidates.length) state.exWeights[id] = candidates[0]
    else delete state.exWeights[id]
  }
}

export function saveWorkoutEdit(state) {
  const active = state.active
  const original = active?.editingOriginal
  const index = state.workouts.findIndex(workout => workout.id === active?.editingWorkoutId)
  if (index < 0) throw new Error('This workout was deleted on another device. Your edits are still here.')
  if (!original || !same(state.workouts[index], original)) {
    throw new Error('This workout changed on another device. Your edits are still here.')
  }

  const updated = buildCompletedWorkout(active, {
    end: original.end,
    prs: original.prs || [],
    snapshotFor: entry => entry.muscleSnapshot,
  })
  updated.start = original.start
  updated.d = original.d

  // Carry occurrence metadata opaquely, by order rather than exercise id: the same exercise may
  // appear twice. Canonical completed-entry fields win, while live-only prescription data stays
  // out of history just as it does after an ordinary workout.
  const logged = active.entries.filter(entry => entry.sets.some(hasCompletedWork))
  updated.entries = updated.entries.map((entry, index) => {
    const merged = { ...clone(logged[index]), ...entry }
    delete merged.plan
    for (const key of ['note', 'notePin', 'noProg', 'muscleSnapshot']) if (!(key in entry)) delete merged[key]
    return merged
  })
  const record = { ...original, ...updated, vol: workoutVolume(updated) }
  for (const key of ['note', 'excludeFromProgression']) if (!(key in updated)) delete record[key]
  state.workouts[index] = record
  rebuildHistoryDerived(state, [...original.entries, ...active.entries].map(entry => entry.id))
  state.active = null
  return record
}

// The editor dirties the device state as its draft changes. If another device changes the source
// record meanwhile, make that remote record the visible original before the normal state merge;
// Save will then detect it instead of silently replacing it with the stale copy held at edit start.
export function prepareLocalStateForEditMerge(local, remote, pending = []) {
  const next = clone(local)
  const receipts = Array.isArray(pending) ? pending : (pending?.id ? [pending] : [])
  const active = local?.active
  const activeEdit = active?.editingWorkoutId
    ? { id: active.editingWorkoutId, original: active.editingOriginal, saved: active, activeDraft: true }
    : null
  const edits = [...(activeEdit ? [activeEdit] : []), ...receipts.filter(edit => edit.id !== activeEdit?.id)]
  let blocked = false
  let occupied = !!active
  const affectedExerciseIds = new Set()
  for (const edit of edits) {
    const { id, original } = edit || {}
    if (!id || !original) continue
    const current = next.workouts?.find(workout => workout.id === id)
    const remoteRecord = remote?.workouts?.find(workout => workout.id === id)
    const saved = edit.saved || (!same(current, original) ? current : null)
    if (remoteRecord && same(remoteRecord, original)) continue

    // The server changed or deleted the source record. Its canonical record wins this merge. A
    // saved local correction becomes an editor draft when the active slot is free; otherwise its
    // receipt remains in localStorage and the caller stops before retrying the PUT.
    next.workouts = next.workouts.filter(workout => workout.id !== id)
    if (remoteRecord) next.workouts.push(clone(remoteRecord))
    if (!edit.activeDraft && saved) {
      if (!occupied) {
        next.active = clone(saved)
        next.active.entries = clone(saved.entries)
        next.active.cur = 0
        next.active.editingWorkoutId = id
        next.active.editingOriginal = clone(remoteRecord || original)
        for (const key of ['vol', 'prs']) delete next.active[key]
        occupied = true
      } else blocked = true
    }
    // The saved correction may already have lowered this cache locally. Once it is moved back to
    // a draft (or held in its receipt), the remote document owns derived state again.
    for (const exerciseId of new Set([...(original.entries || []), ...(current?.entries || []), ...(remoteRecord?.entries || [])].map(entry => entry.id))) {
      affectedExerciseIds.add(exerciseId)
      if (remote?.exWeights?.[exerciseId]) next.exWeights[exerciseId] = clone(remote.exWeights[exerciseId])
      else delete next.exWeights[exerciseId]
    }
  }
  return { state: next, blocked, affectedExerciseIds: [...affectedExerciseIds] }
}

export const localStateForEditMerge = (local, remote, pending) => {
  const prepared = prepareLocalStateForEditMerge(local, remote, pending)
  rebuildHistoryDerived(prepared.state, prepared.affectedExerciseIds)
  return prepared.state
}
