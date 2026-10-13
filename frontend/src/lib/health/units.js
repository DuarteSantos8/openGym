// Health values on screen and back. Stored values are always in the metric's canonical unit
// (lib/health/metrics.js); what is shown follows the profile:
//   mass      kg or lb — the profile's weight unit
//   height    cm, or feet and inches on a profile in pounds (as lib/measurements.js shows inches)
//   distance  km or mi — the cardio speed unit (lib/speed.js), which itself follows the weight
//             unit until the profile picks one
// Energy stays in kcal: the app has no kJ setting, and inventing one for this area alone would
// make it disagree with the rest of the app.
import { metricOf } from './metrics.js'
import { speedUnitOf } from '../speed.js'
import { t, dateLocale } from '../i18n-core.js'

export const KG_PER_LB = 0.45359237
export const CM_PER_IN = 2.54
export const KM_PER_MI = 1.609344

const imperialMass = S => S?.unit === 'lb'
const imperialDistance = S => speedUnitOf(S) === 'mph'

const roundTo = (n, dec) => { const f = 10 ** dec; return Math.round(n * f) / f }
/** A number in the app's locale with at most `dec` decimals. */
export const fmtDec = (n, dec) => roundTo(Number(n), dec).toLocaleString(dateLocale(), { maximumFractionDigits: dec })

/** The unit label shown next to a value of `type`, for this profile. */
export function displayUnit(type, S) {
  const m = metricOf(type)
  if (!m) return ''
  if (m.dim === 'mass') return imperialMass(S) ? 'lb' : 'kg'
  if (m.dim === 'height') return imperialMass(S) ? 'in' : 'cm'
  if (m.dim === 'distance') return imperialDistance(S) ? 'mi' : 'km'
  if (m.unit === 'count') return ''
  if (m.unit === 'min') return 'h'
  if (m.unit === 'years') return ''
  return m.unit
}

/** A stored value as the number the screen shows (no rounding for display beyond the metric's). */
export function toDisplay(type, v, S) {
  const m = metricOf(type)
  if (v == null || !Number.isFinite(Number(v)) || !m) return null
  let n = Number(v)
  if (m.dim === 'mass' && imperialMass(S)) n = n / KG_PER_LB
  else if (m.dim === 'height' && imperialMass(S)) n = n / CM_PER_IN
  else if (m.dim === 'distance' && imperialDistance(S)) n = n / KM_PER_MI
  return roundTo(n, Math.max(m.dec, m.dim === 'mass' ? 1 : 0))
}

/** A typed value back into the canonical unit; null for anything that is not a number. */
export function fromDisplay(type, v, S) {
  const m = metricOf(type)
  if (v == null || v === '' || !Number.isFinite(Number(v)) || !m) return null
  let n = Number(v)
  if (m.dim === 'mass' && imperialMass(S)) n = n * KG_PER_LB
  else if (m.dim === 'height' && imperialMass(S)) n = n * CM_PER_IN
  else if (m.dim === 'distance' && imperialDistance(S)) n = n * KM_PER_MI
  // Two more decimals than shown: a value typed in pounds comes back as typed.
  return roundTo(n, Math.max(m.dec, 1) + 2)
}

/** Minutes as "7 h 32 min". */
export function fmtMinutes(min) {
  const total = Math.round(Number(min) || 0)
  const h = Math.floor(total / 60), m = total % 60
  if (!h) return t('{0} min', m)
  return m ? t('{0} h {1} min', h, m) : t('{0} h', h)
}

/** Centimetres as 5′ 11″. */
export function fmtFeetInches(cm) {
  const inches = Math.round(Number(cm) / CM_PER_IN)
  return `${Math.floor(inches / 12)}′ ${inches % 12}″`
}

/**
 * A stored value as text with its unit, the way a card or a history row shows it: sleep in hours
 * and minutes, height in feet and inches on an imperial profile, everything else as a number and
 * the unit of displayUnit.
 */
export function fmtHealth(type, v, S, { unit = true } = {}) {
  const m = metricOf(type)
  if (!m || v == null || !Number.isFinite(Number(v))) return '–'
  if (m.unit === 'min') return fmtMinutes(v)
  if (m.dim === 'height' && imperialMass(S)) return fmtFeetInches(v)
  const n = toDisplay(type, v, S)
  const shown = fmtDec(n, m.dec)
  const u = displayUnit(type, S)
  return unit && u ? `${shown} ${u}` : shown
}

/** A change between two stored values, signed, as text ("+0.4 kg", "−1 200"). */
export function fmtHealthDelta(type, delta, S) {
  const m = metricOf(type)
  if (!m || delta == null || !Number.isFinite(delta)) return ''
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : ''
  if (m.unit === 'min') return sign + fmtMinutes(Math.abs(delta))
  if (m.dim === 'height' && imperialMass(S)) {
    const inches = roundTo(Math.abs(delta) / CM_PER_IN, 1)
    return `${sign}${fmtDec(inches, 1)} in`
  }
  return sign + fmtHealth(type, Math.abs(delta), S)
}

/** The chart's value for a stored number: the display number, sleep in hours. */
export function chartValue(type, v, S) {
  const m = metricOf(type)
  if (m?.unit === 'min') return roundTo(Number(v) / 60, 2)
  return toDisplay(type, v, S)
}
