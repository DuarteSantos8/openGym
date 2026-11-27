import { expect, test } from 'vitest'
import { mergeOptionalEntries } from '../sync-merge.js'
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js'
import { readOntArchive, mergeOntRows } from './ont-import.js'

const id = '22d16a0e-fdb7-4956-b785-a1ffe219b60c'
const base = { id, unit: 'g', amount: 50, type: 'lunch', dateTime: '2026-02-01T03:30:00.000',
  meal: { name: 'Beans', mealUnit: 'g', nutriments: { proteins100: 12 }, url: 'https://ignored.invalid/' } }
const bundle = files => new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([k,v]) => [k,strToU8(v)])))])
const parse = (rows, extra = {}) => readOntArchive(bundle({ 'user_intake.json': JSON.stringify(rows), ...extra }))
test('imports deflated JSON, uses the export day boundary, keeps missing nutrients unknown and skips ambiguous rows', async () => {
  const result = await parse([base, { ...base, id: 'other', unit: 'cup' }], {
    'tracked_day_boundary.json': '{"version":1,"dayStartOffsetMinutes":240}', 'goal_settings.json': '{broken' })
  expect(result.skipped).toBe(1)
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]).toMatchObject({ externalId: id, day: '2026-01-31', amountG: 50, proteinG: 6, createdBy: 'file-import' })
  expect(result.rows[0].energyKcal).toBeUndefined()
  expect(JSON.stringify(result)).not.toContain('ignored.invalid')
})
test('CSV handles quoted food names, serving volume, and explicit zero', async () => {
  const file = bundle({ 'user_intake.csv': 'id,date_time,type,amount,unit,meal_name,meal_unit,meal_serving_quantity,meal_serving_unit,kcal_per_100g,protein_per_100g\n' +
    id + ',2026-02-01T04:00:00.000,breakfast,200,serving,"Milk, plain",ml,100,ml,40,0', 'tracked_day_boundary.csv':'day_start_offset_minutes\n240' })
  const { rows, skipped } = await readOntArchive(file)
  expect(skipped).toBe(0)
  expect(rows[0]).toMatchObject({ day: '2026-02-01', label: 'Milk, plain', amountMl: 200, energyKcal: 80, proteinG: 0 })
})
test('repeat import updates by source ID, preserves local IDs and deletion markers', async () => {
  const s = {}
  const { rows } = await parse([base])
  expect(mergeOntRows(s, rows).added).toBe(1)
  const localId = s.nutritionEntries[0].id
  expect(mergeOntRows(s, (await parse([base])).rows).unchanged).toBe(1)
  const changed = (await parse([{ ...base, amount: 80 }])).rows
  expect(mergeOntRows(s, changed).updated).toBe(1)
  expect(s.nutritionEntries).toMatchObject([{ id:localId, amountG:80 }])
  s.deleted = { nutritionEntries:{ [localId]:123 } }
  expect(mergeOntRows(s, rows).unchanged).toBe(1)
  expect(s.nutritionEntries).toHaveLength(1)
})
test('rejects ambiguous archives and a boundary outside its range', async () => {
  await expect(parse([base], { 'user_intake.csv': 'id' })).rejects.toThrow()
  await expect(parse([base], { 'tracked_day_boundary.json': '{"version":1,"dayStartOffsetMinutes":1440}' })).rejects.toThrow()

})

test('two independent diary copies converge through the actual sync merge', async () => {
  const first = {}, second = {}
  mergeOntRows(first, (await parse([base])).rows)
  mergeOntRows(second, (await parse([base])).rows)
  expect(mergeOptionalEntries(first.nutritionEntries, second.nutritionEntries)).toHaveLength(1)
  first.nutritionEntries[0]._f = { amountG: 12 }
  first.nutritionEntries[0]._ts = 12
  expect(mergeOntRows(first, (await parse([base])).rows).unchanged).toBe(1)
})
test('first intake wins for legacy repeated IDs, blank IDs are counted as skipped', async () => {
  const result = await parse([base, { ...base, amount: 90 }, { ...base, id:' ' }])
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0].amountG).toBe(50)
  expect(result.skipped).toBe(2)
})
test('rejects invalid calendar dates and unsupported units as skipped', async () => {
  const { rows, skipped } = await parse([base, { ...base, id: 'date', dateTime: '2026-02-30T12:00:00' },
    { ...base, id: 'basis', unit: 'widgets' }, { ...base, id: 'negative', amount: -10 }])
  expect(rows).toHaveLength(1)
  expect(skipped).toBe(3)
})
test('ignores unrelated payloads, checks selected CRCs and rejects oversized declared output', async () => {
  // Use ZIP directory offsets rather than modifying compressed payload lengths.
  const file = bundle({ 'goal_settings.json':'ignored', 'user_intake.json':JSON.stringify([base]) })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const directory = new DataView(bytes.buffer)
  const start = directory.getUint32(bytes.length - 6, true)
  const next = start + 46 + directory.getUint16(start + 28, true) + directory.getUint16(start + 30, true) + directory.getUint16(start + 32, true)
  directory.setUint32(start + 16, 0, true)
  expect((await readOntArchive(new Blob([bytes]))).rows).toHaveLength(1)
  const crc = directory.getUint32(next + 16, true)
  directory.setUint32(next + 16, 0, true)
  await expect(readOntArchive(new Blob([bytes]))).rejects.toThrow()
  directory.setUint32(next + 16, crc, true)
  directory.setUint32(next + 24, 0xffffffff, true)
  await expect(readOntArchive(new Blob([bytes]))).rejects.toThrow()
})
test.each(['json', 'csv'])('v2.7 %s stores original unit labels beside the already-converted amount', async fmt => {
  const cases = [
    ['serving', 60, 'g', 'amountG', 120], ['g/ml', 150, 'g', 'amountG', 300],
    ['oz', 113.4, 'g', 'amountG', 226.8], ['fl.oz', 59.147, 'ml', 'amountMl', 118.294],
    ['serving#1', 75, 'gml', 'amountG', 150], ['g/ml', 100, 'gml', null, 200], ['ml', 25, 'ml', 'amountMl', 50],
  ]
  const intakes = cases.map(([unit, amount, basis], i) => ({ ...base, id: 'case-' + i, unit, amount,
    meal: { name: 'Fixture', mealUnit: basis, servingUnit: basis, servingQuantity: 30, nutriments: { energyKcal100: 200 } } }))
  const result = fmt === 'json' ? await parse(intakes) : await readOntArchive(bundle({
    'user_intake.csv': ['id,date_time,type,amount,unit,meal_name,meal_unit,meal_serving_quantity,meal_serving_unit,kcal_per_100g',
      ...intakes.map(r => [r.id, r.dateTime, r.type, r.amount, r.unit, r.meal.name, r.meal.mealUnit, 30, r.meal.servingUnit, 200].join(','))].join('\n') }))
  expect(result.skipped).toBe(0)
  for (const [i, entry] of result.rows.entries()) {
    const [, amount, , key, kcal] = cases[i]
    expect(entry.energyKcal).toBeCloseTo(kcal, 3)
    if (key) expect(entry[key]).toBeCloseTo(amount, 3)
    else { expect(entry.amountG).toBeUndefined(); expect(entry.amountMl).toBeUndefined() }
  }
})