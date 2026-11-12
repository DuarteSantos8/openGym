import { describe, it, expect } from 'vitest'
import { workoutsCSV, WORKOUT_COLUMNS } from './export-csv.js'
import { parseCSV, parseWorkoutCSV } from './import-csv.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'
import { mergeStates } from './sync-merge.js'

// Tempo (#572) has to survive every way a profile leaves the app and comes back: the CSV, a
// shared plan, and a sync between two devices.

const workout = {
  id: 'w1', d: '2026-11-02', start: 1, entries: [{
    id: '0025', target: { sets: 2, reps: 8, tempo: '3-1-1-0' },
    sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 6, done: true, tempo: '5-0-1-0' }],
  }],
}

describe('tempo in the CSV', () => {
  it('writes the set’s tempo, its own or the exercise’s, and reads it back', () => {
    const text = workoutsCSV({ unit: 'kg', workouts: [workout] })
    const rows = parseCSV(text.replace(/^﻿/, ''))
    const col = rows[0].indexOf('tempo')
    expect(col).toBe(WORKOUT_COLUMNS.indexOf('tempo'))
    expect(rows.slice(1).map(r => r[col])).toEqual(['3-1-1-0', '5-0-1-0'])
    const back = parseWorkoutCSV(text, { unit: 'kg' })
    expect(back.workouts[0].entries[0].sets.map(s => s.tempo)).toEqual(['3-1-1-0', '5-0-1-0'])
  })
  it('writes nothing for a set without one, and reads junk as nothing', () => {
    const text = workoutsCSV({ unit: 'kg', workouts: [{ ...workout, entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }] })
    const rows = parseCSV(text.replace(/^﻿/, ''))
    expect(rows[1][rows[0].indexOf('tempo')]).toBe('')
    const junk = text.replace(/,\r\n$/, ',fast\r\n')
    expect(parseWorkoutCSV(junk, { unit: 'kg' }).workouts[0].entries[0].sets[0].tempo).toBeUndefined()
  })
})

describe('tempo in a shared plan', () => {
  const plan = ex => ({ unit: 'kg', week: {}, customEx: [], routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', mode: 'reps', sets: 3, reps: 8, weight: 60, ...ex }] }] })
  it('travels with the exercise', () => {
    const back = parsePlan(JSON.stringify(buildPlanBundle(plan({ tempo: '3110' }), 'P'))).routines[0].ex[0]
    expect(back.tempo).toBe('3-1-1-0')
  })
  it('a file with a broken tempo arrives without one', () => {
    const bundle = buildPlanBundle(plan({}), 'P')
    bundle.routines[0].ex[0].tempo = '<script>'
    expect(parsePlan(JSON.stringify(bundle)).routines[0].ex[0].tempo).toBeUndefined()
  })
})

describe('tempo in a sync', () => {
  it('a routine’s tempo set on one device is kept by the merge', () => {
    const base = { _ts: 1, routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }] }], workouts: [] }
    const mine = { ...base, _ts: 3, routines: [{ id: 'r1', name: 'Push', _ts: 3, ex: [{ id: '0025', sets: 3, reps: 8, tempo: '3-1-1-0' }] }] }
    const theirs = { ...base, _ts: 2, workouts: [{ id: 'w9', d: '2026-11-01', entries: [] }] }
    const out = mergeStates(mine, theirs)
    expect(out.routines[0].ex[0].tempo).toBe('3-1-1-0')
    expect(out.workouts.map(w => w.id)).toEqual(['w9'])
  })
})
