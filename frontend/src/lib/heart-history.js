// An exercise's heart rate across sessions, compared like with like: only the sets of one format
// (the same time held, or the same reps at the same load) go on one curve, so a heart that climbs
// less for the same work reads as fitness rather than as a lighter day. Read from the sets' own
// `hr` and `restHr` (lib/heart-rate.js), never kept.
import { modeOf } from './history.js'
import { isSideSet, isWarmupRow } from './workout-model.js'
import { sanitizeHr } from './heart-rate.js'
import { exerciseSpans, heartStats, tickOf } from './heart-steps.js'
import { syncKeyOf } from './workout-date.js'

const BPM_MIN = 25
const BPM_MAX = 250

/** The format a set belongs to: 't:60' (60 s held), 'r:12@0' (12 reps, no load), or null. */
export function heartFormat(set, mode) {
  if (!set || typeof set !== 'object') return null
  if (mode === 'time') {
    const sec = Math.round(Number(set.sec))
    return sec > 0 ? `t:${sec}` : null
  }
  if (mode === 'reps') {
    const r = Math.round(Number(set.r)), w = Number(set.w) || 0
    return r > 0 ? `r:${r}@${Math.round(w * 100) / 100}` : null
  }
  return null
}

/** { mode, sec } or { mode, r, w } back from a format key. */
export function parseFormat(key) {
  const m = /^t:(\d+)$/.exec(key || '')
  if (m) return { mode: 'time', sec: +m[1] }
  const r = /^r:(\d+)@(-?[\d.]+)$/.exec(key || '')
  return r ? { mode: 'reps', r: +r[1], w: +r[2] } : null
}

// The spans ({ from, to }) of the done work sets of `exId` in `w` in format `key`: each from the
// tick before it in the workout (any exercise's, or the start) to its own tick.
function formatSpans(w, exId, key) {
  const start = Number(w?.start) || 0
  // Every set's tick as the session's card reads it (a per-side set's later side).
  const ticks = []
  for (const e of w?.entries || []) for (const s of e?.sets || []) { const at = tickOf(s); if (at > 0) ticks.push(at) }
  ticks.sort((a, b) => a - b)
  const out = []
  for (const e of w?.entries || []) {
    if (String(e?.id) !== String(exId)) continue
    const mode = modeOf(e.target || { id: e.id })
    for (const s of e.sets || []) {
      if (!s?.done || isWarmupRow(s) || isSideSet(s) || !(Number(s.at) > 0) || heartFormat(s, mode) !== key) continue
      const to = Number(s.at)
      const before = ticks.filter(x => x < to)
      out.push({ from: before.length ? before[before.length - 1] : start, to })
    }
  }
  // Sets back to back (one's span starts at the other's tick) make one span, so the reading on
  // the tick between them is counted once.
  const merged = []
  for (const sp of out.filter(x => x.to > x.from).sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1]
    if (last && sp.from <= last.to) last.to = Math.max(last.to, sp.to)
    else merged.push({ ...sp })
  }
  return merged
}

// The done work sets of `exId` in `w` with a heart reading, each with its format.
function heartSets(w, exId) {
  const out = []
  for (const e of w?.entries || []) {
    if (String(e?.id) !== String(exId)) continue
    const mode = modeOf(e.target || { id: e.id })
    for (const s of e.sets || []) {
      if (!s?.done || isWarmupRow(s) || isSideSet(s)) continue
      const hr = sanitizeHr(s.hr)
      const key = heartFormat(s, mode)
      if (hr && key) out.push({ key, hr, rest: sanitizeHr(s.restHr) })
    }
  }
  return out
}

/**
 * The heart history of one exercise: { formats, sessions(key) }.
 *   formats  [{ key, sets, sessions }], the one done in most sessions first (then the most sets)
 *   sessions(key)  newest first: [{ id, d, at, n, avg, max, rest }] for the sets of that format;
 *            avg is the sets' average, max the highest peak, rest the average during the rests
 *            after them (null without one).
 */
