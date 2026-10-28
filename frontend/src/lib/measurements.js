// Canonical storage: lengths in cm, masses in kg, percentages and plain numbers as-is. A custom
// field's unit selects its display unit ('none' is a score or a count with no unit at all).
// Legacy fields without one still follow the profile's cm/in choice.

export const MEASUREMENT_FIELDS = [
  { key: 'neck', label: 'Neck', group: 'Torso' },
  { key: 'shoulders', label: 'Shoulders', group: 'Torso' },
  { key: 'chest', label: 'Chest', group: 'Torso' },
  { key: 'waist', label: 'Waist', group: 'Torso' },
  { key: 'hips', label: 'Hips', group: 'Torso' },
  { key: 'abdomen', label: 'Abdomen', group: 'Torso', optional: true },
  { key: 'upperArmLeft', label: 'Left upper arm', group: 'Arms' },
  { key: 'upperArmRight', label: 'Right upper arm', group: 'Arms' },
  { key: 'forearmLeft', label: 'Left forearm', group: 'Arms' },
  { key: 'forearmRight', label: 'Right forearm', group: 'Arms' },
  { key: 'wristLeft', label: 'Left wrist', group: 'Arms', optional: true },
  { key: 'wristRight', label: 'Right wrist', group: 'Arms', optional: true },
  { key: 'thighLeft', label: 'Left thigh', group: 'Legs' },
  { key: 'thighRight', label: 'Right thigh', group: 'Legs' },
  { key: 'calfLeft', label: 'Left calf', group: 'Legs' },
  { key: 'calfRight', label: 'Right calf', group: 'Legs' },
  { key: 'ankleLeft', label: 'Left ankle', group: 'Legs', optional: true },
  { key: 'ankleRight', label: 'Right ankle', group: 'Legs', optional: true },
  { key: 'bodyFat', label: 'Body fat', group: 'Other', kind: 'percent', optional: true },
]

export const MEASUREMENT_KEYS = MEASUREMENT_FIELDS.map(f => f.key)
export const DEFAULT_MEASUREMENT_KEYS = MEASUREMENT_FIELDS.filter(f => !f.optional).map(f => f.key)

const round = n => Math.round(n * 10) / 10
const valid = (v, unit) => v != null && v !== '' && Number.isFinite(+v) &&
  (unit === '%' ? +v >= 0 && +v <= 100 : unit === 'none' ? +v >= 0 : +v > 0)
  ? (unit === 'kg' || unit === 'lb' ? Math.round(+v * 1000) / 1000 : round(+v)) : null
const LB_PER_KG = 2.2046226218
export const CUSTOM_MEASUREMENT_UNITS = ['cm', 'in', '%', 'kg', 'lb', 'none']
const unitOf = field => CUSTOM_MEASUREMENT_UNITS.includes(field?.unit) ? field.unit : null
const withUnit = field => unitOf(field) ? { unit: field.unit } : {}
const unitKind = unit => unit === '%' ? 'percent' : unit === 'none' ? 'none' : unit === 'kg' || unit === 'lb' ? 'mass' : 'length'
// What goes after the number: nothing for a unitless field.
export const measurementUnitLabel = unit => unit === 'none' ? '' : unit
// A unit where 0 is a reading, not an empty field: 0 % or a score of 0.
export const zeroIsReading = unit => unit === '%' || unit === 'none'

export const measurementUnit = (unit, field) => field?.key === 'bodyFat' ? '%' : unitOf(field) || (unit === 'lb' ? 'in' : 'cm')
export const toMeasurementDisplay = (value, unit, field) => {
  if (value == null) return null
  const display = measurementUnit(unit, field)
  return round(display === 'in' ? value / 2.54 : display === 'lb' ? value * LB_PER_KG : value)
}
export const fromMeasurementDisplay = (value, unit, field) => {
  const display = measurementUnit(unit, field)
  return valid(display === 'in' && value != null ? +value * 2.54 : display === 'lb' && value != null ? +value / LB_PER_KG : value, display)
}

