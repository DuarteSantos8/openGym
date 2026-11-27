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
//   settings.accent       the app's accent as "#rrggbb" (and onAccent, the ink on it), the box
//                         the crown / UP-DOWN starts on (crown), the effort scale (effort: rir or
//                         rpe), autoHolds and askMin (forgotten workouts' minutes before "Still
//                         training?"): each only when the phone has it, so an older watch
//                         app (and the fixture) reads the snapshot as before
//   acked                 the newest ids of the watch's events applied here (GARMIN_ACKED_MAX):
//                         the watch keeps each event until it is named here, so one lost on the
//                         way (the phone app was not running) is sent again
//   now, active.restAt, active.restPaused, active.restLeft, sets' sid
//                         as in every snapshot since the watch-sync round (docs/WATCH_SYNC.md):
//                         the phone's clock, the rest's stamp and pause, each set's id
//
// Pure: lib/watch-sync.js makes it with every snapshot when the watch link says a Garmin is there
// (status `garmin`), and the native bridge (the Connect IQ Mobile SDK on the phone: GarminLink in
// android/app/src/ciq and ios/App/App) sends it as a Connect IQ dictionary.
export const GARMIN_SNAPSHOT_VERSION = 1
// Connect IQ hands a message to the app as one object in its memory; older watches give a watch
// app 64 to 128 KB in all. Kept small enough that a parse never runs it out: in the simulator the
// Instinct 2 (92 KB for the app, the 1.4.5 watch round) parses 3.2 KB and runs out of memory at
// 3.5 KB, so 3 KB.
export const GARMIN_MAX_BYTES = 3 * 1024
// How many routines besides today's the watch lists.
export const GARMIN_OTHERS_MAX = 8
// How many of the newest applied event ids go along (the watch's outbox lets go of those). A
// workout logged with the phone away can leave more on the watch than this: the phone names an id
// again whenever the watch sends it again (lib/watch-sync.js applyEach), so they all get through.
export const GARMIN_ACKED_MAX = 16
// How many go when the snapshot is short of room (a long circuit while a workout drains).
export const GARMIN_ACKED_CUT = 8

const bytesOf = v => new TextEncoder().encode(JSON.stringify(v)).length
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const hex = v => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null)

/** The watch-redesign settings a Garmin understands, each left out when the phone has none. */
export function garminLook (st = {}) {
  return {
    ...(hex(st.accent) ? { accent: hex(st.accent) } : {}),
    ...(hex(st.accent) && hex(st.onAccent) ? { onAccent: hex(st.onAccent) } : {}),
    ...(st.crown === 'weight' || st.crown === 'reps' ? { crown: st.crown } : {}),
    ...(st.effort === 'rir' || st.effort === 'rpe' ? { effort: st.effort } : {}),
    ...(st.autoHolds === true ? { autoHolds: true } : {}),
    // forgotten workouts: minutes without a set before "Still training?" (0: never by time)
    ...(Number.isFinite(st.forgotten?.askMin) && st.forgotten.askMin >= 0 ? { askMin: st.forgotten.askMin } : {}),
  }
}

// A set the watch still has to do: not done, or a per-side set with a side to go.
const openRow = s => !!s && !s.done
const openEntry = e => e?.mode !== 'cardio' && (e?.sets || []).some(openRow)

// The block an exercise belongs to: its whole superset (the exercises next to each other with the
// same group), else just itself, as [first, last].
function blockOf (entries, at) {
  let lo = at, hi = at
  const g = entries[at].group
  if (g != null) {
    while (lo > 0 && entries[lo - 1].group === g) lo--
    while (hi + 1 < entries.length && entries[hi + 1].group === g) hi++
  }
  return [lo, hi]
}

/**
 * Where the exercise up now is: the phone's `cur`, or the first after it with a set to do, else
 * the first anywhere; with only cardio left (logged on the phone), the first of that, so the
 * watch says so instead of waiting for a next part that never comes.
 */
