// Heart rate per set, from the Apple Watch (lib/watch-sync.js, ios/App/Watch). Two optional
// fields on a logged set, written only when the watch measured something:
//
//   hr      { avg, max }  beats per minute while the set was done (from its start to its tick)
//   restHr  { avg, max }  during the rest after it
//
// Nothing else changes: a set without them is exactly the set it always was, and every reader
// that does not know them (older apps, the server, the exports) carries them along untouched.
//
// Since v1.4.3 the same fields can also come from the phone's health hub (hrFromSamples below),
// for every other watch; they only ever fill a set that has none, so the Apple Watch's own
// reading is never replaced. A finished workout may carry the session's too:
//
//   hr      { avg, max, src, n }  src: 'watch' | 'hc' (Health Connect) | 'ah' (Apple Health),
//                                 n: how many samples it was worked out from
import { modeOf } from './history.js'
import { isSideSet, dropsOf } from './workout-model.js'

const BPM_MIN = 25
const BPM_MAX = 250

/** { avg, max } as whole beats per minute, or null for anything that is not a plausible reading. */
export function sanitizeHr(v) {
  if (!v || typeof v !== 'object') return null
  const avg = Math.round(Number(v.avg)), max = Math.round(Number(v.max))
  if (!Number.isFinite(avg) || !Number.isFinite(max)) return null
  if (avg < BPM_MIN || avg > BPM_MAX || max < BPM_MIN || max > BPM_MAX || max < avg) return null
  return { avg, max }
}

/** " ♥ 132/151" after a set's label, or '' for a set without a reading. */
export function hrLabel(set) {
  const hr = sanitizeHr(set && set.hr)
  return hr ? ` ♥ ${hr.avg}/${hr.max}` : ''
}

/* ------------------------------------------------ heart rate read back from the phone's hub -- */
//
// Health Connect (Android) and Apple Health (iPhone) collect the heart rate every watch and band
// saves there: Garmin, Fitbit, Galaxy Watch, Pixel Watch, Polar, Amazfit, Xiaomi, Gadgetbridge...
// lib/health-sync.js reads the samples between a finished workout's start and end; this works
// out which of them belong to which set. openGym keeps a tick per set (`at`), not a start, so a
// set's window is estimated the way the .fit export does it (lib/fit-export.js): it ends at the
// tick and lasts as long as its reps, seconds or minutes take, but never starts before the set
// ahead of it was ticked. The rest after a set runs until the next one starts.

const REP_MS = 3000
const SET_MIN_MS = 15000
const SET_MAX_MS = 120000
// Ticks this close together were caught up after the fact, all in one go: they say nothing about
// when the set was done.
const WINDOW_MIN_MS = 5000
const REST_MIN_MS = 10000
const LAST_REST_MS = 5 * 60000
// Samples further apart than this (in the median) are too sparse for a set of thirty seconds: a
// band that saves one reading a minute. Then only the session gets a heart rate.
const SPARSE_GAP_MS = 20000
// A tick this far outside the session is not of it (a set edited the next day).
const SLACK_MS = 60000

const setLen = (row, mode) => {
  if (mode === 'cardio') return (Number(row?.min) || 0) * 60000
  if (mode === 'time') return (Number(row?.sec) || 0) * 1000
  return Math.min(SET_MAX_MS, Math.max(SET_MIN_MS, (Math.round(Number(row?.r) || 0)) * REP_MS))
}

