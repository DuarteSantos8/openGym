import { describe, expect, it } from 'vitest'
import { defaultConfig, buildSets, setLabel, setsRepsOf, exLine, modeOf, fmtMetres, metricRowsForEntry } from './history.js'
import { modeForSet } from './workout-model.js'
import { workoutsCSV } from './export-csv.js'
import { parseWorkoutCSV } from './import-csv.js'
import { exerciseHistory } from './exercise-history.js'
import { buildSnapshot } from './watch-sync.js'

// Reddit + #1011/#1012: carries and sleds by distance, a load over metres per set.
const SLED = '4428' // power sled push
const CARRY = '2917' // dumbbell farmers carry
const BENCH = '0025'

describe('the distance mode', () => {
  it('is where a carry or a sled starts, a bench press still starts at reps', () => {
    expect(defaultConfig(SLED)).toMatchObject({ mode: 'distance', m: 20, sets: 3 })
    expect(defaultConfig(CARRY).mode).toBe('distance')
    expect(defaultConfig(BENCH).mode).toBe('reps')
    expect(modeOf({ id: CARRY, mode: 'time' })).toBe('time')
  })

  it('reads as metres and the load', () => {
    const cfg = { id: CARRY, mode: 'distance', sets: 3, m: 40, weight: 32 }
    expect(setsRepsOf(cfg)).toBe('3 × 40 m')
    expect(exLine(cfg, 'kg')).toBe('3 × 40 m · 32 kg')
    expect(setLabel(CARRY, { m: 40, w: 32, done: true }, cfg)).toBe('40 m · 32')
    expect(setLabel(CARRY, { m: 40, w: 32, done: true })).toBe('40 m · 32')
    expect(fmtMetres(1500)).toBe('1.5 km')
    expect(fmtMetres(39.6)).toBe('40 m')
    expect(modeForSet({ m: 40, w: 32 })).toBe('distance')
  })

  it('builds rows from the plan, then from last time', () => {
    const cfg = { id: CARRY, mode: 'distance', sets: 2, m: 30, weight: 24 }
    expect(buildSets({ workouts: [] }, cfg)).toEqual([{ m: 30, w: 24, done: false }, { m: 30, w: 24, done: false }])
    const S = { workouts: [{ id: 'w', d: '2026-11-01', entries: [{ id: CARRY, target: cfg, sets: [{ m: 40, w: 28, done: true }] }] }] }
    expect(buildSets(S, cfg)[0]).toEqual({ m: 40, w: 28, done: false })
  })

  it('charts the farthest set, and the history keeps the sets', () => {
    const cfg = { id: SLED, mode: 'distance', m: 20 }
    const S = { unit: 'kg', workouts: [
      { id: 'a', d: '2026-11-01', start: 1, entries: [{ id: SLED, target: cfg, sets: [{ m: 20, w: 60, done: true }] }] },
      { id: 'b', d: '2026-11-03', start: 2, entries: [{ id: SLED, target: cfg, sets: [{ m: 30, w: 60, done: true }] }] },
    ] }
    const h = exerciseHistory(S, SLED)
    expect(h.metric).toBe('m')
    expect(h.best).toBe(30)
    expect(metricRowsForEntry(S.workouts[1].entries[0])).toHaveLength(1)
  })

  it('goes through our CSV and back as metres, not as a run', () => {
    const S = { unit: 'kg', workouts: [{ id: 'w', d: '2026-11-01', start: 0, end: 0, name: 'Strongman', entries: [
      { id: CARRY, target: { mode: 'distance', m: 40 }, sets: [{ m: 40, w: 32, done: true }] },
    ] }] }
    const back = parseWorkoutCSV(workoutsCSV(S), { unit: 'kg' })
    const set = back.workouts[0].entries[0].sets[0]
    expect(set).toMatchObject({ m: 40, w: 32, done: true })
    expect(set.min).toBeUndefined()
  })

  it('goes to the watches as one logged on the phone', () => {
    const S = { unit: 'kg', workouts: [], routines: [], active: { id: 'x', start: 1, entries: [{ id: SLED, target: { mode: 'distance', m: 20, sets: 1 }, sets: [{ m: 20, w: 60, done: false }] }] } }
    const e = buildSnapshot(S).active.entries[0]
    expect(e.mode).toBe('cardio')
    expect(e.track).toBe('distance')
    expect(e.sets[0].m).toBe(20)
  })
})
