// The snapshot for a Huawei watch (watch-huawei, docs/HUAWEI_WATCH.md): the same shape and field
// names as the Garmin snapshot (lib/garmin-snapshot.js, whose helpers it uses), so the watch's
// reader is the same, but with room. The Garmin's 3 KB is a Connect IQ memory limit; the Huawei
// link carries 16 frames of 960 characters, so the whole workout goes, with what the Garmin
// leaves out:
//
//   active.entries        every exercise (`i` is its index), with `best`, `last` and `muscles`;
//                         active.muscleNames, note and healthType ride along as in the full snapshot
//   ready.today           with its exercises, also while a workout runs
//   ready.others          by name, and `folder` when the phone has one
//   settings              the Garmin's look, and: show (every choice the phone has), weighIn,
//                         workoutNote, lastBw, checkin(Day), birthYear, forgotten.graceMin/leaveGym:
//                         each only when the phone has it
//
// The cap counts the text as it travels (wireLength): the frames are pure ASCII, so every other
// character costs 6. Over the cap, what matters least goes first (see `steps`), then whole
// exercises go from the far end, down to the block up now.
import {
  garminLook, garminUpNow, garminTotals, blockOf, leanEntry, leanRow, nameOnly, slim,
  shortName, num, GARMIN_SNAPSHOT_VERSION, GARMIN_ACKED_MAX, GARMIN_ACKED_CUT,
} from './garmin-snapshot.js'

// 16 frames of 960 characters is 15,360; this leaves a margin for the frame headers.
export const HUAWEI_MAX_WIRE = 12000
// How many of the newest applied event ids go along: the watch's outbox holds 60, so naming more
// would name ids it no longer has. (The phone still names the older ones again when the watch
// sends them again.) Cut to the Garmin's 16 when the snapshot is short of room.
export const HUAWEI_ACKED_MAX = 60
// How many routines besides today's the watch lists.
export const HUAWEI_OTHERS_MAX = 24
const OTHERS_CUT = 8

/** The length of `text` on the wire: every character outside 0x20..0x7E goes as \uXXXX (6). */
export function wireLength (text) {
  let n = 0
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); n += c >= 0x20 && c <= 0x7e ? 1 : 6 }
  return n
}
const wireOf = v => wireLength(JSON.stringify(v))

// What the Huawei watch reads of the settings beyond the Garmin's look.
function huaweiLook (st) {
  const f = st.forgotten || {}
  const show = {}
  for (const k of ['clip', 'hr', 'last', 'kcal', 'next', 'zones']) if (typeof st.show?.[k] === 'boolean') show[k] = st.show[k]
  if (st.show?.rest === 'ring' || st.show?.rest === 'plain') show.rest = st.show.rest
  return {
    ...(Object.keys(show).length ? { show } : {}),
    ...(typeof st.weighIn === 'boolean' ? { weighIn: st.weighIn } : {}),
    ...(st.workoutNote === true ? { workoutNote: true } : {}),
    ...(num(st.lastBw) ? { lastBw: st.lastBw } : {}),
    ...(st.checkin === true ? { checkin: true } : {}),
    ...(typeof st.checkinDay === 'string' && st.checkinDay ? { checkinDay: st.checkinDay } : {}),
    ...(num(st.birthYear) ? { birthYear: st.birthYear } : {}),
    // askMin is in garminLook, where the watch reads it
    ...(num(f.graceMin) != null || typeof f.leaveGym === 'boolean'
      ? { forgotten: { ...(num(f.graceMin) != null ? { graceMin: f.graceMin } : {}), ...(typeof f.leaveGym === 'boolean' ? { leaveGym: f.leaveGym } : {}) } }
      : {}),
  }
}

/**
 * The snapshot (buildSnapshot's, with settings, streak and acked as startWatchSync adds them) made
 * into what a Huawei watch gets: under `max` characters on the wire, the exercise up now always
 * whole, with every set.
 */
