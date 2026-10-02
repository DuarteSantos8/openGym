// The photos and videos of a logged workout: a progress photo, a form-check clip.
//
// Nothing new under the hood: a workout's `media` is a list of the same MediaRefs a custom
// exercise carries (lib/media-refs.js), made by the same ingest, kept in the same local store,
// uploaded by the same sync and swept by the same GC — which is why referencedHashes walks
// workouts[].media on both the server and the client. This file only edits the list on a saved
// workout, the one place it is written.
//
// Each edit is an edit of the saved workout, so it is stamped (stampWorkout) the way a corrected
// note or a moved date is: a conflict between two copies keeps the version edited last, and a
// photo added on the phone is not lost to the desktop's copy just because that one logged a
// weigh-in since (lib/sync-merge.js). Only a real change stamps — a stamp outranks whatever
// another device wrote since.
//
// Both edit the list as it stands on the record — take one hash out, put one ref on the end —
// and never write back the normalised, capped reading of it (workoutMediaOf): a ref this
// version cannot show (a kind or a field from a newer one) or one past the cap (a list merged
// from two devices, an imported backup) stays on the record for the version or the removal that
// can. The cap only decides what shows and whether Add still has room.
import { normalizeMediaRef, workoutMediaOf, WORKOUT_MEDIA_MAX } from './media-refs.js'
import { sameWorkout } from './workout-date.js'
import { stampWorkout } from './sync-merge.js'

const recordOf = (state, w) => (Array.isArray(state?.workouts) ? state.workouts.find(x => x && sameWorkout(x, w)) : null) || null

const rawOf = rec => (Array.isArray(rec.media) ? rec.media : [])

function write(rec, list, now) {
  if (list.length) rec.media = list
  else delete rec.media
  stampWorkout(rec, now)
}

/**
 * Adds a photo or video to the saved workout `w` (the record or a copy of it) inside `state`.
 * Returns 'added', or why not: 'gone' (the workout was deleted meanwhile), 'invalid' (not a
 * MediaRef normalizeMediaRef accepts), 'full' (already shows WORKOUT_MEDIA_MAX) or 'dup' (that
 * very file is already on it). Mutates `state` — made for useStore's update().
 */
export function addWorkoutMedia(state, w, ref, now = Date.now()) {
  const rec = recordOf(state, w)
  if (!rec) return 'gone'
  const m = normalizeMediaRef(ref)
  if (!m) return 'invalid'
  const raw = rawOf(rec)
  if (raw.some(x => x && x.hash === m.hash)) return 'dup'
  if (workoutMediaOf(rec).length >= WORKOUT_MEDIA_MAX) return 'full'
  write(rec, [...raw, m], now)
  return 'added'
}

/**
 * Takes the file `hash` off the saved workout `w` (every entry that names it). Returns whether
 * anything changed. The file itself is left to the GCs: another device, a stash or an exercise
 * may still refer to it, and the server keeps it for its grace period either way.
 */
export function removeWorkoutMedia(state, w, hash, now = Date.now()) {
  const rec = recordOf(state, w)
  if (!rec) return false
  const raw = rawOf(rec)
  const left = raw.filter(x => !(x && x.hash === hash))
  if (left.length === raw.length) return false
  write(rec, left, now)
  return true
}