export function garminUpNow (active) {
  const entries = active?.entries || []
  const n = entries.length
  if (!n) return -1
  const cur = Math.max(0, Math.min(n - 1, active.cur || 0))
  for (let k = 0; k < n; k++) { const i = (cur + k) % n; if (openEntry(entries[i])) return i }
  for (let k = 0; k < n; k++) { const i = (cur + k) % n; if ((entries[i]?.sets || []).some(openRow)) return i }
  return cur
}

/**
 * Which exercises of the running workout go to the watch: the one up now, its whole superset
 * when it has one, and the whole block after that (the next superset, or the next exercise), so
 * the watch moves on into it before the phone's next message (#1295: a superset's last round
 * used to end on "Next exercise is on its way from your phone" until the phone answered, minutes
 * when the link was slow; and a lone first member of the next superset was done as straight sets).
 */
export function garminWindow (active) {
  const entries = active?.entries || []
  const n = entries.length
  if (!n) return []
  const [lo, hi] = blockOf(entries, garminUpNow(active))
  const out = []
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi + 1 < n) { const [, hi2] = blockOf(entries, hi + 1); for (let i = hi + 1; i <= hi2; i++) out.push(i) }
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
// A routine's row as the watch reads it: a missing key is null or no, so nulls and noes stay home
// (the bridges leave nulls out anyway; counted here they cost a long routine its exercises).
// The set menu's marks stay out: a Garmin has no set menu, and its bytes are short.
const noMenu = ({ failure, drop, drops, side, rp, ...row } = {}) => row
const leanRow = row => Object.fromEntries(Object.entries(noMenu(row || {})).filter(([, v]) => v != null && v !== false))
const nameOnly = r => ({ routineIds: r.routineIds || [], name: r.name || '', entries: [] })
// A running workout's exercise as the watch reads it: the same lean rows (a set not done and not a
// warm-up goes without `done: false`, `warmup: false`, `sec: null`), and the exercise without its
// nulls and noes, without `mode` when it is reps and without `step` when it is the watch's own
// default (2.5 kg, 5 lb: Core.stepOf). Half the bytes: a six-exercise circuit fits (#1471).
const leanEntry = (e, unit) => {
  const out = { ...leanRow(e), sets: (e.sets || []).map(r => (r && typeof r === 'object' && !Array.isArray(r) ? leanRow(r) : r)) }
  if (out.mode === 'reps') delete out.mode
  if (out.step === ((e.unit || unit) === 'lb' ? 5 : 2.5)) delete out.step
  return out
}
// A name cut for room, at a space, to at most this long (the watch shows two lines of it at the
// most, and cuts what is longer itself).
const NAME_MAX = 32
const cutName = n => {
  if (typeof n !== 'string' || n.length <= NAME_MAX) return n
  const at = n.lastIndexOf(' ', NAME_MAX)
  return n.slice(0, at > NAME_MAX / 2 ? at : NAME_MAX).trimEnd()
}
const shortName = e => ({ ...e, name: cutName(e.name) })

