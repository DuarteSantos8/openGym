// Body measurements are stored in centimetres, regardless of the profile's weight unit.
// Keeping one canonical unit means changing kg/lb never relabels old circumference values as
// something they are not. The UI converts at its edge: kg profiles see cm, lb profiles see in.

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
const valid = v => Number.isFinite(+v) && +v > 0 ? round(+v) : null

export const measurementUnit = unit => unit === 'lb' ? 'in' : 'cm'
export const toMeasurementDisplay = (cm, unit) => cm == null ? null : round(unit === 'lb' ? cm / 2.54 : cm)
export const fromMeasurementDisplay = (value, unit) => value == null ? null : valid(unit === 'lb' ? +value * 2.54 : +value)

export function emptyMeasurement(date, custom = []) {
  const entry = { d: date, t: new Date(date + 'T12:00:00').getTime() }
  for (const key of MEASUREMENT_KEYS) entry[key] = null
  entry.other = custom.map(c => ({ id: c.id, name: c.name, value: null }))
  return entry
}

// Complete old or partial entries into the stable schema. Unknown custom values are preserved:
// a backup must not lose history merely because its custom-field definition is absent.
export function normalizeMeasurementEntry(raw = {}, custom = []) {
  const entry = emptyMeasurement(raw.d || '', custom)
  entry.t = Number.isFinite(+raw.t) ? +raw.t : entry.t
  for (const key of MEASUREMENT_KEYS) entry[key] = valid(raw[key])
  if (entry.bodyFat != null && entry.bodyFat > 100) entry.bodyFat = null

  const known = new Map(custom.map(c => [c.id, c]))
  const seen = new Set()
  entry.other = (Array.isArray(raw.other) ? raw.other : []).map(o => {
    if (!o || !o.id || seen.has(o.id)) return null
    seen.add(o.id)
    return { id: String(o.id), name: String(known.get(o.id)?.name || o.name || 'Other'), value: valid(o.value) }
  }).filter(Boolean)
  for (const c of custom) if (!seen.has(c.id)) entry.other.push({ id: c.id, name: c.name, value: null })
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
    other.set(o.id, prev ? { ...o, value: o.value ?? prev.value } : o)
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
    return { id, name: String(c.name).trim().slice(0, 60), enabled: c.enabled !== false }
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
  if (!key.startsWith('other:')) return valid(entry[key])
  return valid((entry.other || []).find(o => o.id === key.slice(6))?.value)
}

export function measurementLabel(key, custom = []) {
  if (key.startsWith('other:')) return custom.find(c => c.id === key.slice(6))?.name || 'Other'
  return MEASUREMENT_FIELDS.find(f => f.key === key)?.label || key
}

// Order comes from MEASUREMENT_FIELDS, not from measurementEnabled: that array is a set the
// toggles append to, so reading it in stored order would move a field to the end of the logging
// form the moment you switched it off and on again, interleaving the Torso/Arms/Legs groups.
export function enabledMeasurementFields(state) {
  const enabled = new Set(state.measurementEnabled || DEFAULT_MEASUREMENT_KEYS)
  const builtins = MEASUREMENT_FIELDS.filter(f => enabled.has(f.key))
  const custom = (state.customMeasurements || []).filter(c => c.enabled !== false)
    .map(c => ({ key: 'other:' + c.id, label: c.name, group: 'Other', custom: true }))
  return [...builtins, ...custom]
}

export function measurementSeries(state, key, range = 0, now = Date.now()) {
  const cutoff = range ? now - range * 86400000 : -Infinity
  const unit = state.unit || 'kg'
  const percent = key === 'bodyFat'
  return (state.measurements || []).map(entry => {
    const raw = measurementValue(entry, key)
    if (raw == null || entry.t < cutoff) return null
    return { t: entry.t, d: entry.d, y: percent ? raw : toMeasurementDisplay(raw, unit) }
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
  return MEASUREMENT_KEYS.some(k => valid(entry?.[k]) != null) ||
    (entry?.other || []).some(o => valid(o?.value) != null)
}
