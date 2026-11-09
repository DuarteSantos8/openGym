// "Delete workouts only" (Settings → Data, gm-journal): the training log goes, everything else stays.
// Reset everything wipes the profile; this takes S.workouts alone (optionally only those before a
// day) and leaves the routines, the plan, the settings, the gyms, body weight, measurements, the
// activities (runs, rides, sport: S.activities), recovery sessions, day notes and the progress
// photos filed under a day as they are. The next weights (exWeights) stay too: they are where
// your routines stand, not a record of the past.
//
// It is an ordinary change through the store, so stampDeletions (lib/sync-merge.js) records every
// workout it removed and the other devices drop them on their next sync; the Undo puts the very same
// records back, which stamps them as added back.
// The same key lib/sync-merge.js names a workout by.
const workoutKey = w => (w?.id != null ? w.id : `${w?.d}|${w?.start}`)

const ISO = /^\d{4}-\d{2}-\d{2}$/
const byDay = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (Number(a.start) || 0) - (Number(b.start) || 0))

/** The workouts that would go, oldest first. `before`: only days before it (an ISO date). */
export function workoutsToDelete(S, { before = null } = {}) {
  const cut = ISO.test(String(before || '')) ? before : null
  return (Array.isArray(S?.workouts) ? S.workouts : []).filter(w => w && (!cut || String(w.d) < cut)).slice().sort(byDay)
}

/** Takes them out of `state` (made for useStore's update). Returns the removed records. */
export function deleteWorkoutsOnly(state, opts = {}) {
  const going = workoutsToDelete(state, opts)
  if (!going.length) return []
  const gone = new Set(going)
  state.workouts = (state.workouts || []).filter(w => !gone.has(w))
  return going.map(w => JSON.parse(JSON.stringify(w)))
}

/** The Undo: puts `removed` back where they belong in the log (any already there are left alone). */
export function restoreWorkouts(state, removed = []) {
  const have = new Set((state.workouts || []).map(w => String(workoutKey(w))))
  const back = removed.filter(w => w && !have.has(String(workoutKey(w))))
  if (!back.length) return 0
  state.workouts = [...(state.workouts || []), ...back].sort(byDay)
  return back.length
}