/**
 * The snapshot (buildSnapshot's, with settings, streak and discarded as startWatchSync adds them)
 * made into what a Garmin watch gets. Under `max` bytes as JSON, cutting first what matters least:
 * the other routines' count, the records, the "last time" lines, today's exercises (the watch then
 * asks the phone to start it), then the block after the one up now (whole: half a superset would
 * be done in the wrong order), long names, and last of all the members of the superset up now
 * that come furthest after it (#1471: a six-exercise circuit did not fit). The exercise up now
 * always stays, with every set.
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
      ...garminLook(st),
    },
    streak: snap?.streak ? { weeks: snap.streak.weeks || 0, thisWeekDone: !!snap.streak.thisWeekDone } : null,
    ...(Array.isArray(snap?.discarded) && snap.discarded.length ? { discarded: snap.discarded.slice(-5) } : {}),
    ...(Array.isArray(snap?.acked) && snap.acked.length ? { acked: snap.acked.filter(x => typeof x === 'string').slice(-GARMIN_ACKED_MAX) } : {}),
    // the phone's clock as it made this (docs/WATCH_SYNC.md: the watch's clock offset, `off`)
    ...(num(snap?.now) ? { now: num(snap.now) } : {}),
    active: null,
    ready: null,
  }
  const A = snap?.active
  // where the exercise up now is in the whole workout (its `i`): never cut
  let upNow = -1
  if (A && Array.isArray(A.entries)) {
    const win = garminWindow(A)
    const { progress, volume } = garminTotals(A)
    // The Garmin watch has no Muscles page: the muscle weights and names would only cost bytes.
    const { entries, muscleNames, ...rest } = A
    out.active = { ...rest, count: entries.length, progress, volume, entries: win.map(i => ({ ...leanEntry(slim(entries[i], 'muscles'), A.unit), i })) }
    upNow = garminUpNow(A)
  }
  const R = snap?.ready
  if (R) {
    out.ready = {
      // While a workout runs today's exercises are not needed (the watch starts one only when none
      // runs; the snapshot after the workout brings them again): by name, so the snapshots that go
      // with every set stay small.
      today: R.today ? (out.active ? nameOnly(R.today) : { ...slim(R.today, 'muscleNames'), entries: (R.today.entries || []).map(e => ({ ...slim(e, 'last', 'best', 'muscles'), sets: (e.sets || []).map(leanRow) })) }) : null,
      others: (R.others || []).slice(0, GARMIN_OTHERS_MAX).map(nameOnly),
    }
  }
  const steps = [
    () => { if (out.ready) out.ready.others = out.ready.others.slice(0, 4) },
    () => { if (out.active) out.active.entries = out.active.entries.map(e => slim(e, 'best')) },
    () => { if (out.active) out.active.entries = out.active.entries.map(e => (e.i === upNow ? e : slim(e, 'last'))) },
    () => { if (out.ready?.today) out.ready.today = nameOnly(out.ready.today) },
    () => { if (out.active) out.active.entries = out.active.entries.map(e => slim(e, 'last')) },
    () => { if (out.ready) out.ready.others = [] },
    // the block after the one up now, all of it
    () => { if (out.active && upNow >= 0) out.active.entries = out.active.entries.filter(e => inBlock(e.i)) },
    () => { if (out.active) out.active.entries = out.active.entries.map(shortName) },
    () => { if (out.ready?.today) out.ready.today = shortName(out.ready.today) },
    // what the watch takes as said when it is missing: every line shown, the language (unused)
    () => { const sh = out.settings.show; for (const k of Object.keys(sh)) if (sh[k]) delete sh[k]; delete out.settings.lang },
    // fewer of the applied ids, rather than an exercise of the superset up now: the phone names
    // one again whenever the watch sends it again (otherwise they always go whole)
    () => { if (out.acked && out.active?.entries.length > 1) out.acked = out.acked.slice(-GARMIN_ACKED_CUT) },
  ]
  // whether the exercise at `i` (in the whole workout) is of the block up now
  const inBlock = i => { const [lo, hi] = blockOf(A.entries, upNow); return i >= lo && i <= hi }
  for (const step of steps) {
    if (bytesOf(out) <= max) break
    step()
  }
  // Still too big (a circuit of many exercises with long names): the superset's exercises that
  // come furthest after the one up now go, one by one. The phone's next snapshot, a set later,
  // brings them again.
  if (out.active && upNow >= 0 && bytesOf(out) > max) {
    const [lo, hi] = blockOf(A.entries, upNow)
    const turn = []
    for (let i = upNow + 1; i <= hi; i++) turn.push(i)
    for (let i = lo; i < upNow; i++) turn.push(i)
    while (turn.length && bytesOf(out) > max) {
      const drop = turn.pop()
      out.active.entries = out.active.entries.filter(e => e.i !== drop)
    }
  }
  return out
}