export function exerciseHeart(workouts, exId) {
  const list = (Array.isArray(workouts) ? workouts : [])
    .map(w => ({ w, sets: heartSets(w, exId) }))
    .filter(x => x.sets.length)
    .sort((a, b) => (b.w.start || 0) - (a.w.start || 0) || String(b.w.d).localeCompare(String(a.w.d)))
  const count = new Map()
  for (const { sets } of list) {
    const seen = new Set()
    for (const s of sets) {
      const c = count.get(s.key) || { key: s.key, sets: 0, sessions: 0 }
      c.sets++
      if (!seen.has(s.key)) { c.sessions++; seen.add(s.key) }
      count.set(s.key, c)
    }
  }
  const formats = [...count.values()].sort((a, b) => b.sessions - a.sessions || b.sets - a.sets || a.key.localeCompare(b.key))
  const sessions = key => list.flatMap(({ w, sets }) => {
    const mine = sets.filter(s => s.key === key)
    if (!mine.length) return []
    const rests = mine.map(s => s.rest).filter(Boolean)
    return [{
      // An older workout without an id has its day and start instead (workout-date.js).
      id: syncKeyOf(w), d: w.d, at: w.start || Date.parse(w.d) || 0, n: mine.length,
      avg: Math.round(mine.reduce((n, s) => n + s.hr.avg, 0) / mine.length),
      max: Math.max(...mine.map(s => s.hr.max)),
      rest: rests.length ? Math.round(rests.reduce((n, r) => n + r.avg, 0) / rests.length) : null,
    }]
  })
  return { formats, sessions }
}

/** The curve of one measure ('avg' | 'max' | 'rest'), oldest first, for LineChart. */
export const heartPoints = (sessions, measure) => sessions.filter(s => s[measure] != null)
  .map(s => ({ t: s.at, y: s[measure], d: s.d })).reverse()

/**
 * The last session's value of a measure and its change from the latest one before it that has
 * it. Nothing when the last session has no such reading: an older one is not the last session's.
 */
export function heartLatest(sessions, measure) {
  const last = sessions[0]
  if (last?.[measure] == null) return { value: null, delta: null }
  const before = sessions.slice(1).find(s => s[measure] != null)
  return { value: last[measure], delta: before ? last[measure] - before[measure] : null }
}

/* ------------------------------------------------- one session's curve, to lay over others -- */

/**
 * The exercise's heart rate in workout `w` from the hub's readings ([ms, bpm]): { points, stats }.
 * points [{ t, hr }], `t` the time since the exercise began (its spans laid end to end when it was
 * come back to, so a later go follows straight on); stats { avg, max, high, n } as on the session's
 * card (lib/heart-steps.js heartStats, `high` the time in zones 4 and 5). null without a reading.
 * With a format `key`, only that format's sets: each from the tick before it (its rest included)
 * to its own, laid end to end, so 60 s holds are never mixed with 30 s ones done the same day.
 */
export function exerciseCurve(w, exId, samples, hrMax, key = null) {
  const entries = w?.entries || []
  const spans = key ? formatSpans(w, exId, key) : exerciseSpans(w).filter(sp => sp.members.some(i => String(entries[i]?.id) === String(exId)))
  if (!spans.length || !Array.isArray(samples)) return null
  const points = [], parts = []
  let offset = 0
  for (const sp of spans) {
    for (const s of samples) {
      if (!Array.isArray(s) || s[0] < sp.from || s[0] > sp.to || s[1] < BPM_MIN || s[1] > BPM_MAX) continue
      points.push({ t: offset + s[0] - sp.from, hr: Math.round(s[1]) })
    }
    const st = heartStats(samples, sp.from, sp.to, hrMax)
    if (st) parts.push(st)
    offset += sp.to - sp.from
  }
  if (points.length < 2 || !parts.length) return null
  const n = parts.reduce((x, p) => x + p.n, 0)
  return {
    points: points.sort((a, b) => a.t - b.t),
    span: offset,
    stats: {
      avg: Math.round(parts.reduce((x, p) => x + p.avg * p.n, 0) / n),
      max: Math.max(...parts.map(p => p.max)),
      high: parts.reduce((x, p) => x + p.high, 0), n,
    },
  }
}

/**
 * Without the hub's readings (the web app, or reading off): the sets' own readings, set after set,
 * for the sets of one format in `w`: [{ x, hr, max }], `x` 1 for its first such set. [] without one.
 */
