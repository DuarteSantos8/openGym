// Vitals from the phone's health store (v1.4.5, gm-insights): last night's sleep, the resting heart
// rate, the heart rate variability and the steps, a day at a time. Read-only and on this phone only:
// lib/health-sync.js reads them behind their own switch (Settings → Integrations → Health Connect or
// Apple Health) and keeps them in the phone's health file, never in the log, so they do not sync,
// do not ride in a backup and never reach a server. The Daily form card in Stats shows them, the
// check-in fills its sleep from them, and the insights (lib/form-insights.js) compare them with
// how the workouts went.
//
// The native side hands over what the store has from local midnight of `from` on (lib/health-sync.js):
//
//   { sleep: [{ s, e, a }],   asleep (a: 0), awake inside a session (a: 1), or only "in bed" (a: 2)
//     rhr:   [{ t, v }],      resting heart rate, bpm
//     hrv:   [{ t, v }],      ms; Health Connect has RMSSD, Apple Health SDNN (hrvKind says which)
//     steps: [{ d, n }],      the store's own daily total, which already leaves out double counts
//     hrvKind: 'rmssd' | 'sdnn' }
//
// Sleep from several sources overlaps (a watch and a phone both track it), so it is merged as a
// union of time, never summed. A stretch of sleep belongs to the day it ends on, when it ends before
// 15:00 (a night's sleep, not an afternoon nap).
import { isoOf } from './format.js'

export const VITALS_KEEP_DAYS = 120
const NAP_FROM_HOUR = 15
const DAY = 86400000
// Plausible bounds: outside them it is a sensor hiccup or someone else's profile in the hub.
const RHR_RANGE = [25, 140]
const HRV_RANGE = [3, 300]
const STEPS_MAX = 150000
const SLEEP_MAX_MIN = 16 * 60

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/

// [[s, e]] merged into non-overlapping stretches, sorted.
export function unionOf(list) {
  const xs = list.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0])
  const out = []
  for (const [s, e] of xs) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}
// `a` minus `b`, both unions.
export function minus(a, b) {
  const out = []
  for (const [s0, e0] of a) {
    let cur = [[s0, e0]]
    for (const [s, e] of b) {
      const next = []
      for (const [x, y] of cur) {
        if (e <= x || s >= y) { next.push([x, y]); continue }
        if (s > x) next.push([x, s])
        if (e < y) next.push([e, y])
      }
      cur = next
    }
    out.push(...cur)
  }
  return out
}

/** Minutes asleep per day (the day each night ends on) from the store's sleep stretches. */
export function sleepByDay(sleep) {
  const rows = Array.isArray(sleep) ? sleep : []
  const pick = a => unionOf(rows.filter(r => r && (Number(r.a) || 0) === a && Number(r.e) > Number(r.s)).map(r => [Number(r.s), Number(r.e)]))
  const asleep = minus(pick(0), pick(1))
  const inBed = pick(2)
  const night = segs => {
    const out = {}
    for (const [s, e] of segs) {
      const end = new Date(e)
      if (end.getHours() >= NAP_FROM_HOUR) continue
      const d = isoOf(end)
      out[d] = (out[d] || 0) + (e - s) / 60000
    }
    return out
  }
  const days = night(asleep)
  // "In bed" only where nothing said asleep (an older tracker): better than nothing, never on top.
  for (const [d, m] of Object.entries(night(inBed))) if (!(days[d] > 0)) days[d] = m
  for (const d of Object.keys(days)) days[d] = Math.min(SLEEP_MAX_MIN, Math.round(days[d]))
  return days
}

// The day's value of point samples: the last resting heart rate, the mean variability.
function perDay(list, [lo, hi], how) {
  const by = {}
  for (const r of Array.isArray(list) ? list : []) {
    const t = Number(r?.t), v = Number(r?.v)
    if (!(t > 0) || !(v >= lo && v <= hi)) continue
    const d = isoOf(new Date(t))
    ;(by[d] = by[d] || []).push([t, v])
  }
  const out = {}
  for (const [d, xs] of Object.entries(by)) {
    xs.sort((a, b) => a[0] - b[0])
    out[d] = how === 'last' ? Math.round(xs.at(-1)[1]) : Math.round(xs.reduce((s, x) => s + x[1], 0) / xs.length)
  }
  return out
}

/**
 * The read `raw` merged into the stored vitals ({ days: { iso: { sleepMin, rhr, hrv, steps } }, hrvKind }),
 * returning the new store. Only days from `from` on are rewritten (what the read covered whole);
 * older days keep what earlier reads found. Days older than VITALS_KEEP_DAYS before `today` go.
 */
export function mergeVitals(store, raw, { from, today = isoOf(new Date()) } = {}) {
  const days = isMap(store?.days) ? { ...store.days } : {}
  const fresh = {}
  const put = (kind, map) => {
    for (const [d, v] of Object.entries(map)) {
      if (!ISO.test(d) || (from && d < from) || d > today) continue
      ;(fresh[d] = fresh[d] || {})[kind] = v
    }
  }
  put('sleepMin', sleepByDay(raw?.sleep))
  put('rhr', perDay(raw?.rhr, RHR_RANGE, 'last'))
  put('hrv', perDay(raw?.hrv, HRV_RANGE, 'mean'))
  const steps = {}
  for (const r of Array.isArray(raw?.steps) ? raw.steps : []) {
    const n = Math.round(Number(r?.n))
    if (typeof r?.d === 'string' && n > 0 && n <= STEPS_MAX) steps[r.d] = n
  }
  put('steps', steps)
  // A read rewrites the days it covered; a kind it did not bring (no permission for it) stays.
  for (const [d, v] of Object.entries(fresh)) days[d] = { ...(days[d] || {}), ...v }
  const keepFrom = isoOf(new Date(new Date(today + 'T12:00:00').getTime() - VITALS_KEEP_DAYS * DAY))
  for (const d of Object.keys(days)) if (d < keepFrom) delete days[d]
  const hrvKind = raw?.hrvKind === 'sdnn' || raw?.hrvKind === 'rmssd' ? raw.hrvKind : store?.hrvKind || null
  return { days, hrvKind }
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const back = (today, n) => isoOf(new Date(new Date(today + 'T12:00:00').getTime() - n * DAY))

/**
 * What the Daily form card shows, per kind with a reading in the last week: the latest value, the
 * day it is from, and the usual (the mean of the 30 days before it, from 7 readings up), or null.
 * { sleep: { v (min), d, usual }, rhr, hrv, steps }
 */
export function vitalsSummary(store, today = isoOf(new Date())) {
  const days = isMap(store?.days) ? store.days : {}
  const keys = Object.keys(days).filter(d => d <= today).sort()
  const weekAgo = back(today, 7)
  const KIND = { sleep: 'sleepMin', rhr: 'rhr', hrv: 'hrv', steps: 'steps' }
  const out = {}
  for (const [name, k] of Object.entries(KIND)) {
    const withIt = keys.filter(d => Number(days[d]?.[k]) > 0)
    const d = withIt.at(-1)
    if (!d || d < weekAgo) { out[name] = null; continue }
    const base = withIt.filter(x => x < d && x >= back(d, 30)).map(x => days[x][k])
    out[name] = { v: days[d][k], d, usual: base.length >= 7 ? Math.round(mean(base)) : null }
  }
  return out
}

/** Hours slept the night before `iso` (it ends on that day), or null. */
export const sleepHoursOn = (store, iso) => {
  const m = Number(store?.days?.[iso]?.sleepMin)
  return m > 0 ? Math.round((m / 60) * 10) / 10 : null
}
