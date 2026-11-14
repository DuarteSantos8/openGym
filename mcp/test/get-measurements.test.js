// get_measurements over a seeded profile: the shape a caller reads (entries, latest, change,
// units, labels) and the edges that are easy to get wrong — a field nobody measured that day
// absent rather than 0, a custom field keyed by id so it cannot shadow a built-in of the same
// name, two rows for one date folded into one, a window with nothing in it saying so.
import { describe, test, expect, beforeEach } from 'vitest'
import { _seedStateForTests } from '../src/state.js'
import { TOOLS } from '../src/tools.js'
import { MEASUREMENT_KEYS } from '../../frontend/src/lib/measurements.js'

const call = (name, params = {}) => TOOLS.find(t => t.name === name).handler(params)
const row = (d, vals = {}, other = [], t = 0) => ({ d, t, other, ...vals })
const served = (r, key) => r.entries.filter(e => key in e.values).map(e => ({ date: e.date, value: e.values[key] }))

describe('get_measurements', () => {
  beforeEach(() => {
    _seedStateForTests({
      unit: 'kg',
      measurements: [
        row('2026-10-14', { waist: 84.5, chest: 101.2, bodyFat: 17.2 }, [
          { id: 'c1', name: 'Neck relaxed', value: 39.4, unit: 'cm' },
          { id: 'c2', name: 'Plate', value: 20, unit: 'kg' }
        ]),
        row('2026-10-21', { waist: 84.9 }),
        row('2026-10-28', { waist: 85.4, chest: 101.9 })
      ]
    })
  })

  test('returns the entries of the window and the change across it', () => {
    const r = call('get_measurements')
    expect(r.count).toBe(3)
    expect(r.fields).toEqual(['chest', 'waist', 'bodyFat', 'other:c1', 'other:c2'])
    expect(served(r, 'waist')).toEqual([
      { date: '2026-10-14', value: 84.5 },
      { date: '2026-10-21', value: 84.9 },
      { date: '2026-10-28', value: 85.4 }
    ])
    expect(r.change.waist).toEqual({ first: { date: '2026-10-14', value: 84.5 }, last: { date: '2026-10-28', value: 85.4 }, delta: 0.9 })
    expect(r.latest).toEqual({ date: '2026-10-28', values: { chest: 101.9, waist: 85.4 } })
  })

  test('a field nobody measured is absent, never zero', () => {
    const r = call('get_measurements')
    expect(served(r, 'chest')).toHaveLength(2)        // 10-21 has no chest reading
    expect(served(r, 'chest').some(p => p.value === 0)).toBe(false)
    expect(r.change['other:c1']).toBeUndefined()      // one reading is not a trend
    expect(r.fields).not.toContain('hips')
  })

  test('units and labels say which unit and which name each field is', () => {
    const r = call('get_measurements')
    expect(r.units).toEqual({
      chest: 'cm', waist: 'cm', bodyFat: '%', 'other:c1': 'cm', 'other:c2': 'kg'
    })
    expect(r.labels).toEqual({
      chest: 'Chest', waist: 'Waist', bodyFat: 'Body fat', 'other:c1': 'Neck relaxed', 'other:c2': 'Plate'
    })
  })

  test('a custom field named like a built-in one does not overwrite it', () => {
    _seedStateForTests({
      unit: 'kg',
      customMeasurements: [{ id: 'c9', name: 'waist', unit: 'kg' }],
      measurements: [row('2026-10-14', { waist: 84.5 }, [{ id: 'c9', name: 'waist', value: 70, unit: 'kg' }])]
    })
    const r = call('get_measurements')
    expect(r.entries[0].values).toEqual({ waist: 84.5, 'other:c9': 70 })
    expect(r.units).toEqual({ waist: 'cm', 'other:c9': 'kg' })
    expect(r.labels['other:c9']).toBe('waist')
  })

  test('two rows for one date are folded, the later reading winning per field', () => {
    _seedStateForTests({
      unit: 'kg',
      measurements: [
        row('2026-10-14', { waist: 84.5, chest: 101.2 }, [], 1),
        row('2026-10-14', { waist: 84.8 }, [], 2)
      ]
    })
    const r = call('get_measurements')
    expect(r.count).toBe(1)
    expect(r.entries[0].values).toEqual({ chest: 101.2, waist: 84.8 })
    expect(r.change).toEqual({})   // a within-day difference is not a trend
  })

  test('a reading the app would not keep is not reported', () => {
    _seedStateForTests({ unit: 'kg', measurements: [row('2026-10-14', { waist: 0, bodyFat: 140, chest: 101 })] })
    expect(call('get_measurements').entries[0].values).toEqual({ chest: 101 })
  })

  test('fields narrows the answer by key or by name, custom fields included', () => {
    expect(call('get_measurements', { fields: ['waist'] }).fields).toEqual(['waist'])
    expect(call('get_measurements', { fields: ['Waist'] }).fields).toEqual(['waist'])
    expect(call('get_measurements', { fields: ['Neck relaxed'] }).fields).toEqual(['other:c1'])
    expect(call('get_measurements', { fields: ['other:c2'] }).entries).toHaveLength(1)
    const narrowed = call('get_measurements', { fields: ['waist'] })
    expect(narrowed.entries.every(e => !('chest' in e.values))).toBe(true)
    expect(narrowed.latest.values).toEqual({ waist: 85.4 })
  })

  test('the description lists built-in keys and a per-side key selects its reading', () => {
    const description = TOOLS.find(t => t.name === 'get_measurements').description
    const keys = description.match(/Built-in fields keep the screen's keys \(([^)]*)\)/)[1].split(', ')
    expect(keys).toEqual(MEASUREMENT_KEYS)
    expect(keys).not.toContain('arms')
    expect(keys).not.toContain('legs')

    _seedStateForTests({
      unit: 'kg',
      measurements: [row('2026-10-14', { upperArmLeft: 31, waist: 84 })]
    })
    const r = call('get_measurements', { fields: ['upperArmLeft'] })
    expect(r.fields).toEqual(['upperArmLeft'])
    expect(r.entries).toEqual([{ date: '2026-10-14', values: { upperArmLeft: 31 } }])
  })

  test('a custom reading with a different unit kind is omitted', () => {
    _seedStateForTests({
      unit: 'kg',
      customMeasurements: [{ id: 'c1', name: 'Reach', unit: 'cm' }],
      measurements: [
        row('2026-10-14', {}, [{ id: 'c1', name: 'Reach', value: 39, unit: 'cm' }]),
        row('2026-10-21', {}, [{ id: 'c1', name: 'Reach', value: 20, unit: 'kg' }])
      ]
    })
    const r = call('get_measurements')
    expect(r.entries).toEqual([{ date: '2026-10-14', values: { 'other:c1': 39 } }])
    expect(r.units['other:c1']).toBe('cm')
    expect(r.change['other:c1']).toBeUndefined()
    expect(r.entries.flatMap(e => Object.values(e.values))).not.toContain(20)
  })

  test('from/to clip the window, and the change starts inside it', () => {
    const r = call('get_measurements', { from: '2026-10-21', to: '2026-10-28' })
    expect(r.count).toBe(2)
    expect(r.change.waist.delta).toBe(0.5)
  })

  test('an empty window says so instead of returning nothing at all', () => {
    const r = call('get_measurements', { from: '2027-01-01' })
    expect(r.count).toBe(0)
    expect(r.latest).toBeNull()
    expect(r.note).toMatch(/no measurements/)
  })

  test('a profile that never measured gets the same honest empty answer', () => {
    _seedStateForTests({ unit: 'kg', measurements: [] })
    expect(call('get_measurements').count).toBe(0)
  })
})
