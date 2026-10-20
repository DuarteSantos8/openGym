// Apple Health, on the iOS app: a HealthDataProvider (providers.js) over the local HealthKit
// plugin (ios/App/App/HealthKitPlugin.swift). Read-only — openGym writes nothing to Apple Health.
//
// HealthKit never tells an app whether the user allowed reading a type: a type they did not allow
// simply has no samples. So "connected" here means "asked, and the user chose", and an empty
// result is never treated as an error or as a reason to delete anything.
//
// Everything the shared catalogue lists (api/health/catalogue.js) is read, each the way its kind
// says, and folded by the same code that folds Health's export and an iPhone Shortcut
// (api/health/fold.js) — so a reading has the same id whichever way it came in:
//   - body readings: every sample
//   - blood pressure, glucose and the other measurements taken by hand: an hour at a time, so a
//     reading in the morning and one in the evening stay two (HealthKit's hourly statistics)
//   - a day's totals and every other measurement: HealthKit's own statistics, which already
//     leave out the overlap of an iPhone and a Watch counting the same steps: heart rate an hour at a
//     time while recent (90 days), everything else and older heart rate one reading per day (heart rate
//     also its lowest and highest)
//   - sleep: the minutes asleep of each night, given to the day it ended on
//   - symptoms, cycle tracking, notifications, mindfulness: the category's samples, a day at a time
//   - workouts: one reading each, with the activity, its energy and distance
// Thousands of heart-rate samples a day would not fit the synced profile (the server takes 5 MB
// per document), which is why nothing but body readings and workouts arrives sample by sample.
import { MOBILE } from '../mobile.js'
import { isoOf } from '../format.js'
import { TYPES, hourlyFrom } from '../../../../api/health/catalogue.js'
import { APPLE_HEALTH, createFolder } from '../../../../api/health/fold.js'

export { APPLE_HEALTH }

// HealthKit's unit where the catalogue's name differs (HealthKitPlugin.swift reads these).
const NATIVE_UNIT = { '': 'count', bpm: 'count/min', 'mL/kg·min': 'mL/kg*min', 'kcal/hr·kg': 'kcal/hr*kg' }
const nativeUnit = u => NATIVE_UNIT[u] ?? u
const STAT = { sum: 'sum', range: 'range', mean: 'avg' }