// A unit change can convert cm/in or kg/lb, but cannot turn recorded lengths into percentages.
// An empty custom field may still choose any type. Readings keep a unit for orphaned backups.
export function customMeasurementUnits(field, entries = []) {
  const logged = entries.flatMap(e => e.other || []).filter(o => o.id === field.id && o.value != null)
  if (!logged.length) return CUSTOM_MEASUREMENT_UNITS
  const kinds = [...new Set(logged.map(o => unitKind(unitOf(o) || unitOf(field))))]
  return CUSTOM_MEASUREMENT_UNITS.filter(unit => kinds.every(kind => kind === unitKind(unit)))
}

export function emptyMeasurement(date, custom = []) {
  const entry = { d: date, t: new Date(date + 'T12:00:00').getTime() }
  for (const key of MEASUREMENT_KEYS) entry[key] = null
  entry.other = custom.map(c => ({ id: c.id, name: c.name, value: null, ...withUnit(c) }))
  return entry
}

// Complete old or partial entries into the stable schema. Unknown custom values are preserved:
// a backup must not lose history merely because its custom-field definition is absent.
export function normalizeMeasurementEntry(raw = {}, custom = []) {
  const entry = emptyMeasurement(raw.d || '', custom)
  entry.t = Number.isFinite(+raw.t) ? +raw.t : entry.t
  for (const key of MEASUREMENT_KEYS) entry[key] = valid(raw[key], key === 'bodyFat' ? '%' : null)

  const known = new Map(custom.map(c => [c.id, c]))
  const seen = new Set()
  entry.other = (Array.isArray(raw.other) ? raw.other : []).map(o => {
    if (!o || !o.id || seen.has(o.id)) return null
    seen.add(o.id)
    const field = known.get(o.id)
    const unit = unitOf(o) || unitOf(field)
    return { id: String(o.id), name: String(field?.name || o.name || 'Other'), value: valid(o.value, unit), ...withUnit({ unit }) }
  }).filter(Boolean)
  for (const c of custom) if (!seen.has(c.id)) entry.other.push({ id: c.id, name: c.name, value: null, ...withUnit(c) })
  return entry
}

// Fold a second entry for a date into the first. The later reading wins per field, but a field
// it left empty keeps the earlier value — two partial rows on one date are two halves of the
// same check-in, not a reason to throw one away.
function mergeMeasurementEntries(a, b) {
  const entry = { ...a, t: b.t }
  for (const key of MEASUREMENT_KEYS) entry[key] = b[key] ?? a[key]
  const other = new Map(a.other.map(o => [o.id, o]))
  for (const o of b.other) {
    const prev = other.get(o.id)
    // An empty later reading must not replace the unit attached to the value we keep.
    other.set(o.id, prev && o.value == null ? { ...prev, name: o.name } : o)
  }
  entry.other = [...other.values()]
  return entry
}

export function normalizeMeasurementsState(state) {
  const rawCustom = Array.isArray(state.customMeasurements) ? state.customMeasurements : []
  const ids = new Set()
  state.customMeasurements = rawCustom.map(c => {
    if (!c || !c.id || !String(c.name || '').trim() || ids.has(String(c.id))) return null
    const id = String(c.id); ids.add(id)
    return { id, name: String(c.name).trim().slice(0, 60), enabled: c.enabled !== false, ...withUnit(c) }
  }).filter(Boolean)

  const enabled = Array.isArray(state.measurementEnabled) ? state.measurementEnabled : DEFAULT_MEASUREMENT_KEYS
  state.measurementEnabled = [...new Set(enabled.filter(k => MEASUREMENT_KEYS.includes(k)))]
  const entries = (Array.isArray(state.measurements) ? state.measurements : [])
    .filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.d || ''))
    .map(e => normalizeMeasurementEntry(e, state.customMeasurements))
    .sort((a, b) => a.d.localeCompare(b.d) || a.t - b.t)

  // One entry per date is what the logging form enforces and what every reader assumes — the
  // history keys on the date, editing looks up by it and deleting filters by it. State that
  // never went through the form (an imported backup, a sync from another client) can still
  // carry two rows for a day, so they are folded here rather than left to surface as a
  // duplicate React key and an edit that silently drops the other row.
  const byDate = new Map()
  for (const entry of entries) {
    const prev = byDate.get(entry.d)
    byDate.set(entry.d, prev ? mergeMeasurementEntries(prev, entry) : entry)
  }
  state.measurements = [...byDate.values()]
  return state
}

