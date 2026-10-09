// Explicit deletion intents, local to this phone and profile. An absent history record
// alone is never permission to remove Health data (logout, reset and restore remove many).
const KEY = 'opengym_apple_health_deletions'
export const healthDeletionOwner = store => {
  const { user, sync } = store.getState()
  return JSON.stringify([sync?.server || 'local', user?.id || 'local'])
}
const signature = workout => JSON.stringify([workout.id, workout.start, workout.end])
function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
export function queueHealthWorkoutDeletion(owner, workout) {
  if (!workout?.id || !Number.isFinite(Number(workout.start)) || !Number.isFinite(Number(workout.end)) ||
    Number(workout.start) <= 0 || Number(workout.end) <= Number(workout.start) || Number(workout.end) > 8640000000000000) return false
  const entry = { id: String(workout.id), start: Number(workout.start), end: Number(workout.end) }
  const all = read(), pending = Array.isArray(all[owner]) ? all[owner] : []
  if (!pending.some(row => signature(row) === signature(entry))) pending.push(entry)
  all[owner] = pending
  // Store this before removing the local record. A storage error aborts that removal.
  localStorage.setItem(KEY, JSON.stringify(all))
  return true
}
function acknowledge(owner, entry) {
  const all = read()
  all[owner] = (Array.isArray(all[owner]) ? all[owner] : []).filter(row => signature(row) !== signature(entry))
  if (!all[owner].length) delete all[owner]
  localStorage.setItem(KEY, JSON.stringify(all))
}
export async function flushHealthWorkoutDeletions(store, native, isCurrent, onCleared = () => {}) {
  const owner = healthDeletionOwner(store)
  const pending = read()[owner]
  if (!Array.isArray(pending)) return []
  const removed = []
  for (const entry of pending) {
    if (!isCurrent() || healthDeletionOwner(store) !== owner) break
    // Restoring that record cancels its pending deletion. Never delete it on a retry.
    if (store.getState().S.workouts.some(row => String(row.id) === entry.id)) {
      acknowledge(owner, entry)
      onCleared(entry.id)
      continue
    }
    const result = await native.deleteWorkout({ workout: entry })
    // Empty reads may mean denied read access: only acknowledge a verified native deletion.
    if (!isCurrent() || healthDeletionOwner(store) !== owner) break
    if (!result?.confirmed) throw new Error('Apple Health workout deletion could not be confirmed')
    acknowledge(owner, entry)
    onCleared(entry.id)
    removed.push(entry.id)
  }
  return removed
}
