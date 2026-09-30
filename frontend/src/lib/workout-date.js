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
import { workLoadOf } from './finish-session.js'
import { beatsWeight } from './exercises.js'
import { stampWorkout } from './sync-merge.js'

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
// has none and `x.id === undefined` would happily match the wrong one, so it is compared by the
// key the sync gives it (`workoutKey` in sync-merge.js). That is also what a move or an edit
// freezes as its id — so a sheet still holding the copy from before that (the detail sheet, when
// a sync brings the frozen record in while it is open) still finds its workout.
const syncKeyOf = w => (w?.id != null ? w.id : legacySyncKey(w))
export const sameWorkout = (a, b) => syncKeyOf(a) === syncKeyOf(b)

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
    for (const e of w.exposures || []) {
      if (!ids.has(e.exerciseId)) continue
      trains = true
      const top = workLoadOf(e)
      // Leads everything dated before it. The running best grows whether or not a badge is
      // written, so a session that cannot gain one still raises the bar for the next. "Leads"
      // is the finish sheet's own test (beatsWeight): on an assistance machine the record is the
      // least help, so there a lighter load leads (issue #232).
      const leads = beatsWeight(e.exerciseId, top, best.get(e.exerciseId) || 0)
      if (leads) best.set(e.exerciseId, top)
      if (leads && (w === moved || had.includes(e.exerciseId))) kept.push(e.exerciseId)
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
//
// The moved workout carries the time of the move (stampWorkout): a conflict with a copy that
// still holds it where it was keeps the version edited last, not whichever copy is newer as a
// whole — a phone that logged a weigh-in since would otherwise put it back.
export function moveWorkout(workouts, ref, iso, time, now = Date.now()) {
  const list = Array.isArray(workouts) ? workouts : []
  const current = list.find(w => sameWorkout(w, ref))
  if (!current) return null
  const moved = stampWorkout(retimeWorkout(current, iso, time), now)
  const filed = insertChronological(list.filter(w => w !== current), moved)
  return rebuildPrHistory(filed, (current.exposures || []).map(e => e.exerciseId), moved)
}

// How long a saved session ran, in whole minutes — what the duration row starts from. At least a
// minute, the way a logged past session is at least one (backfillEnd).
export const durationMinOf = w => Math.max(1, Math.round(Math.max(0, (w?.end ?? w?.start ?? 0) - (w?.start ?? 0)) / 60000))

// The history after a session's length is corrected — the workout nobody ended until they got
// home, and that now reads three hours. The start stays where it was and the end follows it;
// nothing else changes, since neither the order of history nor any badge depends on the length.
// Stamped like every edit of a saved workout (stampWorkout), for a conflict to keep it. Returns
// the new array, or `null` when the workout is not there or already runs that long.
export function setWorkoutDuration(workouts, ref, minutes, now = Date.now()) {
  const list = Array.isArray(workouts) ? workouts : []
  const current = list.find(w => sameWorkout(w, ref))
  const min = Math.max(1, Math.round(Number(minutes) || 0))
  if (!current || !Number.isFinite(current.start) || (current.end != null && min === durationMinOf(current))) return null
  // A record from before ids is keyed by its day and start, and neither moves here.
  const edited = stampWorkout({ ...current, end: current.start + min * 60000 }, now)
  return list.map(w => (w === current ? edited : w))
}