export function huaweiSnapshot (snap, { max = HUAWEI_MAX_WIRE } = {}) {
  const st = snap?.settings || {}
  const out = {
    v: GARMIN_SNAPSHOT_VERSION,
    unit: snap?.unit === 'lb' ? 'lb' : 'kg',
    restSec: num(snap?.restSec) || 0,
    settings: {
      restHaptics: st.restHaptics !== false,
      lang: typeof st.lang === 'string' ? st.lang : 'en',
      ...garminLook(st),
      ...huaweiLook(st),
    },
    streak: snap?.streak ? { weeks: snap.streak.weeks || 0, thisWeekDone: !!snap.streak.thisWeekDone } : null,
    ...(Array.isArray(snap?.discarded) && snap.discarded.length ? { discarded: snap.discarded.slice(-5) } : {}),
    ...(Array.isArray(snap?.acked) && snap.acked.length ? { acked: snap.acked.filter(x => typeof x === 'string').slice(-HUAWEI_ACKED_MAX) } : {}),
    ...(num(snap?.now) ? { now: num(snap.now) } : {}),
    active: null,
    ready: null,
  }
  const A = snap?.active
  let upNow = -1
  if (A && Array.isArray(A.entries)) {
    const { entries, ...rest } = A
    const { progress, volume } = garminTotals(A)
    out.active = { ...rest, count: entries.length, progress, volume, entries: entries.map((e, i) => ({ ...leanEntry(e, A.unit), i })) }
    upNow = garminUpNow(A)
  }
  const R = snap?.ready
  if (R) {
    out.ready = {
      today: R.today ? { ...R.today, entries: (R.today.entries || []).map(e => ({ ...e, sets: (e.sets || []).map(leanRow) })) } : null,
      others: (R.others || []).slice(0, HUAWEI_OTHERS_MAX).map(r => ({ ...nameOnly(r), ...(r.folder ? { folder: r.folder } : {}) })),
    }
  }
  const eachEntry = fn => { if (out.active) out.active.entries = out.active.entries.map(fn) }
  // Whole exercises, as many as fit: the block up now (it always stays), then the blocks after it,
  // then the ones before it, each nearest first (a superset is one block: half of one would be done
  // in the wrong order, #1295). count and each `i` are of the whole workout, so they stay right.
  const shrink = () => {
    if (!out.active || upNow < 0) return
    const blocks = []
    const [lo, hi] = blockOf(A.entries, upNow)
    const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r }
    blocks.push(range(lo, hi))
    for (let i = hi + 1; i < A.entries.length;) { const [, h2] = blockOf(A.entries, i); blocks.push(range(i, h2)); i = h2 + 1 }
    for (let i = lo - 1; i >= 0;) { const [l2] = blockOf(A.entries, i); blocks.push(range(l2, i)); i = l2 - 1 }
    const byI = new Map(out.active.entries.map(e => [e.i, e]))
    const upTo = k => blocks.slice(0, k).flat().sort((x, y) => x - y).map(i => byI.get(i))
    out.active.entries = upTo(1)
    for (let k = 2; k <= blocks.length; k++) {
      out.active.entries = upTo(k)
      if (wireOf(out) > max) { out.active.entries = upTo(k - 1); break }
    }
  }
  // What matters least goes first. The watch does not read `muscles`, `muscleNames` or `best` yet
  // (they are for its records, medal and Muscles page), so they go before `last`, which it shows on
  // the set page; today's exercises are only needed once this workout is over, so they go before the
  // running workout's `last`; the other routines are a list the watch shows, so they stay longest.
  const steps = [
    () => { if (out.ready) out.ready.others = out.ready.others.slice(0, OTHERS_CUT) },
    () => { const t = out.ready?.today; if (t) { delete t.muscleNames; t.entries = t.entries.map(e => slim(e, 'muscles')) } },
    () => { if (out.active) { delete out.active.muscleNames; eachEntry(e => slim(e, 'muscles')) } },
    () => { const t = out.ready?.today; if (t) t.entries = t.entries.map(e => slim(e, 'best')); eachEntry(e => slim(e, 'best')) },
    () => { const t = out.ready?.today; if (t) t.entries = t.entries.map(e => slim(e, 'last')) },
    () => { if (out.ready?.today) out.ready.today = { ...nameOnly(out.ready.today) } },
    () => eachEntry(e => (e.i === upNow ? e : slim(e, 'last'))),
    () => { if (out.ready) out.ready.others = [] },
    () => eachEntry(e => slim(e, 'last')),
    () => { if (out.acked) out.acked = out.acked.slice(-GARMIN_ACKED_MAX) },
    // names cut to two lines' worth, so more exercises fit
    () => { eachEntry(shortName); if (out.ready?.today) out.ready.today = shortName(out.ready.today); if (out.ready) out.ready.others = out.ready.others.map(shortName) },
    shrink,
    () => { if (out.acked && out.active?.entries.length > 1) out.acked = out.acked.slice(-GARMIN_ACKED_CUT) },
  ]
  for (const step of steps) {
    if (wireOf(out) <= max) break
    step()
  }
  // Still too big: the superset's exercises that come furthest after the one up now go, one by one.
  if (out.active && upNow >= 0 && wireOf(out) > max) {
    const [lo, hi] = blockOf(A.entries, upNow)
    const turn = []
    for (let i = upNow + 1; i <= hi; i++) turn.push(i)
    for (let i = lo; i < upNow; i++) turn.push(i)
    while (turn.length && wireOf(out) > max) {
      const drop = turn.pop()
      out.active.entries = out.active.entries.filter(e => e.i !== drop)
    }
  }
  return out
}
