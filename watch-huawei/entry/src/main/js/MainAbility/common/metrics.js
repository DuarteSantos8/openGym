// The numbers behind the Metrics pages, as plain data over the core's state `c` and its heart-rate buffer: the
// summary page, Pulse, Zones, Effort, Muscles, and the small ones (streak, plain rest, band tag). Formulas are Wear
// OS's (WatchLogic.kt Metrics, SessionCore.progress/summary; the Apple Watch's Metrics.swift is the twin), ported with
// their tests (test/metrics.test.js). Pure and ES5 subset: no Huawei API, nothing here changes the state.
//
//   numbers(c)   -> null (no workout) | { elapsed, paused, sets: [done, all], volume, unit, hr, showHr }
//                   elapsed seconds (null without a start; stands still at `pausedAt` while the phone has the workout
//                   paused), hr { now, avg, max } or null (none, or the phone's show.hr is off)
//   pulse(c, n)  -> { avg, min, max, points: [[ms, bpm], ...] (at most n) }, nulls and [] without readings
//   zones(c)     -> { maxHr, age, needsBirthYear, bands: [{lo, hi}] x5 (Z1 first), times: [s] x5, now: zone|null, longest }
//                   without a plausible birth year (10 to 100): maxHr null, needsBirthYear true, five zeros, no bands
//   effort(c)    -> { kind: 'rir'|'rpe'|null, rows: [{ id, name, value }] } one per exercise rated here, mean of its rated sets
//   muscles(c)   -> { rows: [{ name, sets }], total } sets done per muscle, most first, then by name
//   metricPages(c) -> the pages in order: 'numbers', 'pulse'?, 'effort', 'zones'?, 'muscles' ([] without a workout)
//   streak(c)    -> { weeks, thisWeekDone } | null          restStyle(c) -> 'ring' | 'plain'       bandOf(row) -> text
//   setsText(v, comma) -> a set count with at most one decimal
// and the pure formulas: average, range, downsample, age, maxHeartRate, zone, zoneBands, timeInZones.
// What can be missing: `muscles` and `muscleNames` (the phone cuts them first when the snapshot is too big): Muscles
// then has no rows; `birthYear` and `show.*` (an older phone): Zones asks for the birth year, pages default to shown.

import { workoutTotals, progress, hrStats, hrSamples, hrDownsample, off, today } from './core.js'

const isNum = v => typeof v === 'number' && isFinite(v)
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const arrOf = v => (Array.isArray(v) ? v : [])
const isTrue = v => v === true || v === 1
const isOff = v => v === false || v === 0
const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
const showOf = c => dictOf(dictOf(c.s.set) ? c.s.set.show : null) || {}
const clean = v => Math.round(v * 1e9) / 1e9

/* ---------- the formulas ---------- */
// The mean of the readings [time, bpm] in whole bpm; null without any (zeros are no reading).
export function average (samples) {
  const v = samples.map(p => p[1]).filter(x => x > 0)
  if (!v.length) return null
  let sum = 0
  v.forEach(x => { sum += x })
  return Math.round(sum / v.length)
}
// [lowest, highest] reading in whole bpm; null without any.
export function range (samples) {
  const v = samples.map(p => p[1]).filter(x => x > 0)
  return v.length ? [Math.min.apply(null, v), Math.max.apply(null, v)] : null
}
// At most n points for drawing: buckets of consecutive samples, each averaged in time and value.
export function downsample (samples, n) {
  if (!(n > 0)) return []
  if (samples.length <= n) return samples.map(p => [p[0], p[1]])
  const out = []
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * samples.length / n)
    const to = Math.floor((i + 1) * samples.length / n)
    let t = 0
    let v = 0
    for (let j = from; j < to; j++) { t += samples[j][0]; v += samples[j][1] }
    out.push([t / (to - from), v / (to - from)])
  }
  return out
}
// The age in whole years, only from 10 to 100; null from a missing or implausible year of birth.
export function age (birthYear, year) {
  if (!isNum(birthYear)) return null
  const a = year - birthYear
  return a >= 10 && a <= 100 ? a : null
}
// Tanaka's estimate of the highest heart rate, 208 - 0.7 x age.
export const maxHeartRate = a => clean(208 - 0.7 * a)
// The zone 1 to 5 of a reading by tenths of the maximum (WatchLogic.kt Metrics.zone); zone 1 has no floor; null for no reading.
export function zone (bpm, max) {
  if (!(bpm > 0) || !(max > 0)) return null
  return Math.min(5, Math.max(1, Math.floor(bpm * 10 / max + 1e-9) - 4))
}
// The five zones' whole-bpm ranges, Z1 first; the edges agree with zone().
export function zoneBands (max) {
  const floors = [2, 3, 4, 5].map(z => Math.ceil(max * (z + 4) / 10 - 1e-9))
  const out = []
  for (let i = 0; i < 5; i++) out.push({ lo: i === 0 ? null : floors[i - 1], hi: i < 4 ? floors[i] - 1 : null })
  return out
}
// Seconds in each zone, Z1 first: a reading's zone gets the gap to the next, at most 30 s; the last counts nothing.
export function timeInZones (samples, max) {
  const t = [0, 0, 0, 0, 0]
  for (let i = 0; i + 1 < samples.length; i++) {
    const z = zone(samples[i][1], max)
    if (z) t[z - 1] += Math.min(30, Math.max(0, (samples[i + 1][0] - samples[i][0]) / 1000))
  }
  return t
}

