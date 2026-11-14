import { sourceSnapshot as copySourceSnapshot, sourceFingerprint } from './food-source.js'
// Saved-entry amounts, never per-100g values. Limits bound input, not dietary guidance.
export const NUTRIENTS = ['energyKcal', 'proteinG', 'carbohydrateG', 'fatG']
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
function entryId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Plain HTTP LAN origins expose secure entropy, but not the randomUUID convenience API.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export const roundAmount = n => Math.round((n + Number.EPSILON) * 1000) / 1000
const missing = v => v == null || v === ''
function number(v, max = 1000000) {
  if (missing(v)) return undefined
  if (!['number', 'string'].includes(typeof v) || (typeof v === 'string' && !v.trim())) throw new Error('number')
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error('range')
  return roundAmount(n)
}
function label(v) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 200) throw new Error('label')
  return v.trim()
}
export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day
}
export function localDay(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
const utcInstant = value => typeof value === 'string' && validDay(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value)
export function servingAmount({ amount, unit = 'g', servingLabel, servingSize, servingUnit }) {
  const count = number(amount)
  if (count === undefined) return {}
  if (unit === 'g') return { amountG: count }
  if (unit === 'mL') return { amountMl: count }
  if (unit !== 'serving' || !['g', 'mL'].includes(servingUnit)) throw new Error('unit')
  const size = number(servingSize)
  if (!(size > 0)) throw new Error('serving')
  return { [servingUnit === 'g' ? 'amountG' : 'amountMl']: number(count * size), serving: { label: label(servingLabel), count, size, unit: servingUnit } }
}
function nutrients(input, out) {
  for (const key of NUTRIENTS) if (Object.hasOwn(input, key)) {
    const v = number(input[key])
    if (v === undefined) delete out[key]
    else out[key] = v
  }
}
export function createEntry(input, { now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, source = 'manual', externalId, contentFingerprint, sourceSnapshot } = {}) {
  new Intl.DateTimeFormat('en', { timeZone }).format(now)
  if (!validDay(input.day) || !MEALS.includes(input.meal)) throw new Error('filing')
  const entry = { id: entryId(), schemaVersion: 1, createdAt: now.toISOString(), createdBy: 'manual', source: label(source), day: input.day, timeZone, meal: input.meal, label: label(input.label), ...servingAmount(input) }
  if (input.day === localDay(now, timeZone)) entry.occurredAt = now.toISOString()
  if (externalId != null) entry.externalId = label(externalId)
  if (contentFingerprint != null) {
    if (!/^sha256:[a-f0-9]{64}$/.test(contentFingerprint)) throw new Error('fingerprint')
    entry.contentFingerprint = contentFingerprint
  }
  nutrients(input, entry)
  if (sourceSnapshot !== undefined) {
    const snapshot = copySourceSnapshot(sourceSnapshot)
    if (snapshot.source !== source || snapshot.externalId !== externalId || sourceFingerprint(snapshot) !== contentFingerprint) throw new Error('source-provenance')
    entry.sourceSnapshot = snapshot
  }
  return entry
}
// Read validation returns the original object. Never migrate/normalize persisted records on read.
export function normalizeEntry(entry) {
  try {
    if (!entry || entry.schemaVersion !== 1 || !uuid.test(entry.id) || !validDay(entry.day)) throw new Error('schema')
    label(entry.label)
    if (typeof entry.timeZone !== 'string') throw new Error('zone')
    new Intl.DateTimeFormat('en', { timeZone: entry.timeZone }).format()
    // Missing legacy provenance stays unknown. Present metadata must be readable as declared.
    for (const key of ['createdAt', 'occurredAt']) if (Object.hasOwn(entry, key) && !utcInstant(entry[key])) throw new Error('instant')
    if (Object.hasOwn(entry, 'createdBy') && !['manual', 'file-import', 'provider-import', 'provider-link'].includes(entry.createdBy)) throw new Error('creator')
    for (const key of ['source', 'externalId', 'idempotencyKey']) if (Object.hasOwn(entry, key)) label(entry[key])
    if (Object.hasOwn(entry, 'contentFingerprint') && (typeof entry.contentFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(entry.contentFingerprint))) throw new Error('fingerprint')
    if (entry.meal != null && !MEALS.includes(entry.meal)) throw new Error('meal')
    for (const key of [...NUTRIENTS, 'amountG', 'amountMl']) if (entry[key] != null) {
      if (typeof entry[key] !== 'number') throw new Error('number')
      number(entry[key])
    }
    if (entry.amountG != null && entry.amountMl != null) throw new Error('unit')
    if (Object.hasOwn(entry, 'serving')) {
      if (!entry.serving || typeof entry.serving !== 'object' || Array.isArray(entry.serving)) throw new Error('serving')
      const { label: name, count, size, unit } = entry.serving
      if (typeof count !== 'number' || typeof size !== 'number' || !(size > 0)) throw new Error('serving')
      const amount = servingAmount({ amount: count, unit: 'serving', servingLabel: name, servingSize: size, servingUnit: unit })
      const key = unit === 'g' ? 'amountG' : 'amountMl'
      if (amount[key] !== entry[key]) throw new Error('serving')
    }
    return { supported: true, entry }
  } catch { return { supported: false, entry } }
}
export function editEntry(entry, patch) {
  if (!normalizeEntry(entry).supported) throw new Error('unsupported')
  const next = { ...entry }
  if (Object.hasOwn(patch, 'label')) next.label = label(patch.label)
  if (Object.hasOwn(patch, 'meal')) {
    if (!MEALS.includes(patch.meal)) throw new Error('meal')
    next.meal = patch.meal
  }
  if (Object.hasOwn(patch, 'amount')) {
    delete next.amountG; delete next.amountMl; delete next.serving
    Object.assign(next, servingAmount(patch))
  }
  nutrients(patch, next)
  return next
}
