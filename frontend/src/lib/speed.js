// Cardio speed in km/h or mph (Discord "miles per hour").
//
// Speed is stored in km/h, always: in a routine, in a logged set, in a shared plan file and in
// what the Coach and the MCP bridge read. Only what is shown and what is typed follow the
// profile's speed unit. Switching the unit therefore rewrites nothing, two devices on different
// settings never disagree about a number, and a plan shared between a km/h and an mph profile
// needs no conversion. The weight unit works the other way round (lib/units.js walks every
// stored weight), because a load has to land on plates in the unit you load; a speed does not.
import { fmtNum } from './format.js'

// Exact: the international mile is 1609.344 m.
export const KMH_PER_MPH = 1.609344

/**
 * The unit speeds are shown in: 'kmh' or 'mph'. Until the profile chooses one (Settings →
 * General) it follows the weight unit — a profile in pounds reads mph — so imperial users get
 * miles without looking for a setting, and a kg lifter on an mph treadmill can still pick it.
 */
export const speedUnitOf = S => (S?.speedUnit === 'mph' || S?.speedUnit === 'kmh' ? S.speedUnit : S?.unit === 'lb' ? 'mph' : 'kmh')

/** The unit's short label, as the numbers carry it: "km/h" or "mph". */
export const speedLabel = unit => (unit === 'mph' ? 'mph' : 'km/h')

/*
 * km/h to the unit on screen and back. In km/h both are the identity, so a profile that never
 * chose mph sees and stores exactly what it always did. In mph the stored km/h is kept to
 * hundredths: that is fine enough that any speed typed in mph with up to two decimals reads
 * back as typed (the stored value is at most 0.005 km/h, 0.0031 mph, off, and the display
 * rounds to hundredths), and it keeps a typed "6" from being stored as 9.656064.
 */
export function toSpeed(kmh, unit) {
  if (unit !== 'mph' || kmh == null || kmh === '' || !Number.isFinite(Number(kmh))) return kmh
  return Math.round(Number(kmh) / KMH_PER_MPH * 100) / 100
}
export function fromSpeed(value, unit) {
  if (unit !== 'mph' || value == null || value === '' || !Number.isFinite(Number(value))) return value
  return Math.round(Number(value) * KMH_PER_MPH * 100) / 100
}

/** "8 km/h" or "5 mph" — a stored km/h speed, shown in `unit`. */
export const fmtSpeed = (kmh, unit) => `${fmtNum(toSpeed(Number(kmh) || 0, unit))} ${speedLabel(unit)}`
