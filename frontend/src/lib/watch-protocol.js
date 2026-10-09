// A paired Watch must never import a previous account's session into the current profile.
export const watchProfile = store => {
  const { user, sync } = store.getState()
  return JSON.stringify([sync?.server || 'local', user?.id || 'local'])
}
export function propertyList(value) {
  if (Array.isArray(value)) return value.filter(item => item != null).map(propertyList)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item != null).map(([key, item]) => [key, propertyList(item)]))
  return typeof value === 'number' && !Number.isFinite(value) ? 0 : value
}
export function validWatchSession(session) {
  if (!session || typeof session.id !== 'string' || !session.id || session.id.length > 200 ||
      typeof session.profile !== 'string' || !Number.isSafeInteger(session.seq) || session.seq < 1) return false
  if (session.discarded === true) return true
  return Number.isFinite(session.start) && session.start > 0 && session.start <= Date.now() &&
    typeof session.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(session.d || '') &&
    Array.isArray(session.routineIds) && session.routineIds.every(id => typeof id === 'string') &&
    Array.isArray(session.entries) && session.entries.length > 0 && session.entries.length <= 200 &&
    session.entries.every(entry => entry && typeof entry.id === 'string' && Array.isArray(entry.sets) &&
      entry.sets.length <= 200 && entry.sets.every(row => row && typeof row === 'object')) &&
    (session.changes == null || (Array.isArray(session.changes) && session.changes.length <= 10000 &&
      session.changes.every(change => change && Number.isSafeInteger(change.seq) && change.seq > 0 && change.seq <= session.seq)))
}
