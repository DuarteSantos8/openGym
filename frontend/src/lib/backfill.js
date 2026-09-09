// Logging a workout after the fact. The session itself is the ordinary active workout with a
// `backfill` field on it; these helpers are the parts that differ from a live session, kept
// pure so the date arithmetic and the history surgery can be tested without the UI.

export const workoutsOn = (S, iso) => (S.workouts || []).filter(w => w.d === iso)

// Epoch of `iso` at the given wall-clock time, in the browser's zone — the same zone
// todayISO() and isoOf() use, so `d` and `start` agree the way they do for a live session.
export const backfillStart = (iso, time = '18:00') => {
  const [h, m] = String(time || '18:00').split(':').map(Number)
  const d = new Date(iso + 'T12:00:00')
  d.setHours(h || 0, m || 0, 0, 0)
  return d.getTime()
}

// A live session ends when you tap finish; a logged one ends when you said it did.
export const backfillEnd = active => active.start + Math.max(1, active.backfill?.durationMin || 60) * 60000

// The workouts array is chronological (History reverses it), so a past workout cannot just be
// pushed — it goes where its date and start time put it, after anything from the same moment.
export function insertChronological(workouts, w) {
  const key = x => [x.d || '', x.start || 0]
  const [d, s] = key(w)
  let i = workouts.length
  while (i > 0) {
    const [pd, ps] = key(workouts[i - 1])
    if (pd < d || (pd === d && ps <= s)) break
    i--
  }
  return [...workouts.slice(0, i), w, ...workouts.slice(i)]
}

// The history after a backfilled session is filed: the workout it replaces (if any) is gone
// and the new one sits in date order. Returns a new array; the caller stores it.
export function completeBackfill(workouts, active, w) {
  const replaceId = active.backfill?.replaceId
  const kept = replaceId ? workouts.filter(x => x.id !== replaceId) : workouts
  return insertChronological(kept, w)
}
