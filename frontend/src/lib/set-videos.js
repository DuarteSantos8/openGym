// Your own form video of one set (v1.4.4): filmed with the phone's camera or picked from its
// videos while the set is on screen, kept with that set, shown beside it, and lined up per
// exercise so two dates can be watched side by side ("am I getting deeper in my squat?").
//
// Nothing new under the hood, like a workout's photos (lib/workout-media.js): a set's `media` is
// a list of the same MediaRefs, made by the same ingest (same size and length caps), kept in the
// same local store, uploaded by the same sync into the same quota and swept by the same GCs. The
// list sits on the set row itself, set.media = [ref], so it goes wherever the row goes: into the
// saved workout at Finish (lib/finish-workout.js keeps the rows as they are), out with a removed
// set or a deleted workout (nothing refers to the file any more, so the local clean-up and the
// server's GC take it, as they do a workout photo removed), and into the zip backup with the
// workout. A copied set does not bring it along (lib/history.js NOT_COPIED).
//
// Where the bytes live:
//  - a phone in local mode, a guest: on this device only (media-store-fs on a phone), as every
//    photo there; nothing to upload to;
//  - signed in: uploaded like any workout photo, unless "Keep videos on this phone only"
//    (S.formVideoLocal) was on when it was filmed, or the server does not say it keeps set videos
//    (GET /api/config media.sets). Then the ref carries `local: true`: the sync never sends it,
//    other devices never ask for it, and they show "On the phone that filmed it" instead.
//
// They are the owner's own: no Coach payload, MCP tool (get_workout says how many, nothing
// more), share card, Wrapped, PDF, plan file or CSV reads `media`. The tests pin that.
import { normalizeMediaRef } from './media-refs.js'
import { sameWorkout } from './workout-date.js'
import { stampWorkout } from './sync-merge.js'
import { isWarmupRow } from './workout-model.js'

/** One video per set: filming the set again replaces it. */
export const SET_VIDEO_MAX = 1
/** Set videos one workout keeps, all its sets together. Every ref rides in the synced state
 *  (about 300 bytes each) and each is up to the server's video cap, so the list is bounded like
 *  everything else stored. */
export const WORKOUT_SET_VIDEOS_MAX = 24
/** The local-mode length cap, the server's default (lib/media-limits.js DEFAULT_LIMITS.videoSec). */
export const PHONE_VIDEO_SEC = 60

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const list = v => (Array.isArray(v) ? v : [])

/** The form videos of one set as they may be shown: normalised, videos only, each file once, at
 *  most SET_VIDEO_MAX. A reading; the row keeps whatever this leaves out. */
export function setVideosOf(set) {
  const out = []
  const seen = new Set()
  for (const r of list(isObj(set) ? set.media : null)) {
    const m = normalizeMediaRef(r)
    if (!m || m.kind !== 'video' || seen.has(m.hash)) continue
    seen.add(m.hash)
    out.push(m)
    if (out.length >= SET_VIDEO_MAX) break
  }
  return out
}

/** The set's video, or null. */
export const setVideoOf = set => setVideosOf(set)[0] || null

/** Every set video of a workout (saved, or the session in progress), in the order of its rows:
 *  [{ entry, set, exId, m }], at most WORKOUT_SET_VIDEOS_MAX. */
export function workoutSetVideos(w) {
  const out = []
  if (!isObj(w)) return out
  list(w.entries).forEach((e, ei) => {
    if (!isObj(e)) return
    list(e.sets).forEach((s, si) => {
      const m = setVideoOf(s)
      if (m && out.length < WORKOUT_SET_VIDEOS_MAX) out.push({ entry: ei, set: si, exId: e.id, m })
    })
  })
  return out
}

/** How many set videos a workout has: the one number the MCP server is told. */
export const setVideoCount = w => workoutSetVideos(w).length

/**
 * Whether a video filmed now is kept on this phone only (`local: true` on its ref). Never for a
 * guest or a phone in local mode (their files never leave anyway, and they go up as usual if the
 * device is signed in later); signed in, when the person asked for it, or when the server is known
 * and does not keep set videos (no media at all, or no media.sets). A config not known yet (an
 * offline start) is not that answer: the sync checks media.sets again before it sends anything.
 */
export function filmsLocally(S, user, config) {
  if (!user) return false
  if (S && S.formVideoLocal === true) return true
  return !!config && !(config.media && config.media.sets)
}

/** The length cap a video is held to (lib/media-ingest.js refuses a longer one): the server's
 *  videoSec (limitsFrom), or a minute without a server. */
export function filmSecCap(limits) {
  const sec = Number(limits && limits.videoSec)
  return sec > 0 ? sec : PHONE_VIDEO_SEC
}

/**
 * The set "Film a set" (the exercise's ⋯ menu) films: the first work set not ticked yet, the one
 * about to be done; with every set ticked, the last one. Warm-ups are skipped unless that is all
 * there is. -1 for an entry without sets.
 */
