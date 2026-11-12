import { describe, expect, it } from 'vitest'
import { workoutsCSV, WORKOUT_COLUMNS } from './export-csv.js'
import { parseWorkoutCSV, parseCSV, mergeImport } from './import-csv.js'

// Reddit band colours: the CSV says "Red + Yellow" and our importer gives the set its bands back.
const BANDS = [{ id: 'y', name: 'Yellow', color: '#f2c94c' }, { id: 'r', name: 'Red', color: '#eb5757' }]
const S = { unit: 'kg', bands: BANDS, workouts: [{ id: 'w', d: '2026-11-01', start: 0, end: 0, name: 'Pull', entries: [
  { id: '0005', target: { mode: 'reps' }, sets: [{ w: 0, r: 15, bands: ['r', 'y'], done: true }, { w: 0, r: 12, done: true }] },
] }] }

describe('bands in the CSV', () => {
  it('writes the names in a column of their own, blank for a set without', () => {
    const rows = parseCSV(workoutsCSV(S).replace(/^﻿/, ''))
    const col = rows[0].indexOf('bands')
    expect(col).toBe(WORKOUT_COLUMNS.indexOf('bands'))
    expect(rows.slice(1).map(r => r[col])).toEqual(['Red + Yellow', ''])
  })

  it('reads them back onto the set, matched to the bands this profile has', () => {
    const back = parseWorkoutCSV(workoutsCSV(S), { unit: 'kg', bands: BANDS })
    expect(back.workouts[0].entries[0].sets.map(s => s.bands)).toEqual([['r', 'y'], undefined])
    expect(back.bands).toBeUndefined()
  })

  it('a band the profile lacks comes in as a new one', () => {
    const back = parseWorkoutCSV(workoutsCSV(S), { unit: 'kg', bands: [] })
    expect(back.bands.map(b => b.name)).toEqual(['Red', 'Yellow'])
    const into = { unit: 'kg', workouts: [], customEx: [], exWeights: {}, bands: [] }
    mergeImport(into, back)
    expect(into.bands.map(b => b.name)).toEqual(['Red', 'Yellow'])
    expect(into.workouts[0].entries[0].sets[0].bands).toEqual(into.bands.map(b => b.id))
  })
})
