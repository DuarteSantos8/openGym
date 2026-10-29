// The snapshot for a Garmin watch (frontend/garmin, docs/GARMIN.md): the very snapshot the Apple
// Watch and Wear OS get (lib/watch-sync.js buildSnapshot), cut down to what a Connect IQ message
// carries. Garmin's link is slow and a watch app has little memory, so it holds a window of the
// running workout instead of all of it, and the routines it can start by name only (today's with
// its exercises when they fit). Same field names, same meaning, so the watch's code reads like the
// other two watches'; what is new:
//
//   active.entries[k].i   where that exercise sits in the whole workout (the events' entryIdx)
//   active.count          how many exercises the whole workout has
//   active.progress       [work sets done, work sets in all], over the whole workout
//   active.volume         the volume so far (weight × reps of work sets done), in active.unit
//
// Pure: the native bridge (the Connect IQ Mobile SDK on the phone) sends what this returns as a
// Connect IQ dictionary. Not wired up yet: docs/GARMIN.md "Phone side" is the plan.
export const GARMIN_SNAPSHOT_VERSION = 1
// Connect IQ hands a message to the app as one object in its memory; older watches give a watch
// app 64 to 128 KB in all. Kept small enough that a parse never runs it out.
export const GARMIN_MAX_BYTES = 4 * 1024
// How many routines besides today's the watch lists.
export const GARMIN_OTHERS_MAX = 8

const bytesOf = v => new TextEncoder().encode(JSON.stringify(v)).length
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// A set the watch still has to do: not done, or a per-side set with a side to go.
const openRow = s => !!s && !s.done
const openEntry = e => e?.mode !== 'cardio' && (e?.sets || []).some(openRow)

/**
 * Which exercises of the running workout go to the watch: the one up now (the phone's `cur`, or
 * the first after it with a set to do, else the first anywhere), its whole superset when it has
 * one, and the exercise after that, so the watch can move on before the phone's next message.
 */
export function garminWindow (active) {
  const entries = active?.entries || []
  const n = entries.length
  if (!n) return []
  const cur = Math.max(0, Math.min(n - 1, active.cur || 0))
  let at = -1
  for (let k = 0; k < n && at < 0; k++) { const i = (cur + k) % n; if (openEntry(entries[i])) at = i }
  if (at < 0) at = cur
  let lo = at, hi = at
  const g = entries[at].group
  if (g != null) {
    while (lo > 0 && entries[lo - 1].group === g) lo--
    while (hi + 1 < n && entries[hi + 1].group === g) hi++
  }
  const out = []
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi + 1 < n) out.push(hi + 1)
  return out
}

/** Work sets done and in all, and the volume so far, over the whole workout. */
export function garminTotals (active) {
  let done = 0, all = 0, volume = 0
  for (const e of active?.entries || []) {
    const f = !e.unit || e.unit === active.unit ? 1 : (e.unit === 'lb' ? 0.45359237 : 1 / 0.45359237)
    for (const s of e.sets || []) {
      if (s.warmup) continue
      all++
      if (!s.done) continue
      done++
      if (e.mode === 'reps') volume += (num(s.w) || 0) * (num(s.r) || 0) * f
    }
  }
  return { progress: [done, all], volume: Math.round(volume * 10) / 10 }
}

const slim = (e, ...keys) => { const o = { ...e }; for (const k of keys) delete o[k]; return o }
const nameOnly = r => ({ routineIds: r.routineIds || [], name: r.name || '', entries: [] })

/**
 * The snapshot (buildSnapshot's, with settings, streak and discarded as startWatchSync adds them)
 * made into what a Garmin watch gets. Under `max` bytes as JSON, cutting first what matters least:
 * the other routines' count, the records, the "last time" lines, today's exercises (the watch then
 * asks the phone to start it), and last of all the exercise after the one up now.
 */
export function garminSnapshot (snap, { max = GARMIN_MAX_BYTES } = {}) {
  const st = snap?.settings || {}
  const show = st.show || {}
  const out = {
    v: GARMIN_SNAPSHOT_VERSION,
    unit: snap?.unit === 'lb' ? 'lb' : 'kg',
    restSec: num(snap?.restSec) || 0,
    settings: {
      restHaptics: st.restHaptics !== false,
      lang: typeof st.lang === 'string' ? st.lang : 'en',
      show: { hr: show.hr !== false, last: show.last !== false, next: show.next !== false },
    },
    streak: snap?.streak ? { weeks: snap.streak.weeks || 0, thisWeekDone: !!snap.streak.thisWeekDone } : null,
    ...(Array.isArray(snap?.discarded) && snap.discarded.length ? { discarded: snap.discarded.slice(-5) } : {}),
    active: null,
    ready: null,
  }
  const A = snap?.active
  if (A && Array.isArray(A.entries)) {
    const win = garminWindow(A)
    const { progress, volume } = garminTotals(A)
    const { entries, ...rest } = A
    out.active = { ...rest, count: entries.length, progress, volume, entries: win.map(i => ({ ...entries[i], i })) }
  }
  const R = snap?.ready
  if (R) {
    out.ready = {
      today: R.today ? { ...R.today, entries: (R.today.entries || []).map(e => slim(e, 'last', 'best')) } : null,
      others: (R.others || []).slice(0, GARMIN_OTHERS_MAX).map(nameOnly),
    }
  }
  const steps = [
    () => { if (out.ready) out.ready.others = out.ready.others.slice(0, 4) },
    () => { if (out.active) out.active.entries = out.active.entries.map(e => slim(e, 'best')) },
    () => { if (out.active) out.active.entries = out.active.entries.map((e, k) => (k ? slim(e, 'last') : e)) },
    () => { if (out.ready?.today) out.ready.today = nameOnly(out.ready.today) },
    () => { if (out.active) out.active.entries = out.active.entries.map(e => slim(e, 'last')) },
    () => { if (out.ready) out.ready.others = [] },
    () => { if (out.active && out.active.entries.length > 1) out.active.entries = out.active.entries.slice(0, -1) },
  ]
  for (const step of steps) {
    if (bytesOf(out) <= max) break
    step()
  }
  return out
}
