import { sha256HexJs } from '../sha256.js'
import { NUTRIENTS, roundAmount, servingAmount, validDay } from './entry.js'

export function validateBarcode(value) {
  if (typeof value !== 'string' || !/^(?:[0-9]{8}|[0-9]{12,14})$/.test(value) || /\D/.test(value)) return false
  let sum = 0
  for (let i = value.length - 1, weight = 1; i >= 0; i--, weight = 4 - weight) sum += Number(value[i]) * weight
  return sum % 10 === 0
}
const object = v => v && typeof v === 'object' && !Array.isArray(v)
function text(v, max) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\p{Cc}\p{Cf}<>]/u.test(v)) throw new Error('source-text')
  return v.trim()
}
function number(v, max) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new Error('source-number')
  return v
}
// A new bounded object, in canonical field order. Never persist arbitrary provider extensions.
// Imported URLs are deliberately ignored; only this fixed source can produce links.
export function sourceSnapshot(value) {
  if (!object(value) || value.source !== 'open-food-facts' || !validateBarcode(value.externalId) || !object(value.per100)) throw new Error('source')
  const { basis } = value.per100
  if (!['g', 'ml'].includes(basis)) throw new Error('basis')
  const out = { source: value.source, externalId: value.externalId, label: text(value.label, 160) }
  for (const [key, max] of [['brand', 120], ['quantityText', 80]]) if (Object.hasOwn(value, key)) out[key] = text(value[key], max)
  out.per100 = { basis }
  for (const key of NUTRIENTS) if (Object.hasOwn(value.per100, key)) out.per100[key] = number(value.per100[key], (key === 'energyKcal' ? 900 : 100) * (basis === 'ml' ? 2 : 1))
  if (Object.hasOwn(value.per100, 'energyConversion')) {
    if (value.per100.energyConversion !== 'kJ/4.184' || out.per100.energyKcal === undefined) throw new Error('conversion')
    out.per100.energyConversion = 'kJ/4.184'
  }
  if (Object.hasOwn(value, 'serving')) {
    const s = value.serving
    if (!object(s) || Object.hasOwn(s, 'grams') === Object.hasOwn(s, 'millilitres')) throw new Error('serving')
    const key = Object.hasOwn(s, 'grams') ? 'grams' : 'millilitres'
    const size = number(s[key], 10000)
    if (!(size > 0)) throw new Error('serving')
    out.serving = { label: text(s.label, 160), [key]: size }
  }
  if (typeof value.fetchedAt !== 'string' || !validDay(value.fetchedAt.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value.fetchedAt)) throw new Error('fetched-at')
  out.fetchedAt = value.fetchedAt
  if (!object(value.attribution) || value.attribution.license !== 'ODbL-1.0') throw new Error('attribution')
  out.attribution = { text: text(value.attribution.text, 200), url: `https://world.openfoodfacts.org/product/${out.externalId}`, license: 'ODbL-1.0', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' }
  return out
}
export function sourceFingerprint(value) {
  const canonical = sourceSnapshot(value)
  delete canonical.fetchedAt
  return 'sha256:' + sha256HexJs(new TextEncoder().encode(JSON.stringify(canonical)))
}
export function lookupInput(value, amount, unit) {
  const p = sourceSnapshot(value), basisUnit = p.per100.basis === 'g' ? 'g' : 'mL'
  if (amount == null || amount === '') throw new Error('amount')
  const input = { label: p.label, amount, unit }
  if (unit === 'serving') {
    const size = p.serving?.[basisUnit === 'g' ? 'grams' : 'millilitres']
    if (!size) throw new Error('serving')
    Object.assign(input, { servingLabel: p.serving.label, servingSize: size, servingUnit: basisUnit })
  } else if (unit !== basisUnit) throw new Error('unit')
  const converted = servingAmount(input)
  const total = converted[basisUnit === 'g' ? 'amountG' : 'amountMl']
  input.amount = converted.serving?.count ?? total
  for (const key of NUTRIENTS) if (p.per100[key] !== undefined) input[key] = roundAmount(number(p.per100[key] * total / 100, 1000000))
  return input
}
