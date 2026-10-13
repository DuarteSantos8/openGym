import { describe, expect, it } from 'vitest'
import { parseBodyweight, parseImport } from './import-csv.js'

const record = (day, value, unit) => `<Record type="HKQuantityTypeIdentifierBodyMass" unit="${unit}" value="${value}" startDate="2026-09-${day} 08:00:00 +0000"/>`

describe('Apple Health body-weight units', () => {
  it.each([
    ['kg', [80, 81.6]],
    ['lb', [176.4, 180]],
  ])('converts each record into %s independently', (unit, expected) => {
    const parsed = parseBodyweight(record('01', 80, 'kg') + record('02', 180, 'lb'), { unit })
    expect(parsed.bodyweight.map(b => b.w)).toEqual(expected)
    expect(parsed.converted).toBe(true)
    expect(parsed.fileUnit).toBe('kg / lb')
  })

  it('does not let record order change another day’s weight', () => {
    const kg = record('01', 80, 'kg'), lb = record('02', 180, 'lb')
    expect(parseBodyweight(kg + lb).bodyweight).toEqual(parseBodyweight(lb + kg).bodyweight)
  })

  it('preserves conversion for single-unit XML and CSV exports', () => {
    expect(parseBodyweight(record('01', 180, 'lb')).bodyweight[0].w).toBe(81.6)
    expect(parseBodyweight('Date,Weight (lbs)\n2026-09-01,180').bodyweight[0].w).toBe(81.6)
    expect(parseBodyweight(record('01', 80, 'kg')).converted).toBe(false)
  })
})

describe('Strong measurements export', () => {
  // Header and rows as Strong 6 writes them: newest first, one measurement per row.
  const STRONG = [
    'Date,Measurement Type,Value,Unit,Source',
    '2026-10-12 08:15:25,Weight,114.75,kg,Strong',
    '2026-10-11 10:54:54,Weight,114.85,kg,Strong',
    '2026-10-11 10:55:10,Body Fat Percentage,28.5,%,Strong',
    '2026-10-09 07:30:09,Weight,253,lbs,Strong',
  ].join('\n')

  it('reads the weight rows and nothing else', () => {
    const parsed = parseImport(STRONG, { unit: 'kg' })
    expect(parsed.kind).toBe('bodyweight')
    expect(parsed.source).toBe('Strong')
    expect(parsed.bodyweight.map(b => b.d)).toEqual(['2026-10-09', '2026-10-11', '2026-10-12'])
    expect(parsed.bodyweight.map(b => b.w)).toEqual([114.8, 114.9, 114.8])
  })

  it('converts each row from its own unit', () => {
    const parsed = parseBodyweight(STRONG, { unit: 'lb' })
    expect(parsed.bodyweight.find(b => b.d === '2026-10-09').w).toBe(253)
    expect(parsed.fileUnit).toBe('kg / lb')
    expect(parsed.converted).toBe(true)
  })

  it('a file with no weight rows is not a body-weight file', () => {
    expect(parseBodyweight('Date,Measurement Type,Value,Unit,Source\n2026-10-11,Waist,98,cm,Strong').error).toBe('unrecognised')
  })
})
