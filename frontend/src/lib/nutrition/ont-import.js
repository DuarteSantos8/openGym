import { Inflate } from 'three/addons/libs/fflate.module.js'
import { parseCSV } from '../import-csv.js'
import { sha256HexJs } from '../sha256.js'
import { readZip } from '../zip.js'
import { createEntry, validDay, NUTRIENTS, normalizeEntry } from './entry.js'

const source = 'OpenNutriTracker'
const nutrients = [['energyKcal100', 'kcal_per_100g'], ['proteins100', 'protein_per_100g'],
  ['carbohydrates100', 'carbs_per_100g'], ['fat100', 'fat_per_100g']]
const names = new Set(['user_intake.json', 'user_intake.csv', 'tracked_day_boundary.json', 'tracked_day_boundary.csv'])
const limit = 8 * 1024 * 1024
const conversionBatch = 200
const compressedSlice = 64 * 1024
const importerFields = new Set(['schemaVersion', 'createdBy', 'source', 'externalId', 'day', 'meal', 'label', 'occurredAt',
  'amountG', 'amountMl', 'serving', ...NUTRIENTS])
function invalid() { throw new Error('Invalid OpenNutriTracker export') }

async function inflate(blob, size) {
  const out = new Uint8Array(size)
  let length = 0
  const stream = new Inflate(chunk => {
    if (length + chunk.length > size) invalid()
    out.set(chunk, length)
    length += chunk.length
  })
  for (let offset = 0; offset < blob.size; offset += compressedSlice) {
    const end = Math.min(offset + compressedSlice, blob.size)
    stream.push(new Uint8Array(await blob.slice(offset, end).arrayBuffer()), end === blob.size)
  }
  if (length !== size) invalid()
  return out
}

