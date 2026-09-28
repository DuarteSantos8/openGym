/* Photos and videos this device holds that its server has not confirmed — owed, exactly like a
 * change that has not been pushed yet.
 *
 * The store (useStore.js) asks two things of this module before it lets a sign-out, a
 * disconnect or an account switch wipe the device: how many of the state's media are still
 * waiting (pendingRefCount), and to try once more to send them (settleMedia). Media that have not
 * reached the server are never deleted silently — they go into the stash with the state, whose
 * refs then keep the files alive (lib/media-sync.js localMediaGc).
 *
 * Kept tiny on purpose: the store imports it at start-up, so it must not pull the sync, the
 * ingest or any screen along. lib/media-sync.js registers itself here once it runs, and
 * publishes what it last learned (usage on the server, what is waiting) for Settings and the
 * sign-out sheet.
 */
import { HASH_RE, stateMediaRefs } from './media-refs.js'
import { getMediaStore } from './media-store.js'

let pending = new Set()
let watching = false
let runner = null
let status = { usage: null, pending: 0, deferred: 0, rejected: 0, unavailable: 0, at: 0 }
const listeners = new Set()

// The pending set follows the local store: every put, upload and removal moves it.
function watch() {
  if (watching) return
  watching = true
  const s = getMediaStore()
  const refresh = () => { pending = s.pendingNow() }
  s.subscribe(refresh)
  refresh()   // already right when the store was opened before (the editor put a file into it)
  s.ready().then(refresh).catch(() => {})
}

/** Starts following the local store — the store calls it at start-up, so the first sign-out
 *  check already knows what is waiting. */
export function loadPending() { watch() }

/**
 * How many photos and videos of `S` — a custom exercise's, or one attached to a logged workout —
 * have a file (or its poster) that the server has not confirmed. Counted per photo or video, not
 * per file, because that is what the sentence counts ("2 photos or videos have not reached your
 * server yet"); a main file and its poster are one photo to the person holding it.
 */
const hasMedia = S => stateMediaRefs(S).length > 0

export function pendingRefCount(S) {
  const refs = stateMediaRefs(S)
  // A copy without media has nothing to count, and does not need the store opened to say so.
  if (!refs.length) return 0
  watch()
  if (!pending.size) return 0
  const seen = new Set()
  for (const m of refs) {
    const main = typeof m.hash === 'string' && HASH_RE.test(m.hash) ? m.hash : null
    const poster = m.poster && typeof m.poster.hash === 'string' && HASH_RE.test(m.poster.hash) ? m.poster.hash : null
    if ((main && pending.has(main)) || (poster && pending.has(poster))) seen.add(main || poster)
  }
  return seen.size
}

/** lib/media-sync.js, once started: { settle() } — one more forced run, bounded in time. */
export function registerMediaRunner(r) { runner = r }

/** Waits for the upload in flight, then makes one more forced attempt (up to 60 s), and leaves
 *  the pending set read from an opened store. Resolves, never rejects: what did not go stays
 *  owed. Without a running sync (the tests, a build that never started it) only the reading. */
export async function settleMedia(S) {
  // A copy without media owes none, and leaves the store unopened.
  if (!hasMedia(S)) return
  watch()
  if (runner) { try { await runner.settle() } catch { /* still owed */ } }
  // The count that follows (unsyncedChanges) cannot wait for the store to open; by now it has.
  try { const s = getMediaStore(); await s.ready(); pending = s.pendingNow() } catch { /* the last known set */ }
}

/* What the last run learned, for Settings ("12 of 200 MB used on your server · 1 waiting to
   upload") and the sign-out sheet. */
export function publishMediaStatus(patch) {
  status = { ...status, ...patch, at: Date.now() }
  for (const fn of listeners) { try { fn(status) } catch { /* a listener's own problem */ } }
}
export const getMediaStatus = () => status
export function subscribeMediaStatus(fn) { listeners.add(fn); return () => listeners.delete(fn) }

/** Tests only. */
export function _resetMediaOwed() {
  pending = new Set(); watching = false; runner = null
  status = { usage: null, pending: 0, deferred: 0, rejected: 0, unavailable: 0, at: 0 }
  listeners.clear()
}
