// Body-composition scales (segmental BIA, the eGym/InBody family): the QR code the scale shows
// after a measurement, read without a network.
//
// The code holds nothing but numbers: `[87.0,64.3,22.7,…]`, 63, 64 or 95 of them, one length per
// scale model (docs/BODY_SCALE_QR_IMPORT.md). The gym's own app only checks that shape and posts
// the array to its server, which knows what each position means; there is no field name in the
// code. So the raw numbers are what we keep, and what a position means comes from LAYOUTS below,
// read against what the scale and its app showed for the same measurement. A layout we do not
// know yet (63, 95) still saves the scan: once it is known, the scans already saved read with it.
//
// Every value is in the scale's own units — kg, litres, cm, kcal — whatever the profile's unit;
// scanDisplay converts at the edge, the way body measurements keep centimetres.

export const SCAN_LENGTHS = [63, 64, 95]

// Java's Float.parseFloat, which the gym app runs on each element, minus what no scale writes:
// surrounding whitespace, a sign, a decimal point, an exponent and a trailing f/d are accepted;
// NaN, Infinity and hex are not, since a saved scan must hold real numbers.
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?$/

/**
 * The numbers in a scale's QR code, or null when the text is not one: it must be `[` … `]`
 * around exactly 63, 64 or 95 comma-separated numbers, and one that does not parse throws the
 * whole code out — the gym app's rules (uk.f.c), so a code it takes is one we take.
 */
export function parseScaleQr(text) {
  const s = String(text ?? '').trim()
  if (!s.startsWith('[') || !s.endsWith(']')) return null
  const parts = s.slice(1, -1).split(',')
  if (!SCAN_LENGTHS.includes(parts.length)) return null
  const out = []
  for (const p of parts) {
    const v = p.trim()
    if (!NUM.test(v)) return null
    const n = parseFloat(v.replace(/[fFdD]$/, ''))
    if (!Number.isFinite(n)) return null
    out.push(n)
  }
  return out
}

/*
 * What each field is: `kind` picks its unit (scanUnit) and how it converts. Labels are i18n keys.
 * The segment fields carry `seg` (arm/leg/trunk, L/R) and `part` (lean/fat) for the table.
 */
export const SCAN_FIELDS = [
  { key: 'weight', label: 'Weight', kind: 'mass' },
  { key: 'fatPct', label: 'Body fat', kind: 'percent' },
  { key: 'muscleMass', label: 'Skeletal muscle mass', kind: 'mass' },
  { key: 'fatMass', label: 'Fat mass', kind: 'mass' },
  { key: 'leanMass', label: 'Lean mass', kind: 'mass' },
  { key: 'water', label: 'Body water', kind: 'litre' },
  { key: 'protein', label: 'Protein', kind: 'mass' },
  { key: 'bmi', label: 'BMI', kind: 'plain' },
  { key: 'bmr', label: 'Basal metabolic rate', kind: 'kcal' },
  { key: 'bioAge', label: 'Biological age', kind: 'years' },
  { key: 'height', label: 'Height', kind: 'cm' },
  { key: 'armRLean', seg: 'armR', part: 'lean', kind: 'mass' },
  { key: 'armLLean', seg: 'armL', part: 'lean', kind: 'mass' },
  { key: 'trunkLean', seg: 'trunk', part: 'lean', kind: 'mass' },
  { key: 'legRLean', seg: 'legR', part: 'lean', kind: 'mass' },
  { key: 'legLLean', seg: 'legL', part: 'lean', kind: 'mass' },
  { key: 'armRFat', seg: 'armR', part: 'fat', kind: 'mass' },
  { key: 'armLFat', seg: 'armL', part: 'fat', kind: 'mass' },
  { key: 'trunkFat', seg: 'trunk', part: 'fat', kind: 'mass' },
  { key: 'legRFat', seg: 'legR', part: 'fat', kind: 'mass' },
  { key: 'legLFat', seg: 'legL', part: 'fat', kind: 'mass' },
]

export const SCAN_SEGMENTS = [
  { seg: 'armL', label: 'Left arm' }, { seg: 'armR', label: 'Right arm' }, { seg: 'trunk', label: 'Trunk' },
  { seg: 'legL', label: 'Left leg' }, { seg: 'legR', label: 'Right leg' },
]

/*
 * Position → field, per code length. 64: the 21 positions checked against the gym app's screen
 * for one measurement (the plan's appendix A.1), and they add up — weight − fat = lean, the five
 * segments' fat ≈ the body's. The other 43 positions are kept, not shown, until a second
 * measurement tells the constants from the values. 63 and 95 are other layouts, unknown so far.
 */
export const LAYOUTS = {
  64: {
    weight: 0, leanMass: 1, fatMass: 2, fatPct: 3, muscleMass: 4, water: 5,
    armRLean: 19, armLLean: 20, trunkLean: 21, legRLean: 22, legLLean: 23,
    armRFat: 24, armLFat: 25, trunkFat: 26, legRFat: 27, legLFat: 28,
    protein: 34, bmr: 35, bmi: 36, height: 46, bioAge: 61,
  },
}

/** A stored scan as it should be, or null: `{ len, v }`, v being `len` finite numbers. */
export function cleanScan(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.v)) return null
  const v = raw.v.map(Number)
  if (!SCAN_LENGTHS.includes(v.length) || !v.every(Number.isFinite)) return null
  return { len: v.length, v }
}

/** Whether we know what this scan's positions mean. */
export const scanReadable = scan => !!(scan && LAYOUTS[scan.len])

/** One field of a scan, in the scale's units, or null when its layout does not have it. */
export function scanValue(scan, key) {
  const idx = scan && LAYOUTS[scan.len]?.[key]
  if (idx == null) return null
  const v = Number(scan.v?.[idx])
  if (!Number.isFinite(v) || v <= 0) return null
  if (key === 'fatPct' && v > 100) return null
  return v
}

/** Every field the scan has, `{ key: value }` in the scale's units. */
export function readScan(scan) {
  const out = {}
  for (const f of SCAN_FIELDS) {
    const v = scanValue(scan, f.key)
    if (v != null) out[f.key] = v
  }
  return out
}

const LB_PER_KG = 2.2046226218
const IN_PER_CM = 1 / 2.54
const round1 = n => Math.round(n * 10) / 10
const kindOf = key => SCAN_FIELDS.find(f => f.key === key)?.kind || 'plain'

/** The unit a field shows in, for a kg or lb profile. */
export function scanUnit(key, unit) {
  const kind = kindOf(key)
  if (kind === 'mass') return unit === 'lb' ? 'lb' : 'kg'
  if (kind === 'cm') return unit === 'lb' ? 'in' : 'cm'
  return { percent: '%', litre: 'L', kcal: 'kcal', years: '', plain: '' }[kind] ?? ''
}

/** A field's value as it shows, converted for an lb profile and rounded to a tenth. */
export function scanDisplay(key, value, unit) {
  if (value == null) return null
  const kind = kindOf(key)
  if (unit === 'lb' && kind === 'mass') return round1(value * LB_PER_KG)
  if (unit === 'lb' && kind === 'cm') return round1(value * IN_PER_CM)
  if (kind === 'kcal' || kind === 'years') return Math.round(value)
  return round1(value)
}

/** The fields worth a line on the chart, in the order they are offered. */
export const SCAN_SERIES = ['muscleMass', 'fatMass', 'leanMass', 'water', 'protein', 'bmr', 'bioAge']