function table(text, required) {
  const [first, ...rows] = parseCSV(text)
  const headers = first?.map(h => h.trim().toLowerCase()) || []
  if (required.some(h => !headers.includes(h)) || new Set(headers).size !== headers.length) invalid()
  return rows.map(row => {
    if (row.length !== headers.length) invalid()
    return Object.fromEntries(headers.map((key, i) => [key, row[i]]))
  })
}
function csvIntake(text) {
  return table(text, ['id', 'date_time', 'amount', 'unit', 'type']).map(row => ({
    id: row.id, unit: row.unit, amount: row.amount, dateTime: row.date_time, type: row.type,
    meal: { name: row.meal_name, mealUnit: row.meal_unit, servingUnit: row.meal_serving_unit,
      servingQuantity: row.meal_serving_quantity, servingSize: row.meal_serving_size,
      nutriments: Object.fromEntries(nutrients.map(([json, csv]) => [json, row[csv]])) },
  }))
}
function numeric(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:[.,]\d+)?$/.test(value.trim()))) invalid()
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) invalid()
  return n
}
function boundaryMinutes(text, csv) {
  if (text === undefined) return 0
  let value
  if (csv) {
    const rows = table(text, ['day_start_offset_minutes'])
    if (rows.length !== 1) invalid()
    value = rows[0].day_start_offset_minutes
  } else {
    const boundary = JSON.parse(text)
    if (Number.isInteger(boundary?.version) && boundary.version > 1) return 0
    if (boundary?.version !== 1) invalid()
    value = boundary.dayStartOffsetMinutes
  }
  const n = numeric(value)
  if (!Number.isInteger(n) || n >= 1440) invalid()
  return n
}
function filingDay(stamp, boundary) {
  // Archive timestamps carry the original diary's wall clock; never apply the importing device's offset.
  const match = /^(\d{4}-\d\d-\d\d)T([01]\d|2[0-3]):([0-5]\d):[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(stamp)
  if (!match || !validDay(match[1])) invalid()
  if (+match[2] * 60 + +match[3] >= boundary) return match[1]
  return new Date(Date.parse(match[1]) - 86400000).toISOString().slice(0, 10)
}
const mass = new Set(['g', 'kg', 'mg', 'µg', 'oz'])
const volume = new Set(['ml', 'l', 'dl', 'cl', 'fl.oz', 'fl oz'])
function dimension(unit) {
  const name = String(unit || '').trim().toLowerCase()
  if (mass.has(name)) return 'g'
  if (volume.has(name)) return 'mL'
}
function convert(row, boundary) {
  if (typeof row?.id !== 'string' || !row.id.trim() || row.id.length > 200) invalid()
  const meal = row.meal, amount = numeric(row.amount)
  const unit = String(row.unit || '').trim().toLowerCase()
  const serving = /^serving(?:#\d+)?$/.test(unit)
  if (!amount || !(serving || ['g', 'ml', 'g/ml', 'oz', 'fl.oz', 'fl oz'].includes(unit))) invalid()
  // v2.7 writes totalQuantityConverted alongside the dropdown label. Even 'oz' and
  // 'serving' amounts are already grams or millilitres; applying a multiplier here doubles it.
  const measure = dimension(unit) || (unit.startsWith('serving#') ? 'g' : undefined)
    || dimension(meal.mealUnit) || (serving ? dimension(meal.servingUnit) : undefined)
  const input = { day: filingDay(row.dateTime, boundary), meal: row.type, label: meal.name }
  if (measure) { input.amount = amount; input.unit = measure }
  for (let i = 0; i < nutrients.length; i++) {
    const value = meal.nutriments?.[nutrients[i][0]]
    if (value != null && value !== '') input[NUTRIENTS[i]] = numeric(value) * amount / 100
  }
  const entry = createEntry(input, { source, externalId: row.id })
  // The sync engine joins by local UUID. Independent imports must choose the same one.
  const hash = sha256HexJs(new TextEncoder().encode(source + ':' + row.id))
  entry.id = [hash.slice(0, 8), hash.slice(8, 12), '4' + hash.slice(13, 16),
    '8' + hash.slice(17, 20), hash.slice(20, 32)].join('-')
  entry.createdBy = 'file-import'
  delete entry.occurredAt // Selecting a file today does not mean this meal occurred at import time.
  return entry
}
export async function readOntArchive(file) {
  const entries = await readZip(file, { select: name => names.has(name), limit,
    async decode(blob, method, size) {
      return method === 0 ? new Uint8Array(await blob.arrayBuffer()) : inflate(blob, size)
    } })
  const files = new Map()
  for (const {name, blob} of entries) {
    if (files.has(name)) invalid()
    files.set(name, new TextDecoder('utf-8', {fatal: true}).decode(await blob.arrayBuffer()))
  }
  const csv = files.has('user_intake.csv')
  if (csv === files.has('user_intake.json') || files.has('tracked_day_boundary.' + (csv ? 'json' : 'csv'))) invalid()
  const ext = csv ? 'csv' : 'json'
  const boundary = boundaryMinutes(files.get('tracked_day_boundary.' + ext), csv)
  const raw = csv ? csvIntake(files.get('user_intake.csv')) : JSON.parse(files.get('user_intake.json'))
  if (!Array.isArray(raw) || raw.length > 50000) invalid()
  const seen = new Set(), rows = []
  let skipped = 0
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (row?.id && seen.has(row.id)) skipped++
    else {
      if (row?.id) seen.add(row.id)
      try { rows.push(convert(row, boundary)) } catch { skipped++ }
    }
    if ((i + 1) % conversionBatch === 0 && i + 1 < raw.length) await new Promise(resolve => setTimeout(resolve, 0))
  }
  return { rows, skipped }
}
export function mergeOntRows(state, rows) {
  const entries = [...(state.nutritionEntries || [])]
  const existing = new Map()
  entries.forEach((entry, i) => {
    if (entry?.createdBy === 'file-import' && entry?.source === source) existing.set(entry.externalId, i)
  })
  const counts = { added: 0, updated: 0, unchanged: 0 }
  for (const imported of rows) {
    const index = existing.get(imported.externalId)
    if (index === undefined) {
      existing.set(imported.externalId, entries.length)
      entries.push(imported)
      counts.added++
      continue
    }
    const old = entries[index]
    if (state.deleted?.nutritionEntries?.[old.id] > 0 || !normalizeEntry(old).supported) { counts.unchanged++; continue }
    const updated = { ...old, ...imported, id: old.id, timeZone: old.timeZone }
    for (const key of importerFields) if (!Object.hasOwn(imported, key)) delete updated[key]
    for (const key of ['createdAt', '_f', '_ts', '_u']) {
      if (Object.hasOwn(old, key)) updated[key] = old[key]
      else delete updated[key]
    }
    if (Object.keys(old).every(key => ['_f', '_ts', '_u'].includes(key) || JSON.stringify(old[key]) === JSON.stringify(updated[key]))
        && Object.keys(updated).every(key => Object.hasOwn(old, key))) { counts.unchanged++; continue }
    entries[index] = updated
    counts.updated++
  }
  if (counts.added || counts.updated) state.nutritionEntries = entries
  return counts
}