const pad = n => String(n).padStart(2, '0')
/** A time in ms as this device's local time with its offset: the day it belongs to is the local one. */
export function localTime(ms) {
  const d = new Date(ms)
  const off = -d.getTimezoneOffset(), a = Math.abs(off)
  return `${isoOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
}
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const list = v => (Array.isArray(v) ? v : [])
// HealthKit's percent is a fraction of 1; the catalogue's unit is what every other value comes in.
const unitOf = type => TYPES[type].unit

/** HealthKit samples of one quantity type as readings: one per sample, keyed by its time. */
export function readingsFromSamples(type, samples) {
  if (!TYPES[type]) return []
  const f = createFolder()
  for (const s of list(samples)) {
    const v = num(s?.value), t = num(s?.start)
    if (v != null && t != null) f.add({ type, v, unit: unitOf(type), start: localTime(t) })
  }
  return f.readings()
}

/**
 * HealthKit's daily statistics of one type as readings: one per day that has any, keyed by the
 * type and the day, so the next fetch of a day that went on replaces it instead of adding to it.
 * A day with nothing counted (0 steps on a phone left in a drawer) is not a reading.
 */
export function readingsFromDays(type, days) {
  if (!TYPES[type]) return []
  const f = createFolder()
  for (const day of list(days)) {
    const d = typeof day?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : null
    const v = num(day?.value)
    if (d && v != null) f.add({ type, v, unit: unitOf(type), start: d, lo: num(day.min), hi: num(day.max) })
  }
  return f.readings()
}

/**
 * HealthKit's hourly statistics as readings: of a measurement taken by hand (blood pressure,
 * glucose…), and of a recent day's totals and means (catalogue.js hourlyFrom). One per hour that
 * has any, its time the hour's own, folded as an export's samples are.
 */
export function readingsFromHours(type, hours) {
  if (!TYPES[type]) return []
  const f = createFolder()
  for (const h of list(hours)) {
    const v = num(h?.value), t = num(h?.start)
    if (v != null && t != null) f.add({ type, v, unit: unitOf(type), start: localTime(t), lo: num(h.min), hi: num(h.max) })
  }
  return f.readings()
}

/** Nights of sleep as readings: minutes asleep, on the day the night ended. */
export function readingsFromSleep(nights) {
  const out = []
  for (const n of list(nights)) {
    const min = num(n?.minutes), end = num(n?.end)
    if (min == null || min <= 0 || end == null) continue
    const d = typeof n.date === 'string' ? n.date : isoOf(new Date(end))
    out.push({ type: 'sleep', v: Math.round(min), t: end, d, sid: `sleep:${d}`, src: APPLE_HEALTH })
  }
  return out
}

/** A category's samples ({ value, start, end, source }) as readings, a day at a time. */
export function readingsFromCategory(type, samples) {
  if (!TYPES[type]) return []
  const f = createFolder()
  for (const s of list(samples)) {
    const a = num(s?.start), b = num(s?.end)
    if (a != null) f.add({ type, raw: s.value, start: localTime(a), end: b == null ? null : localTime(b), source: String(s.source || '') })
  }
  return f.readings()
}

/** Workouts ({ activity, start, end, minutes, kcal, km }) as readings, one each. */
export function readingsFromWorkouts(workouts) {
  const f = createFolder()
  for (const w of list(workouts)) {
    const a = num(w?.start), b = num(w?.end)
    if (a != null) f.addWorkout({ activity: w.activity, start: localTime(a), end: b == null ? null : localTime(b), minutes: num(w.minutes), kcal: num(w.kcal), km: num(w.km) })
  }
  return f.readings()
}

// Wrapped in an object, as in lib/health-sync.js: a Capacitor plugin proxy answers `then`, so a
// promise resolved with the bare proxy never settles.
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  return { HK: registerPlugin('HealthKit') }
})().catch(() => null))

/** One type's readings from HealthKit since `start`: the query its kind calls for. */
async function readType(HK, type, start, end) {
  const x = TYPES[type]
  if (x.kind === 'sample') return readingsFromSamples(type, (await HK.querySamples({ type: x.hk, unit: nativeUnit(x.unit), start, end }))?.samples)
  if (x.kind === 'hour') return readingsFromHours(type, (await HK.queryDaily({ type: x.hk, unit: nativeUnit(x.unit), start, end, stat: 'range', hourly: true }))?.days)
  if (STAT[x.kind]) {
    // The recent days an hour at a time (catalogue.js hourlyFrom), the older ones a day at a time.
    const from = new Date(hourlyFrom(type) + 'T00:00:00').getTime()
    const ask = (a, b, hourly) => HK.queryDaily({ type: x.hk, unit: nativeUnit(x.unit), start: a, end: b, stat: STAT[x.kind], ...(hourly ? { hourly: true } : {}) })
    const out = []
    if (start < from) out.push(...readingsFromDays(type, (await ask(start, Math.min(end, from), false))?.days))
    if (end > from) out.push(...readingsFromHours(type, (await ask(Math.max(start, from), end, true))?.days))
    return out
  }
  if (x.kind === 'sleep') return readingsFromSleep((await HK.querySleep({ start, end }))?.nights)
  if (x.kind === 'wo') return readingsFromWorkouts((await HK.queryWorkouts({ start, end }))?.workouts)
  return readingsFromCategory(type, (await HK.queryCategory({ type: x.hk, start, end }))?.samples)
}

export const appleHealth = {
  id: APPLE_HEALTH,
  label: 'Apple Health',
  manageHint: 'To change what openGym may read, open the Health app, then your profile → Apps → openGym.',

  async isAvailable() {
    const p = await plugin()
    if (!p) return false
    try { return !!(await p.HK.isAvailable())?.available } catch { return false }
  },

  getAvailableDataTypes() { return Object.keys(TYPES) },

  // HealthKit refuses a whole request for one type it will not let this app read; the plugin asks
  // again without the types it names. Should the request still fail, the core types alone are
  // asked for, so weight, steps, heart rate and sleep come in whatever else is refused. Resolves
  // { asked, skipped } — `skipped` the types left out — and throws with HealthKit's own words.
  async requestPermissions(types) {
    const p = await plugin()
    if (!p) return { asked: false }
    const ids = list => [...new Set((list || []).map(t => TYPES[t]?.hk).filter(Boolean))]
    const read = ids(types)
    if (!read.length) return { asked: false }
    const typeOf = id => Object.keys(TYPES).find(k => TYPES[k].hk === id)
    try {
      const r = await p.HK.requestAuthorization({ read })
      return { asked: true, skipped: list(r?.skipped).map(typeOf).filter(Boolean) }
    } catch (e) {
      const core = (types || []).filter(t => TYPES[t]?.core)
      if (!core.length || core.length === (types || []).length) throw e
      await p.HK.requestAuthorization({ read: ids(core) })
      return { asked: true, skipped: (types || []).filter(t => !TYPES[t]?.core) }
    }
  },

  // The core types first, then a group at a time; `onBatch` gets each batch's readings as soon as
  // they are read, so a first read of years of a hundred kinds of data shows up as it goes and is
  // not lost if the app goes to the background half way.
  async fetchMeasurements({ types, since, until = Date.now(), onBatch }) {
    const p = await plugin()
    if (!p) throw Object.assign(new Error('unavailable'), { code: 'unavailable' })
    const known = (types || []).filter(t => TYPES[t])
    const batches = [known.filter(t => TYPES[t].core)]
    for (const t of known) {
      if (TYPES[t].core) continue
      const last = batches[batches.length - 1]
      if (last.length && TYPES[last[0]].group === TYPES[t].group && !TYPES[last[0]].core) last.push(t)
      else batches.push([t])
    }
    const out = []
    let asked = 0, failed = 0, firstError = null
    for (const batch of batches) {
      const got = []
      for (const type of batch) {
        const start = Number(since?.[type] ?? since) || 0
        asked++
        // One type HealthKit does not have on this iOS (a newer one) or refuses is no reason to
        // give up on the others: it reads as nothing. Every one failing is a failed read.
        try { got.push(...await readType(p.HK, type, start, until)) } catch (e) {
          if (e?.code === 'unavailable') throw e
          failed++
          firstError = firstError || e
        }
      }
      if (got.length && onBatch) onBatch(got)
      out.push(...got)
    }
    if (asked && failed === asked) throw new Error(firstError?.message || 'failed')
    return out
  },
}
