import { describe, it, expect } from 'vitest'
import { parseWorkoutCSV } from './import-csv.js'

// Headers as the real exports write them, trimmed to the columns that matter here.
const FITNOTES = 'Date,Exercise,Category,Weight,Reps,Distance,Distance Unit,Time'
const rows = (head, ...lines) => parseWorkoutCSV([head, ...lines].join('\n'), { unit: 'kg' })
const setsOf = p => p.workouts.flatMap(w => w.entries.flatMap(e => e.sets))

describe('unit stamping for unit-less files', () => {
  it('stamps the profile unit on every positive weighted set', () => {
    // The classic FitNotes shape: no unit column. The file is taken to be in the
    // profile's unit, and every positive weighted set still carries the stamp so the
    // record stays compatible with unit-aware consumers (history, stats, the model).
    const p = rows(FITNOTES,
      '2026-01-12,Bench Press,Chest,60,10,,,',
      '2026-01-12,Bench Press,Chest,50,8,,,')
    expect(p.error).toBeUndefined()
    const sets = setsOf(p)
    expect(sets).toHaveLength(2)
    expect(sets.every(s => s.w > 0 && s.unit === 'kg')).toBe(true)
  })

  it('stamps the profile unit after converting a row that disagrees', () => {
    // A lb row in a kg profile is converted, and the stamp reflects the conversion
    // rather than the source unit, so the stored value and its unit always agree.
    const head = 'Date,Exercise,Category,Weight,Weight Unit,Reps'
    const p = rows(head,
      '2026-01-12,Bench Press,Chest,135,lb,10')
    expect(p.error).toBeUndefined()
    const sets = setsOf(p)
    expect(sets).toHaveLength(1)
    expect(sets[0].w).toBeCloseTo(61.2, 1)
    expect(sets[0].unit).toBe('kg')
  })
})