/* ---------- the pages ---------- */
export function numbers (c) {
  const s = c.s
  const w = dictOf(s.w)
  if (!w) return null
  const start = isNum(w.start) ? w.start : null
  const paused = isNum(w.pausedAt) && w.pausedAt > 0
  // A workout started here and not yet reported by the phone has its start on this watch's clock; the phone's
  // start (and pausedAt) are on the phone's, which is the watch's less its offset.
  const own = s.sh === w.id
  const now = c.env.now() - (own ? 0 : off(c))
  const at = paused ? w.pausedAt : now
  const showHr = !isOff(showOf(c).hr)
  const st = hrStats(c)
  return {
    elapsed: start == null ? null : Math.max(0, Math.floor((at - start) / 1000)),
    paused: paused,
    sets: progress(s),
    volume: Math.round(workoutTotals(w)[1]),
    unit: strOf(w.unit),
    hr: showHr && st ? { now: isNum(c.g.bpm) ? c.g.bpm : null, avg: st.avg, max: st.max } : null,
    showHr: showHr
  }
}

export function pulse (c, n) {
  const st = hrStats(c)
  if (!st) return { avg: null, min: null, max: null, points: [] }
  return { avg: st.avg, min: st.min, max: st.max, points: hrDownsample(c, n) }
}

export function zones (c) {
  const set = dictOf(c.s.set)
  const a = age(set ? set.birthYear : null, parseInt(today(c).slice(0, 4), 10))
  if (a == null) return { maxHr: null, age: null, needsBirthYear: true, bands: [], times: [0, 0, 0, 0, 0], now: null, longest: 0 }
  const max = maxHeartRate(a)
  const samples = hrSamples(c)
  const times = timeInZones(samples, max)
  return {
    maxHr: max, age: a, needsBirthYear: false, bands: zoneBands(max), times: times,
    now: samples.length ? zone(samples[samples.length - 1][1], max) : null,
    longest: Math.max.apply(null, times)
  }
}

export function effort (c) {
  const kind = dictOf(c.s.set) && (c.s.set.effort === 'rir' || c.s.set.effort === 'rpe') ? c.s.set.effort : null
  const groups = {}
  Object.keys(c.s.ef).forEach(k => {
    const r = c.s.ef[k]
    const g = groups[r[1]] || (groups[r[1]] = { i: r[1], id: r[3], name: r[2], sum: 0, n: 0 })
    g.sum += r[0]; g.n += 1
  })
  const rows = kind ? Object.keys(groups).map(k => groups[k]).sort((a, b) => a.i - b.i).map(g => ({ id: g.id, name: g.name, value: g.sum / g.n })) : []
  return { kind: kind, rows: rows }
}

export function muscles (c) {
  const w = dictOf(c.s.w)
  if (!w) return { rows: [], total: 0 }
  const tally = {}
  const add = (m, n) => { Object.keys(m).forEach(k => { if (isNum(m[k]) && m[k] > 0) tally[k] = (tally[k] || 0) + m[k] * n }) }
  arrOf(w.entries).forEach(e => {
    if (!dictOf(e) || !dictOf(e.muscles)) return
    let n = 0
    arrOf(e.sets).forEach(r => { if (dictOf(r) && isTrue(r.done) && !isTrue(r.warmup)) n += 1 })
    if (n > 0) add(e.muscles, n)
  })
  Object.keys(c.s.mu).forEach(k => add(c.s.mu[k][1], c.s.mu[k][0])) // exercises that left the window
  const names = dictOf(w.muscleNames) || {}
  let total = 0
  const rows = Object.keys(tally).map(k => { const v = Math.round(tally[k] * 100) / 100; total += v; return { name: typeof names[k] === 'string' ? names[k] : k, sets: v } })
  rows.sort((a, b) => (b.sets !== a.sets ? b.sets - a.sets : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { rows: rows, total: Math.round(total * 100) / 100 }
}
// A set count with at most one decimal ("1.8", "2"), "1,8" with a comma.
export function setsText (v, comma) {
  const t = String(Math.round(v * 10) / 10)
  return comma ? t.replace('.', ',') : t
}

// Wear's order: the numbers, Pulse (a heart rate is there and shown), Effort, Zones (Pulse and the phone's show.zones), Muscles.
export function metricPages (c) {
  if (!dictOf(c.s.w)) return []
  const pulseOn = !isOff(showOf(c).hr) && hrStats(c) != null
  const zonesOn = pulseOn && !isOff(showOf(c).zones)
  const out = ['numbers']
  if (pulseOn) out.push('pulse')
  out.push('effort')
  if (zonesOn) out.push('zones')
  out.push('muscles')
  return out
}

/* ---------- the small ones ---------- */
export function streak (c) {
  const k = dictOf(c.s.stk)
  return k && isNum(k.weeks) && k.weeks >= 0 ? { weeks: Math.floor(k.weeks), thisWeekDone: isTrue(k.thisWeekDone) } : null
}
// show.rest: 'plain' draws the rest as a plain countdown, anything else as the ring.
export function restStyle (c) { return showOf(c).rest === 'plain' ? 'plain' : 'ring' }
// The resistance band(s) of a set, as the phone writes them ("Red + Yellow"); '' when the snapshot has none.
export const BAND_MAX = 40
export function bandOf (row) {
  const b = dictOf(row) ? row.band : null
  return typeof b === 'string' ? b.slice(0, BAND_MAX) : ''
}
