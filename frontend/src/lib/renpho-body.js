// What Body measurements shows of RENPHO (components/RenphoBodyCard.jsx): the server keeps the
// scale's readings (api/providers/renpho) and answers GET /api/renpho/summary with, per kind, the
// latest value and its change over about a month. This file knows how each kind reads: its name,
// unit and decimals, in the order the card lists them, and which kinds are the segmental analysis.
// The names of the kinds Apple Health also has are the same keys as components/HealthBodyCard.jsx.
//
// Values arrive in the canonical units of api/providers/renpho/composition.js: kg, %, kcal,
// years; segmental values in the scale's own unit (shown as they came).
import { LB_PER_KG } from './health-read.js'

// [type, label, unit]: unit 'mass' follows the profile's kg/lb.
const KINDS = [
  ['bodyFat', 'Body fat', '%'],
  ['fatMass', 'Fat mass', 'mass'],
  ['muscleMass', 'Muscle mass', 'mass'],
  ['skeletalMuscle', 'Skeletal muscle', '%'],
  ['leanMass', 'Lean mass', 'mass'],
  ['bodyWater', 'Body water', '%'],
  ['boneMass', 'Bone mass', 'mass'],
  ['protein', 'Protein', '%'],
  ['visceralFat', 'Visceral fat', ''],
  ['subcutaneousFat', 'Subcutaneous fat', '%'],
  ['bmr', 'Basal metabolic rate', 'kcal'],
  ['metabolicAge', 'Metabolic age', 'years'],
]
export const RENPHO_KINDS = KINDS.map(([type, label, unit]) => ({ type, label, unit }))
const BY_TYPE = new Map(RENPHO_KINDS.map(k => [k.type, k]))
/** A kind's name (an English key for t()), or null for one the card does not list. */
export const renphoLabel = type => BY_TYPE.get(type)?.label || null
// What else a reading may carry, named in Settings' "Values received" (the weight goes to the
// weigh-ins through the phone's health store, not on this card).
const OTHER = { weight: 'Weight', bmi: 'BMI', heartRate: 'Heart rate' }
/** The name of any value RENPHO sent, for Settings; null for a segmental or technical one. */
export const renphoFieldLabel = type => renphoLabel(type) || OTHER[type] || null

/** One value as the card shows it: { v, unit } in the profile's weight unit, rounded. */
export function renphoValue(type, v, weightUnit) {
  const k = BY_TYPE.get(type)
  if (!k) return null
  if (k.unit === 'mass') {
    const lb = weightUnit === 'lb'
    return { v: Math.round((lb ? v * LB_PER_KG : v) * 10) / 10, unit: lb ? 'lb' : 'kg' }
  }
  if (k.unit === 'kcal') return { v: Math.round(v), unit: 'kcal' }
  // An age reads as a number of years without saying so ("Metabolic age 34").
  if (k.unit === 'years') return { v: Math.round(v), unit: '' }
  return { v: Math.round(v * 10) / 10, unit: k.unit }
}

/** The summary's items the card lists, in its order. */
export function renphoRows(items) {
  const got = new Map((Array.isArray(items) ? items : []).map(x => [x.type, x]))
  return RENPHO_KINDS.filter(k => got.has(k.type) && Number.isFinite(got.get(k.type).v)).map(k => got.get(k.type))
}

// Segmental analysis: fat and muscle per limb and the trunk, impedance at 20 and 100 kHz
// (type names as api/providers/renpho/composition.js segType makes them).
export const SEGMENTS = ['leftArm', 'rightArm', 'trunk', 'leftLeg', 'rightLeg']
export const segType = (kind, part) => kind + part.charAt(0).toUpperCase() + part.slice(1)
const SEG = /^(segFat|segMuscle|imp20|imp100)/

/** The segmental values of the summary, { t, values: { type: v } }, or null when there are none. */
export function renphoSegments(items) {
  const values = {}
  let t = 0
  for (const x of Array.isArray(items) ? items : []) {
    if (!SEG.test(x?.type) || !Number.isFinite(x.v)) continue
    values[x.type] = x.v
    t = Math.max(t, x.t || 0)
  }
  return Object.keys(values).length ? { t, values } : null
}