export function filmTarget(entry) {
  const sets = list(isObj(entry) ? entry.sets : null)
  if (!sets.length) return -1
  const warm = s => isObj(s) && isWarmupRow(s)
  const open = sets.findIndex(s => isObj(s) && !s.done && !warm(s))
  if (open >= 0) return open
  const anyOpen = sets.findIndex(s => isObj(s) && !s.done)
  return anyOpen >= 0 && sets.every(warm) ? anyOpen : sets.length - 1
}

/**
 * Puts `ref` on set `set` of entry `entry` of the session in progress (state.active). A video
 * there already is replaced (one per set). `local` marks it kept on this phone only. Returns
 * 'added', 'replaced', or why not: 'gone' (no session, or no such set), 'invalid' (not a video
 * normalizeMediaRef accepts) or 'full' (the session has WORKOUT_SET_VIDEOS_MAX already). Mutates
 * `state`, made for useStore's update().
 */
export function attachSetVideo(state, { entry, set }, ref, { local = false } = {}) {
  const row = isObj(state?.active) ? list(state.active.entries)[entry]?.sets?.[set] : null
  if (!isObj(row)) return 'gone'
  const m = normalizeMediaRef(ref)
  if (!m || m.kind !== 'video') return 'invalid'
  if (local) m.local = true
  else delete m.local
  const had = setVideosOf(row).length > 0
  if (!had && workoutSetVideos(state.active).length >= WORKOUT_SET_VIDEOS_MAX) return 'full'
  row.media = [m]
  return had ? 'replaced' : 'added'
}

/** Takes the file `hash` off set `set` of entry `entry` of the session in progress. Returns
 *  whether anything changed. The file is left to the local clean-up, like a removed photo. */
export function detachSetVideo(state, { entry, set }, hash) {
  const row = isObj(state?.active) ? list(state.active.entries)[entry]?.sets?.[set] : null
  if (!isObj(row) || !Array.isArray(row.media)) return false
  const left = row.media.filter(x => !(isObj(x) && x.hash === hash))
  if (left.length === row.media.length) return false
  if (left.length) row.media = left
  else delete row.media
  return true
}

/**
 * Takes the file `hash` off every set of the saved workout `w` (the record or a copy of it) — from
 * History, the exercise's form videos or the workout's viewer. Stamped like any edit of a saved
 * workout (stampWorkout), so the sync keeps the version edited last. Returns whether anything
 * changed.
 */
export function removeSavedSetVideo(state, w, hash, now = Date.now()) {
  const rec = list(state?.workouts).find(x => isObj(x) && sameWorkout(x, w))
  if (!rec) return false
  let changed = false
  for (const e of list(rec.entries)) {
    for (const s of list(isObj(e) ? e.sets : null)) {
      if (!isObj(s) || !Array.isArray(s.media)) continue
      const left = s.media.filter(x => !(isObj(x) && x.hash === hash))
      if (left.length === s.media.length) continue
      if (left.length) s.media = left
      else delete s.media
      changed = true
    }
  }
  if (changed) stampWorkout(rec, now)
  return changed
}

/**
 * "Your form videos" of one exercise: every saved set video of `exId`, newest first (by the
 * workout's day and start, then by set within it): [{ key, wid, d, start, entry, set, row, m }].
 * `key` names one item for the compare picker. The session in progress is not history yet.
 */
export function formVideosFor(state, exId) {
  const out = []
  for (const w of list(state?.workouts)) {
    if (!isObj(w)) continue
    for (const v of workoutSetVideos(w)) {
      if (v.exId !== exId) continue
      out.push({ key: (w.id ?? w.d) + ':' + v.entry + ':' + v.set, wid: w.id ?? null, w, d: w.d || '', start: Number(w.start) || 0, entry: v.entry, set: v.set, row: w.entries[v.entry].sets[v.set], m: v.m })
    }
  }
  return out.sort((a, b) => (b.d.localeCompare(a.d)) || (b.start - a.start) || (b.entry - a.entry) || (b.set - a.set))
}

/** The pair the compare view opens on: the newest and the oldest video (today against where you
 *  started), as keys. Fewer than two videos have no pair. */
export function defaultComparePair(items) {
  const xs = list(items)
  return xs.length >= 2 ? [xs[0].key, xs[xs.length - 1].key] : []
}

/**
 * The compare picker's selection after a tap on `key`: a picked one is unpicked; a new one joins
 * while there is room for two, and otherwise replaces the one picked first. Keys no longer in
 * `items` are dropped. The result is in the timeline's order, newest first, which is how the two
 * show side by side (newer on the start side).
 */
export function toggleCompare(selected, key, items) {
  const known = new Set(list(items).map(x => x.key))
  let sel = list(selected).filter(k => known.has(k))
  if (!known.has(key)) return order(sel, items)
  if (sel.includes(key)) sel = sel.filter(k => k !== key)
  else sel = sel.length >= 2 ? [sel[1], key] : [...sel, key]
  return order(sel, items)
}
const order = (sel, items) => list(items).map(x => x.key).filter(k => sel.includes(k))