export function measurementValue(entry, key) {
  if (!entry) return null
  if (!key.startsWith('other:')) return valid(entry[key], key === 'bodyFat' ? '%' : null)
  const row = (entry.other || []).find(o => o.id === key.slice(6))
  return valid(row?.value, unitOf(row))
}

// Order comes from MEASUREMENT_FIELDS, not from measurementEnabled: that array is a set the
// toggles append to, so reading it in stored order would move a field to the end of the logging
// form the moment you switched it off and on again, interleaving the Torso/Arms/Legs groups.
export function enabledMeasurementFields(state) {
  const enabled = new Set(state.measurementEnabled || DEFAULT_MEASUREMENT_KEYS)
  const builtins = MEASUREMENT_FIELDS.filter(f => enabled.has(f.key))
  const custom = (state.customMeasurements || []).filter(c => c.enabled !== false)
    .map(c => ({ key: 'other:' + c.id, label: c.name, group: 'Other', custom: true, ...withUnit(c) }))
  return [...builtins, ...custom]
}

export function measurementSeries(state, key, range = 0, now = Date.now()) {
  const cutoff = range ? now - range * 86400000 : -Infinity
  const unit = state.unit || 'kg'
  const field = key.startsWith('other:')
    ? (state.customMeasurements || []).find(c => c.id === key.slice(6)) || { key }
    : { key }
  return (state.measurements || []).map(entry => {
    const raw = measurementValue(entry, key)
    const at = new Date(entry.d + 'T12:00:00').getTime()
    if (raw == null || at < cutoff) return null
    const stored = key.startsWith('other:') ? entry.other?.find(o => o.id === key.slice(6)) : null
    // An incomplete backup may retain a reading without its custom definition.
    const displayField = unitOf(field) ? field : { ...field, ...withUnit(stored) }
    if (stored && unitKind(unitOf(stored) || unitOf(field)) !== unitKind(unitOf(displayField))) return null
    return { t: at, d: entry.d, y: toMeasurementDisplay(raw, unit, displayField) }
  }).filter(Boolean)
}

export function latestMeasurement(state, key) {
  for (let i = (state.measurements || []).length - 1; i >= 0; i--) {
    const value = measurementValue(state.measurements[i], key)
    if (value != null) return { entry: state.measurements[i], value }
  }
  return null
}

export function measurementEntryHasValues(entry) {
  return MEASUREMENT_KEYS.some(k => valid(entry?.[k], k === 'bodyFat' ? '%' : null) != null) ||
    (entry?.other || []).some(o => valid(o?.value, unitOf(o)) != null)
}

// ---- CSV columns (lib/export-csv.js bodyCSV, read back by lib/import-csv.js parseBodyweight) ----
// A built-in field is a fixed snake_case column in cm (body fat in percent). A custom field's
// column is its name with its unit in brackets, "Muscle ratio (%)", its values in that unit; a
// legacy field without a unit stores cm, so its column says cm. A unitless field is its bare name.
export const builtinCsvColumn = f => f.kind === 'percent' ? 'body_fat_percent' : f.key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()) + '_cm'
export const customCsvColumn = (name, unit) => unit === 'none' ? name : `${name} (${unitOf({ unit }) || 'cm'})`
export function parseCustomCsvColumn(header) {
  const h = String(header ?? '').trim()
  const m = /^(.*\S)\s*\((cm|in|%|kg|lb)\)$/.exec(h)
  return m ? { name: m[1], unit: m[2] } : { name: h, unit: 'none' }
}
// A value in a column's unit, into canonical storage (cm, kg, percent or the plain number).
export const fromCsvUnit = (v, unit) => unit === 'in' ? v * 2.54 : unit === 'lb' ? v / LB_PER_KG : v
// Whether readings in `a` can be shown in `b` (cm and in, kg and lb), with a legacy field's
// missing unit counting as a length.
export const sameMeasurementKind = (a, b) => unitKind(unitOf({ unit: a })) === unitKind(unitOf({ unit: b }))
// A custom reading as the field shows it: in the field's unit, or cm for a legacy field.
export const customDisplayValue = (value, unit) => unitOf({ unit }) ? toMeasurementDisplay(value, 'kg', { unit }) : value
