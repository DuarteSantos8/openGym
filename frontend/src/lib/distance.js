// Cardio distance (#887). A bike or a rower that shows the distance at the end, not a steady
// speed: the set takes the distance, and the speed follows from it and the minutes.
//
// A set logged by distance keeps `km` (always kilometres, like speed is always km/h, lib/speed.js)
// and its `speed` is worked out from km and minutes, so everything that already reads speed and
// minutes (stats, the CSV, the FIT file, Apple Health and Health Connect, the Coach) gets the same
// distance without knowing about it. A set logged by speed has no `km`; its distance is speed ×
// time, as before. Which one a cardio exercise is logged by is the profile's choice per exercise,
// S.cardioBy[exId] = 'distance' (absent: speed).
import { KMH_PER_MPH, speedUnitOf } from './speed.js'
import { fmtNum } from './format.js'

/** The distance unit on screen: miles with an mph profile, kilometres otherwise. */
export const distUnitOf = S => (speedUnitOf(S) === 'mph' ? 'mi' : 'km')
export const distLabel = unit => (unit === 'mi' ? 'mi' : 'km')

/** Whether this exercise's cardio sets are logged by distance. */
export const byDistance = (S, exId) => !!(S?.cardioBy && S.cardioBy[exId] === 'distance')

/** S.cardioBy with `exId` logged by distance, or back on speed (the key goes). */
export function withCardioBy(map, exId, by) {
  const out = { ...(map && typeof map === 'object' && !Array.isArray(map) ? map : {}) }
  if (by === 'distance') out[exId] = 'distance'
  else delete out[exId]
  return out
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d

/** Kilometres to the unit on screen and back, to ten metres (a hundredth of a mile). */
export const toDist = (km, unit) => (km == null || km === '' || !Number.isFinite(Number(km)) ? km : round(unit === 'mi' ? Number(km) / KMH_PER_MPH : Number(km), 2))
export const fromDist = (v, unit) => (v == null || v === '' || !Number.isFinite(Number(v)) ? v : round(unit === 'mi' ? Number(v) * KMH_PER_MPH : Number(v), 4))

/** A set's distance in km: its own when logged by distance, else speed × time. */
export function distanceKmOf(s) {
  if (Number(s?.km) > 0) return Number(s.km)
  const min = Number(s?.min) || 0, speed = Number(s?.speed) || 0
  return speed > 0 && min > 0 ? speed * min / 60 : 0
}

/**
 * The set with its speed worked out from its distance and minutes (km/h, to hundredths). Called
 * whenever either of them changes on a set that has a distance. Mutates and returns `s`.
 */
export function settleSpeed(s) {
  const km = Number(s?.km) || 0, min = Number(s?.min) || 0
  if (km > 0 && min > 0) s.speed = round(km / (min / 60), 2)
  else if (km > 0) s.speed = 0
  return s
}

/** A set's distance, shown: "5 km", "3.1 mi". */
export const fmtDist = (km, unit) => `${fmtNum(toDist(km, unit))} ${distLabel(unit)}`

/** The pace of a set, "6:00 /km": minutes per kilometre or mile. Empty without both numbers. */
export function fmtPace(s, unit) {
  const d = toDist(distanceKmOf(s), unit), min = Number(s?.min) || 0
  if (!(d > 0) || !(min > 0)) return ''
  const sec = Math.round(min * 60 / d)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /${distLabel(unit)}`
}

export { speedUnitOf }
