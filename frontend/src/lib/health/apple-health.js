// Apple Health, on the iOS app: a HealthDataProvider (providers.js) over the local HealthKit
// plugin (ios/App/App/HealthKitPlugin.swift). Read-only — openGym writes nothing to Apple Health.
//
// HealthKit never tells an app whether the user allowed reading a type: a type they did not allow
// simply has no samples. So "connected" here means "asked, and the user chose", and an empty
// result is never treated as an error or as a reason to delete anything.
//
// What is read, and how:
//   - body readings (weight, body fat, lean mass, BMI, height): every sample, with its UUID
//   - a day's totals (steps, distance, active and resting energy): HealthKit's own daily
//     statistics, which already leave out the overlap of an iPhone and a Watch counting the same
//     steps; one reading per day, recomputed until the day is over
//   - heart rate: the day's mean, lowest and highest; resting heart rate: the day's mean
//   - sleep: the minutes asleep of each night, given to the day it ended on
// Thousands of heart-rate samples a day would not fit the synced profile (the server takes 5 MB
// per document), which is why everything but body readings arrives a day at a time.
import { MOBILE } from '../mobile.js'
import { isoOf } from '../format.js'

export const APPLE_HEALTH = 'apple-health'

// Per metric: the HealthKit identifier, the unit string HKUnit(from:) reads, how it is queried,
// and the factor to the metric's canonical unit (HealthKit's percent is a fraction of 1).
// A metric added to the health area becomes readable from Apple Health with one line here.
export const HK_TYPES = {
  weight: { id: 'HKQuantityTypeIdentifierBodyMass', unit: 'kg', query: 'samples' },
  bodyFat: { id: 'HKQuantityTypeIdentifierBodyFatPercentage', unit: '%', query: 'samples', scale: 100 },
  leanMass: { id: 'HKQuantityTypeIdentifierLeanBodyMass', unit: 'kg', query: 'samples' },
  bmi: { id: 'HKQuantityTypeIdentifierBodyMassIndex', unit: 'count', query: 'samples' },
  height: { id: 'HKQuantityTypeIdentifierHeight', unit: 'cm', query: 'samples' },
  heartRate: { id: 'HKQuantityTypeIdentifierHeartRate', unit: 'count/min', query: 'daily', stat: 'range' },
  restingHeartRate: { id: 'HKQuantityTypeIdentifierRestingHeartRate', unit: 'count/min', query: 'daily', stat: 'avg' },
  steps: { id: 'HKQuantityTypeIdentifierStepCount', unit: 'count', query: 'daily', stat: 'sum' },
  distance: { id: 'HKQuantityTypeIdentifierDistanceWalkingRunning', unit: 'km', query: 'daily', stat: 'sum' },
  activeEnergy: { id: 'HKQuantityTypeIdentifierActiveEnergyBurned', unit: 'kcal', query: 'daily', stat: 'sum' },
  restingEnergy: { id: 'HKQuantityTypeIdentifierBasalEnergyBurned', unit: 'kcal', query: 'daily', stat: 'sum' },
  sleep: { id: 'HKCategoryTypeIdentifierSleepAnalysis', query: 'sleep' },
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
const round = (n, dec = 2) => { const f = 10 ** dec; return Math.round(n * f) / f }

/** HealthKit samples of one quantity type as readings: one per sample, keyed by its UUID. */
export function readingsFromSamples(type, samples) {
  const spec = HK_TYPES[type]
  if (!spec) return []
  const out = []
  for (const s of Array.isArray(samples) ? samples : []) {
    const v = num(s?.value), t = num(s?.start)
    if (v == null || t == null || !s?.id) continue
    out.push({ type, v: round(v * (spec.scale || 1), 3), t, sid: String(s.id), src: APPLE_HEALTH })
  }
  return out
}

/**
 * HealthKit's daily statistics of one type as readings: one per day that has any, keyed by the
 * type and the day, so the next fetch of a day that went on replaces it instead of adding to it.
 */
export function readingsFromDays(type, days) {
  const spec = HK_TYPES[type]
  if (!spec) return []
  const out = []
  for (const day of Array.isArray(days) ? days : []) {
    const d = typeof day?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date) ? day.date : null
    const v = num(day?.value)
    if (!d || v == null) continue
    // A day with nothing counted (0 steps on a phone left in a drawer) is not a reading.
    if (spec.stat === 'sum' && v <= 0) continue
    const r = { type, v: round(v, spec.unit === 'count' ? 0 : 2), t: Date.parse(d + 'T12:00:00Z'), d, sid: `${type}:${d}`, src: APPLE_HEALTH }
    if (num(day.min) != null) r.lo = round(Number(day.min), 0)
    if (num(day.max) != null) r.hi = round(Number(day.max), 0)
    out.push(r)
  }
  return out
}

/** Nights of sleep as readings: minutes asleep, on the day the night ended. */
export function readingsFromSleep(nights) {
  const out = []
  for (const n of Array.isArray(nights) ? nights : []) {
    const min = num(n?.minutes), end = num(n?.end)
    if (min == null || min <= 0 || end == null) continue
    const d = typeof n.date === 'string' ? n.date : isoOf(new Date(end))
    out.push({ type: 'sleep', v: Math.round(min), t: end, d, sid: `sleep:${d}`, src: APPLE_HEALTH })
  }
  return out
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

export const appleHealth = {
  id: APPLE_HEALTH,
  label: 'Apple Health',
  manageHint: 'To change what openGym may read, open the Health app, then your profile → Apps → openGym.',

  async isAvailable() {
    const p = await plugin()
    if (!p) return false
    try { return !!(await p.HK.isAvailable())?.available } catch { return false }
  },

  getAvailableDataTypes() { return Object.keys(HK_TYPES) },

  async requestPermissions(types) {
    const p = await plugin()
    if (!p) return { asked: false }
    const read = [...new Set((types || []).map(t => HK_TYPES[t]?.id).filter(Boolean))]
    if (!read.length) return { asked: false }
    await p.HK.requestAuthorization({ read })
    return { asked: true }
  },

  async fetchMeasurements({ types, since, until = Date.now() }) {
    const p = await plugin()
    if (!p) throw Object.assign(new Error('unavailable'), { code: 'unavailable' })
    const out = []
    for (const type of types || []) {
      const spec = HK_TYPES[type]
      if (!spec) continue
      const start = Number(since?.[type] ?? since) || 0
      if (spec.query === 'samples') {
        const r = await p.HK.querySamples({ type: spec.id, unit: spec.unit, start, end: until })
        out.push(...readingsFromSamples(type, r?.samples))
      } else if (spec.query === 'daily') {
        const r = await p.HK.queryDaily({ type: spec.id, unit: spec.unit, start, end: until, stat: spec.stat })
        out.push(...readingsFromDays(type, r?.days))
      } else if (spec.query === 'sleep') {
        const r = await p.HK.querySleep({ start, end: until })
        out.push(...readingsFromSleep(r?.nights))
      }
    }
    return out
  },
}
