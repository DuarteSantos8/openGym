// How long a cardio interval is: a time, a distance or a calorie count, one of the three, chosen
// in the exercise's settings.
//
// A timed interval is minutes at a speed, as every cardio set always was: { min: 20, speed: 8 }.
// A distance one carries `km` and no minutes: { km: 2, speed: 12 }, the slot { sets: 4, km: 0.5 }.
// A calorie one carries `kcal` and no minutes (lib/calories.js). The slot says which by the key it
// carries, calories first, then distance, whatever default minutes it may still hold. Distance
// is stored in km, always, like speed in km/h (lib/speed.js), and shown in miles when the profile
// reads mph. An older app that does not know a key leaves it alone (api/sync-stamps.js keepKeys).
import { fmtNum } from './format.js'
import { KMH_PER_MPH } from './speed.js'
import { clampKcal, hasKcal } from './calories.js'

export const LENGTHS = ['min', 'km', 'kcal']

// A marathon is 42 km and an ultra on a treadmill is not; 500 km in one set is a typo.
export const KM_MAX = 500
export const KM_STEP = 0.5

/** A typed or stepped distance as it is stored: km to the metre, above 0; nothing stays nothing. */
export function clampKm(v) {
  if (v == null || v === '') return null
  const n = Math.round(Number(v) * 1000) / 1000
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(KM_MAX, n)
}

/** Whether a set (or a slot) carries a distance. */
export const hasKm = s => clampKm(s?.km) != null

/** How a cardio slot (or a session's target) measures its intervals: 'kcal', 'km' or 'min'. */
export const lengthOf = cfg => (hasKcal(cfg) ? 'kcal' : hasKm(cfg) ? 'km' : 'min')

/**
 * How a logged cardio set was measured: by its minutes when it has any (every set logged before
 * there was a choice), else by its count or its distance.
 */
export const setLengthOf = s => (Number(s?.min) > 0 ? 'min' : hasKcal(s) ? 'kcal' : hasKm(s) ? 'km' : 'min')

/**
 * A new cardio row for a slot: its length in the slot's own measure, last time's when last time
 * was measured the same way, else the plan's. Speed and incline are the caller's, as before.
 */
export function cardioLength(cfg, prev) {
  const want = lengthOf(cfg)
  const same = prev != null && setLengthOf(prev) === want
  if (want === 'kcal') return { kcal: clampKcal(same ? prev.kcal : cfg.kcal) }
  if (want === 'km') return { km: clampKm(same ? prev.km : cfg.km) }
  return { min: same && Number(prev.min) > 0 ? prev.min : (cfg?.min || 20) }
}

/** The distance unit that goes with the profile's speed unit: 'mi' with mph, else 'km'. */
export const distUnitOf = speedUnit => (speedUnit === 'mph' ? 'mi' : 'km')

/** Stored km to the unit on screen and back, kept to the metre in km (see toSpeed). */
export function toDist(km, speedUnit) {
  if (speedUnit !== 'mph' || km == null || km === '' || !Number.isFinite(Number(km))) return km
  return Math.round(Number(km) / KMH_PER_MPH * 100) / 100
}
export function fromDist(value, speedUnit) {
  if (speedUnit !== 'mph' || value == null || value === '' || !Number.isFinite(Number(value))) return value
  return Math.round(Number(value) * KMH_PER_MPH * 1000) / 1000
}

/** "2.5 km" or "1.55 mi": a stored distance, shown in the speed unit's distance. */
export const fmtDist = (km, speedUnit) => `${fmtNum(toDist(Number(km) || 0, speedUnit))} ${distUnitOf(speedUnit)}`