export function setCurve(w, exId, key) {
  return heartSets(w, exId).filter(s => s.key === key).map((s, i) => ({ x: i + 1, hr: s.hr.avg, max: s.hr.max }))
}

/* -------------------------------------------- the session's curve, kept with the workout -- */
// The hub's readings are only on the phone that reads them, so the web app and the other devices
// had the sets' averages and no more. A finished workout can carry its curve, small enough to sync:
//
//   hrc  { s, step, v }  s: the first slot's time (ms), step: seconds a slot, v: one whole bpm a
//                        slot, the average of its readings, 0 for a slot without one
//
// At 5 s a slot an hour is 720 numbers, about 3 KB. Older apps carry it along untouched.
export const CURVE_STEP_S = 5

/** The readings ([ms, bpm]) from `start` to `end` as a kept curve, or null with fewer than two. */
export function packCurve(samples, start, end, step = CURVE_STEP_S) {
  const ms = step * 1000
  if (!(end > start) || !Array.isArray(samples)) return null
  const n = Math.ceil((end - start) / ms)
  const sum = new Array(n).fill(0), cnt = new Array(n).fill(0)
  let kept = 0
  for (const s of samples) {
    if (!Array.isArray(s) || !(s[0] >= start) || !(s[0] < end) || !(s[1] >= BPM_MIN) || !(s[1] <= BPM_MAX)) continue
    const i = Math.floor((s[0] - start) / ms)
    sum[i] += s[1]; cnt[i]++; kept++
  }
  if (kept < 2) return null
  const v = sum.map((x, i) => (cnt[i] ? Math.round(x / cnt[i]) : 0))
  while (v.length && !v[v.length - 1]) v.pop()
  let lead = 0
  while (lead < v.length && !v[lead]) lead++
  return { s: start + lead * ms, step, v: v.slice(lead) }
}

/**
 * A kept curve back as readings ([ms, bpm]), each at the middle of its slot, never past `end` (the
 * workout's, so the last slot's reading stays inside it); [] for none.
 */
export function unpackCurve(c, end = Infinity) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.v)) return []
  const s = Number(c.s), ms = (Number(c.step) || CURVE_STEP_S) * 1000
  if (!Number.isFinite(s)) return []
  const last = Number(end) > s ? Number(end) : Infinity
  const out = []
  c.v.forEach((bpm, i) => { if (bpm >= BPM_MIN && bpm <= BPM_MAX) out.push([Math.min(s + i * ms + ms / 2, last), bpm]) })
  return out
}

/**
 * Whether a kept curve covers workout `w` from start to end, within a minute each side: a partial
 * one (a hub that synced late) is read again while the workout is recent.
 */
export function curveCovers(c, w) {
  const start = Number(w?.start), end = Number(w?.end)
  if (!Array.isArray(c?.v) || !c.v.length || !(end > start)) return false
  const ms = (Number(c.step) || CURVE_STEP_S) * 1000
  return Number(c.s) <= start + 60e3 && Number(c.s) + c.v.length * ms >= end - 60e3
}

/**
 * Two kept curves of one workout as one, slot by slot: `b`'s reading where it has one, `a`'s
 * elsewhere, so a fuller read that misses a slot the first one had does not lose it. Either may
 * be missing; curves of different steps are not merged (`b` wins).
 */
export function mergeCurves(a, b) {
  const ok = c => c && Array.isArray(c.v) && Number.isFinite(Number(c.s))
  if (!ok(a)) return ok(b) ? b : null
  if (!ok(b)) return a
  const step = Number(b.step) || CURVE_STEP_S
  if ((Number(a.step) || CURVE_STEP_S) !== step) return b
  const ms = step * 1000
  const s = Math.min(Number(a.s), Number(b.s))
  const at = (c, i) => Math.round((Number(c.s) - s) / ms) + i
  const n = Math.max(at(a, a.v.length), at(b, b.v.length))
  const v = new Array(n).fill(0)
  a.v.forEach((x, i) => { if (x > 0) v[at(a, i)] = x })
  b.v.forEach((x, i) => { if (x > 0) v[at(b, i)] = x })
  return { s, step, v }
}

/** How many slots of a kept curve hold a reading. */
export const curveReadings = c => (Array.isArray(c?.v) ? c.v.filter(x => x > 0).length : 0)