// One item per set that was done and ticked: its key ('entry:set'), its tick and how long it took
// (both sides of a per-side set, and the drops of a drop set, in it).
function tickedSets(w) {
  const out = []
  ;(w?.entries || []).forEach((entry, ei) => {
    if (!entry) return
    const mode = modeOf({ ...(entry.target || {}), id: entry.id })
    ;(entry.sets || []).forEach((s, si) => {
      if (!s) return
      const rows = isSideSet(s) ? [s.sides.L, s.sides.R].filter(x => x?.done === true) : s.done === true ? [s] : []
      if (!rows.length) return
      let tick = -Infinity, len = 0
      for (const row of rows) {
        const at = Number.isFinite(Number(row.at)) && Number(row.at) > 0 ? Number(row.at) : Number(s.at)
        if (Number.isFinite(at) && at > tick) tick = at
        len += setLen(row, mode)
        for (const d of dropsOf(row)) if (Number(d?.r) > 0) len += setLen(d, mode)
      }
      if (Number.isFinite(tick) && len > 0) out.push({ key: `${ei}:${si}`, tick, len })
    })
  })
  return out.sort((a, b) => a.tick - b.tick)
}

// The samples in [from, to], or (from, to] with `open`: a set's window and the rest after it
// share their boundary, the tick, which belongs to the set.
function stats(samples, from, to, open = false) {
  let n = 0, sum = 0, max = 0
  for (const [t, bpm] of samples) {
    if (t < from || (open && t === from) || t > to) continue
    n++; sum += bpm
    if (bpm > max) max = bpm
  }
  return n ? { n, hr: sanitizeHr({ avg: sum / n, max }) } : { n: 0, hr: null }
}

/** Plausible [ms, bpm] pairs, oldest first. */
export function cleanSamples(samples) {
  const out = []
  for (const x of Array.isArray(samples) ? samples : []) {
    const t = Number(Array.isArray(x) ? x[0] : x?.t), bpm = Math.round(Number(Array.isArray(x) ? x[1] : x?.bpm))
    if (Number.isFinite(t) && t > 0 && bpm >= BPM_MIN && bpm <= BPM_MAX) out.push([t, bpm])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/**
 * The heart rate of a finished workout `w` from the hub's samples ([ms, bpm]):
 * { session: { avg, max } | null, n, sets: Map<'entry:set', { hr?, restHr? }> }. `n` is how many
 * samples fell inside the session. A set gets a reading only when at least one sample lies in its
 * window and the samples are dense enough to tell one set from the next; otherwise it is left as
 * it is (honest rather than interpolated), and only the session has one. Workouts without ticks
 * (logged before v1.3.x, or typed in afterwards) get the session only.
 */
export function hrFromSamples(w, samples) {
  const start = Number(w?.start), end = Number(w?.end)
  const out = { session: null, n: 0, sets: new Map() }
  if (!(start > 0) || !(end > start)) return out
  const all = cleanSamples(samples).filter(([t]) => t >= start && t <= end + LAST_REST_MS)
  const inSession = stats(all, start, end)
  out.session = inSession.n >= 2 ? inSession.hr : null
  out.n = inSession.n
  if (!out.session) return out
  const gaps = []
  for (let i = 1; i < all.length; i++) gaps.push(all[i][0] - all[i - 1][0])
  gaps.sort((a, b) => a - b)
  if (!gaps.length || gaps[gaps.length >> 1] > SPARSE_GAP_MS) return out
  const items = tickedSets(w).filter(x => x.tick >= start - SLACK_MS && x.tick <= end + SLACK_MS)
  let prevTick = start
  const windows = items.map(x => {
    const from = Math.max(prevTick, x.tick - x.len)
    prevTick = Math.max(prevTick, x.tick)
    return { ...x, from }
  })
  windows.forEach((x, i) => {
    const got = {}
    if (x.tick - x.from >= WINDOW_MIN_MS) {
      const s = stats(all, x.from, x.tick, true)
      if (s.hr) got.hr = s.hr
    }
    const next = windows[i + 1]
    const restTo = next ? next.from : Math.min(x.tick + LAST_REST_MS, Math.max(end, x.tick))
    if (restTo - x.tick >= REST_MIN_MS) {
      const r = stats(all, x.tick, restTo, true)
      if (r.hr) got.restHr = r.hr
    }
    if (got.hr || got.restHr) out.sets.set(x.key, got)
  })
  return out
}
