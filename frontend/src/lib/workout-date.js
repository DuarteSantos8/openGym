// Moving a workout that is already in history to another date or start time.
//
// Nothing about what was lifted changes here: the sets, the volume and the notes are the
// record. What changes is when it happened — which means the history has to be re-filed in
// date order, the session has to keep the length it had, and the PR badges have to be
// re-derived, because "this was a personal record" is a claim about what came before it.
//
// Kept pure and separate from backfill.js (which is about logging a session that never
// existed) so the date arithmetic and the badge surgery are testable without the UI.
import { insertChronological, backfillStart } from './backfill.js'
import { bestWeightForEntry } from './history.js'

// Before ids existed a workout was keyed for sync by its day and start time
// (`workoutKey` in sync-merge.js). That is exactly what this edit changes, so moving such a
// record would give it a new key and the other device's untouched copy would come back from
// the merge as a second workout. Freezing the old key as the id keeps both sides agreeing on
// which record this is, and the union-by-id then lets the newer copy win.
export const legacySyncKey = w => `${w?.d}|${w?.start}`

// `<input type="time">` wants the wall-clock start in the browser's zone — the same zone
// backfillStart() writes it in, so this round-trips.
export const startTimeOf = w => {
  const d = new Date(w?.start || 0)
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Which workout an edit is about. Ids are the identity everywhere else, but a legacy record
// has none and `x.id === undefined` would happily match the wrong one.
export const sameWorkout = (a, b) =>
  a?.id != null || b?.id != null ? a?.id === b?.id : legacySyncKey(a) === legacySyncKey(b)

// The workout as it is after the move: same session, new position in time. The duration is
// carried rather than recomputed, so a session that ran 47 minutes still ran 47 minutes.
export function retimeWorkout(w, iso, time) {
  const duration = Math.max(0, (w.end ?? w.start) - w.start)
  const start = backfillStart(iso, time)
  const moved = { ...w, d: iso, start, end: start + duration }
  if (w.id == null) moved.id = legacySyncKey(w)
  return moved
}

// `prs` is written once, at finish, against the all-time best (bestWeightFor) — which reads as
// chronological only because history normally grows forwards. Once a session moves, a badge it
// was given may no longer be true.
//
// The rule is deliberately asymmetric: a move can take a badge away from any session whose
// claim the new order breaks, but only the session that moved can gain one. Imported and
// backfilled history is filed with `prs: []` for every session on purpose, so awarding badges
// by pure chronology would make a year of imported workouts sprout trophies the user never
// earned the first time one date was nudged. Revoking a claim the order has falsified is a
// correction; handing out new ones is an invention.
//
// Only `exerciseIds` are reconsidered — every other badge in history is left exactly as it was.
export function rebuildPrHistory(workouts, exerciseIds, moved = null) {
  const ids = new Set(exerciseIds || [])
  if (!ids.size) return workouts
  const best = new Map()
  return workouts.map(w => {
    const had = w.prs || []
    const kept = []
    let trains = false
    for (const e of w.entries || []) {
      if (!ids.has(e.id)) continue
      trains = true
      const top = bestWeightForEntry(e)
      // Leads everything dated before it. The running best grows whether or not a badge is
      // written, so a session that cannot gain one still raises the bar for the next.
      const leads = top > 0 && top > (best.get(e.id) || 0)
      if (leads) best.set(e.id, top)
      if (leads && (w === moved || had.includes(e.id))) kept.push(e.id)
    }
    if (!trains) return w
    const prs = [...new Set([...had.filter(id => !ids.has(id)), ...kept])]
    if (prs.length === had.length && prs.every((id, i) => id === had[i])) return w
    return { ...w, prs }
  })
}

// The history after a workout has been moved: the old copy is gone, the moved one sits where
// its new date and start time put it, and every exercise it touches has its badges rebuilt.
// Returns the new array, or `null` when there is nothing to move. The caller stores it.
export function moveWorkout(workouts, ref, iso, time) {
  const list = Array.isArray(workouts) ? workouts : []
  const current = list.find(w => sameWorkout(w, ref))
  if (!current) return null
  const moved = retimeWorkout(current, iso, time)
  const filed = insertChronological(list.filter(w => w !== current), moved)
  return rebuildPrHistory(filed, (current.entries || []).map(e => e.id), moved)
}
